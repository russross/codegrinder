import base64
import collections
import datetime
import glob
import gzip
import json
import os
import os.path
import pathlib
import re
import requests
import shlex
import thonny
import thonny.common
import tkinter.messagebox
import tkinter.simpledialog
import webbrowser
import websocket

# constants
perUserDotFile = '.codegrinderrc'
perProblemSetDotFile = '.grind'
urlPrefix = '/v2'
grindVersion = '2.5.0'

Config = { 'host': '', 'cookie': 'codegrinder=not_logged_in' }

failedState = False

def fromSlash(name):
    parts = name.split('/')
    return os.path.join(*parts)

def mustLoadConfig():
    global Config
    global failedState

    home = pathlib.Path.home()
    if home == '':
        failedState = True
        raise RuntimeError('Unable to locate home directory, giving up')

    configFile = os.path.join(home, perUserDotFile)
    with open(configFile) as fp:
        Config = json.load(fp)

    checkVersion()

def isConfigFilePresent():
    global failedState
    home = pathlib.Path.home()
    if home == '':
        failedState = True
        raise RuntimeError('Unable to locate home directory, giving up')

    configFile = os.path.join(home, perUserDotFile)
    return os.path.exists(configFile)

def mustWriteConfig():
    global Config
    global failedState

    home = pathlib.Path.home()
    if home == '':
        failedState = True
        raise RuntimeError('Unable to locate home directory, giving up')

    configFile = os.path.join(home, perUserDotFile)
    with open(configFile, 'w') as fp:
        json.dump(Config, fp, indent=4)
        print('', file=fp)

def checkVersion():
    global failedState
    server = mustGetNamedTuple('/version', None)
    grindCurrent = tuple( int(s) for s in grindVersion.split('.') )
    grindRequired = tuple( int(s) for s in server.grindVersionRequired.split('.') )
    if grindRequired > grindCurrent:
        failedState = True
        tkinter.messagebox.showerror('CodeGrinder upgrade required',
            f'This is version {grindVersion} of the CodeGrinder plugin,\n' +
            'but the server requires {server.grindVersionRequired} or higher.\n\n' +
            'You must upgrade to continue')
    grindRecommended = tuple( int(s) for s in server.grindVersionRecommended.split('.') )
    if grindRecommended > grindCurrent:
        tkinter.messagebox.showwarning('CodeGrinder upgrade recommended',
            f'This is version {grindVersion} of the CodeGrinder plugin,\n' +
            'but the server recommends {server.grindVersionRecommended} or higher.\n\n' +
            'Please upgrade as soon as possible')

# send an API request and gather the result
# returns (result object, error string)
def doRequest(path, params, method, upload=None, notfoundokay=False):
    global failedState
    if not path.startswith('/'):
        failedState = True
        raise TypeError('doRequest path must start with /')

    if method not in ('GET', 'POST', 'PUT', 'DELETE'):
        failedState = True
        raise TypeError('doRequest only recognizes GET, POST, PUT, and DELETE methods')

    url = f'https://{Config["host"]}{urlPrefix}{path}'
    (ck, cv) = Config['cookie'].split('=', 1)
    headers = {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
    }
    data = None
    if upload is not None and method in ('POST', 'PUT'):
        headers['Content-Type'] = 'application/json'
        headers['Content-Encoding'] = 'gzip'
        data = json.dumps(upload).encode('utf-8')
    
    resp = requests.request(method, url, params=params, data=data, cookies={ck: cv})

    if notfoundokay and resp.status_code == 404:
        return None
    if resp.status_code != 200:
        tkinter.messagebox.showerror('Unexpected status from server',
            f'Received unexpected status from {url}: {resp.text}')
        return None

    return json.loads(resp.content.decode(encoding='utf-8'))

def mustGetNamedTuple(path, params):
    elt = doRequest(path, params, 'GET')
    return collections.namedtuple('x', elt.keys())(**elt)

def mustGetNamedTupleList(path, params):
    lst = []
    for elt in doRequest(path, params, 'GET'):
        lst.append(collections.namedtuple('x', elt.keys())(**elt))
    return lst

def getNamedTuple(path, params):
    elt = doRequest(path, params, 'GET', notfoundokay=True)
    if elt is None:
        return None
    return collections.namedtuple('x', elt.keys())(**elt)

def mustGetObject(path, params):
    return doRequest(path, params, 'GET')

def getObject(path, params):
    return doRequest(path, params, 'GET', notfoundokay=True)

def mustPostObject(path, params, upload):
    return doRequest(path, params, 'POST', upload=upload)

def mustPutObject(path, params, upload):
    return doRequest(path, params, 'PUT', upload=upload)

def getAssignment(assignment, course, rootDir):
    # get the problem set
    problemSet = mustGetNamedTuple(f'/problem_sets/{assignment.problemSetID}', None)

    # if the target directory exists, skip this assignment
    rootDir = os.path.join(rootDir, course.label, problemSet.unique)
    if os.path.exists(rootDir):
        return None

    # get the list of problems in the problem set
    problemSetProblems = mustGetNamedTupleList(f'/problem_sets/{assignment.problemSetID}/problems', None)

    # for each problem get the problem, the most recent commit (or create one),
    # and the corresponding step
    commits = {}
    infos = {}
    problems = {}
    steps = {}
    types = {}
    for elt in problemSetProblems:
        problem = mustGetNamedTuple(f'/problems/{elt.problemID}', None)
        problems[problem.unique] = problem

        # get the problem type if we do not already have it
        if problem.problemType not in types:
            problemType = mustGetNamedTuple(f'/problem_types/{problem.problemType}', None)
            types[problem.problemType] = problemType

        # get the commit and create a problem info based on it
        commit = getObject(f'/assignments/{assignment.id}/problems/{problem.id}/commits/last', None)
        if commit:
            info = {
                'id': problem.id,
                'step': commit['step'],
            }
        else:
            # if there is no commit for this problem, we're starting from step one
            commit = None
            info = {
                'id': problem.id,
                'step': 1,
            }

        # get the step
        step = mustGetNamedTuple(f'/problems/{problem.id}/steps/{info["step"]}', None)
        infos[problem.unique] = info
        commits[problem.unique] = commit
        steps[problem.unique] = step

    # create the target directory
    os.makedirs(rootDir, mode=0o755)

    for unique in steps.keys():
        commit, problem, step = commits[unique], problems[unique], steps[unique]

        # create a directory for this problem
        # exception: if there is only one problem in the set, use the main directory
        target = rootDir
        if len(steps) > 1:
            target = os.path.join(rootDir, unique)
            os.makedirs(target, mode=0o755)

        # save the step files
        for (name, contents) in step.files.items():
            path = os.path.join(target, fromSlash(name))
            os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
            with open(path, 'wb') as fp:
                fp.write(base64.b64decode(contents, validate=True))

        # save the doc file
        if len(step.instructions) > 0:
            name = os.path.join('doc', 'index.html')
            path = os.path.join(target, name)
            os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
            with open(path, 'wb') as fp:
                fp.write(step.instructions.encode())

        # commit files overwrite step files
        if commit is not None:
            for (name, contents) in commit['files'].items():
                path = os.path.join(target, fromSlash(name))
                with open(path, 'wb') as fp:
                    fp.write(base64.b64decode(contents, validate=True))

            # does this commit indicate the step was finished and needs to advance?
            if 'reportCard' in commit and commit['reportCard'] and \
                    commit['reportCard']['passed'] is True and commit['score'] == 1.0:
                nextStep(target, infos[unique], problem, commit)

        # save any problem type files
        problemType = types[problem.problemType]
        for (name, contents) in problemType.files.items():
            path = os.path.join(target, fromSlash(name))
            directory = os.path.dirname(path)
            if directory != '':
                os.makedirs(directory, mode=0o755, exist_ok=True)
            with open(path, 'wb') as fp:
                fp.write(base64.b64decode(contents, validate=True))

    dotfile = {
        'assignmentID': assignment.id,
        'problems': infos,
        'path': os.path.join(rootDir, perProblemSetDotFile),
    }
    saveDotFile(dotfile)

    return os.path.join(course.label, problemSet.unique)

def nextStep(directory, info, problem, commit):
    # log.Printf("step %d passed", commit['step'])

    # advance to the next step
    newStep = getNamedTuple(f'/problems/{problem.id}/steps/{commit["step"]+1}', None)
    if newStep is None:
        return False
    oldStep = mustGetNamedTuple(f'/problems/{problem.id}/steps/{commit["step"]}', None)
    # log.Printf("moving to step %d", newStep.Step)

    # delete all the files from the old step
    if len(oldStep.instructions) > 0:
        name = os.path.join('doc', 'index.html')
        path = os.path.join(directory, name)
        if os.path.exists(path):
            os.remove(path)
    for name in oldStep.files.keys():
        if os.path.dirname(fromSlash(name)) == '':
            continue
        path = os.path.join(directory, fromSlash(name))
        os.remove(path)
        dirpath = os.path.dirname(path)
        try:
            # ignore errors--the directory may not be empty
            os.rmdir(dirpath)
        except (FileNotFoundError, OSError):
            pass
    for (name, contents) in newStep.files.items():
        path = os.path.join(directory, fromSlash(name))
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
        with open(path, 'wb') as fp:
            fp.write(base64.b64decode(contents, validate=True))
    if len(newStep.instructions) > 0:
        name = os.path.join('doc', 'index.html')
        path = os.path.join(directory, name)
        os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
        with open(path, 'wb') as fp:
            fp.write(newStep.instructions.encode())

    info['step'] += 1
    return True

def saveDotFile(dotfile):
    path = dotfile['path']
    del dotfile['path']
    with open(path, 'w') as fp:
        json.dump(dotfile, fp, indent=4)
        fp.write('\n')
    dotfile['path'] = path

def gatherStudent(now, startDir):
    # find the .grind file containing the problem set info
    res = findDotFile(startDir)
    if res is None:
        raise RuntimeError('unable to locate problem set metadata file')
    (dotfile, problemSetDir, problemDir) = res

    # get the assignment
    assignment = mustGetNamedTuple(f'/assignments/{dotfile["assignmentID"]}', None)

    # get the problem
    unique = ''
    if len(dotfile['problems']) == 1:
        # only one problem? files should be in dotfile directory
        for u in dotfile['problems']:
            unique = u
        problemDir = problemSetDir
    else:
        # use the subdirectory name to identify the problem
        if problemDir == '':
            raise RuntimeError('unable to identify which problem this file is part of')
        unique = os.path.basename(problemDir)
    info = dotfile['problems'][unique]
    if not info:
        raise RuntimeError('unable to recognize the problem based on the directory name of ' + unique)
    problem = mustGetNamedTuple(f'/problems/{info["id"]}', None)

    # check that the on-disk file matches the expected contents
    # and update as needed
    def checkAndUpdate(name, contents):
        path = os.path.join(problemDir, name)
        if os.path.exists(path):
            with open(path, 'rb') as fp:
                ondisk = fp.read()
            if ondisk != contents:
                with open(path, 'wb') as fp:
                    fp.write(contents)
        else:
            os.makedirs(os.path.dirname(path), mode=0o755, exist_ok=True)
            with open(path, 'wb') as fp:
                fp.write(contents)

    # get the problem type and verify local files match
    problemType = mustGetNamedTuple(f'/problem_types/{problem.problemType}', None)
    for (name, contents) in problemType.files.items():
        checkAndUpdate(fromSlash(name), base64.b64decode(contents, validate=True))

    # get the problem step and verify local files match
    step = mustGetNamedTuple(f'/problems/{problem.id}/steps/{info["step"]}', None)
    for (name, contents) in step.files.items():
        if os.path.dirname(fromSlash(name)) == '':
            # in main directory, skip files that exist (but write files that are missing)
            path = os.path.join(problemDir, name)
            if os.path.exists(path):
                continue
        checkAndUpdate(fromSlash(name), base64.b64decode(contents, validate=True))
    checkAndUpdate(os.path.join('doc', 'index.html'), step.instructions.encode())

    # gather the commit files from the file system
    files = {}
    for name in step.whitelist.keys():
        path = os.path.join(problemDir, name)
        if not os.path.exists(path):
            files[name] = ''
            continue
        with open(path, 'rb') as fp:
            files[name] = base64.b64encode(fp.read()).decode()

    # form a commit object
    commit = {
        'assignmentID': dotfile['assignmentID'],
        'problemID': info['id'],
        'step': info['step'],
        'files': files,
        'createdAt': now.isoformat() + 'Z',
        'modifiedAt': now.isoformat() + 'Z',
    }

    return (problemType, problem, assignment, commit, dotfile)

def mustConfirmCommitBundle(bundle, args):
    # create a websocket connection to the server
    url = 'wss://' + bundle['hostname'] + urlPrefix + '/sockets/' + \
        bundle['problem']['problemType'] + '/' + bundle['commit']['action']
    socket = websocket.create_connection(url)

    # form the initial request
    req = {
        'commitBundle': bundle,
    }
    socket.send(json.dumps(req).encode('utf-8'))

    # start listening for events
    while True:
        reply = json.loads(socket.recv())

        if 'error' in reply and reply['error']:
            socket.close()
            tkinter.messagebox.showinfo('Server error',
                f'The server reported an unexpected error:\n\n' +
                '{reply["error"]}')
            return None

        if 'commitBundle' in reply and reply['commitBundle']:
            socket.close()
            return reply['commitBundle']

        if 'event' in reply and reply['event']:
            # ignore the streamed data
            pass

        else:
            socket.close()
            tkinter.messagebox.showinfo('Server error',
                f'The server returned an unexpected message type.')
            return None

    socket.close()
    tkinter.messagebox.showerror('No result returned from server',
        'The server did not return the graded code, ' +
        'so the grading process cannot continue.')
    return None

# returns None or (filename, dotfile, problemSetDir, problemDir)
def get_codegrinder_project_info():
    notebook = thonny.get_workbench().get_editor_notebook()

    current = notebook.get_current_editor()
    if not current:
        return None
    filename = current.get_filename()
    if not filename:
        return None
    filename = os.path.realpath(filename)

    # see if this file is part of a codegrinder project
    res = findDotFile(os.path.dirname(filename))
    if res is None:
        return None
    (dotfile, problemSetDir, problemDir) = res
    if problemDir == '':
        problemDir = problemSetDir

    return (os.path.basename(filename), dotfile, problemSetDir, problemDir)

def findDotFile(startDir):
    isAbs = False
    problemSetDir, problemDir = startDir, ''
    while True:
        path = os.path.join(problemSetDir, perProblemSetDotFile)
        if os.path.exists(path):
            break

        if not isAbs:
            isAbs = True
            path = os.path.realpath(problemSetDir)
            problemSetDir = path

        # try moving up a directory
        problemDir = problemSetDir
        problemSetDir = os.path.dirname(problemSetDir)
        if problemSetDir == problemDir:
            return None

    # read the .grind file
    with open(path) as fp:
        dotfile = json.load(fp)
    dotfile['path'] = path

    return (dotfile, problemSetDir, problemDir)

def _codegrinder_login_handler():
    code = tkinter.simpledialog.askstring(
        'Login to CodeGrinder',
        'Please paste the login code from a Canvas assignment page.\n' +
        'It should look something like:\n\n' +
        'grind login some.servername.edu 8chrcode\n\n' +
        'Note: this is normally only necessary once per semester')
    if code is None:
        return

    # sanity check
    fields = code.split()
    if len(fields) != 4 or fields[0] != 'grind' or fields[1] != 'login':
        tkinter.messagebox.showerror('Login failed',
            'Copy the login code from a Canvas assignment page.')
        return

    # get a session key
    try:
        Config['host'] = fields[2]
        session = mustGetNamedTuple('/users/session', {'key':fields[3]})
        cookie = session.Cookie

        # set up config
        Config['cookie'] = cookie

        # see if they need an upgrade
        checkVersion()

        # try it out by fetching a user record
        user = mustGetNamedTuple('/users/me', None)

        # save config for later use
        mustWriteConfig()

        tkinter.messagebox.showinfo('Login successful',
            f'Login successful; welcome {user.name}')

    except RuntimeError as err:
        tkinter.messagebox.showerror('Login failed', str(err))
        tkinter.messagebox.showerror('Login failed', str(err) + '\n\n' +
            'Make sure you use a fresh login code\n(no more than 5 minutes old).')

def _codegrinder_run_tests_handler():
    global failedState
    thonny.get_workbench().get_editor_notebook().save_all_named_editors()
    res = get_codegrinder_project_info()
    if res is None:
        tkinter.messagebox.showwarning('Not a CodeGrinder project',
            'This command should only be run when editing\n' +
            'a file that is part of a CodeGrinder assignment.')
        return
    (filename, dotfile, problemSetDir, problemDir) = res

    # run the commands
    cmd_line = '%cd ' + shlex.quote(problemDir) + '\n'
    if os.path.exists(os.path.join(problemDir, 'tests')):
        cmd_line += '!python3 -m unittest discover -vs tests\n'
    elif os.path.exists(os.path.join(problemDir, 'inputs')):
        # find main
        py_files = [ os.path.basedname(s) for s in glob.glob(f'{problemDir}/*.py')]
        for name in py_files:
            count = 0
            with open(os.path.join(problemDir, name)) as fp:
                contents = fp.read()
                if re.search('^def main\b', contents):
                    main = name
                    count += 1
        if len(py_files) == 1:
            main = py_files[0]
        elif 'main.py' in py_files:
            main = 'main.py'
        elif count == 1:
            pass
        else:
            main = filename
        cmd_line += '!python3 bin/inout-stepall.py python3 {main}'
    else:
        failedState = True
        raise RuntimeError('Unknown problem type--I do not know how to run the tests')
    thonny.get_workbench().get_view('ShellView').clear_shell()
    thonny.get_workbench().get_view('ShellView').submit_magic_command(cmd_line)

def _codegrinder_download_handler():
    global failedState
    home = pathlib.Path.home()
    if home == '':
        failedState = True
        raise RuntimeError('Unable to locate home directory, giving up')

    mustLoadConfig()
    user = mustGetNamedTuple('/users/me', None)
    assignments = mustGetNamedTupleList(f'/users/{user.id}/assignments', None)
    if len(assignments) == 0:
        tkinter.messagebox.showerror('No assignments found',
            'Remember that you must click on each assignment in Canvas once ' +
            'before you can access it here.')
        return

    # cache the course downloads
    courses = {}

    downloads = []
    for assignment in assignments:
        # ignore quizzes
        if assignment.problemSetID <= 0:
            continue

        # get the course
        if assignment.courseID not in courses:
            course = mustGetNamedTuple(f'/courses/{assignment.courseID}', None)
            courses[assignment.courseID] = course
        course = courses[assignment.courseID]

        # download the assignment
        problemDir = getAssignment(assignment, course, home)
        if problemDir is not None:
            downloads.append(problemDir)

    if len(downloads) == 0:
        tkinter.messagebox.showerror('No new assignments found',
            'Remember that you must click on each assignment in Canvas once ' +
            'before you can access it here.')
    else:
        msg = f'Downloaded {len(downloads)} new assignment{"" if len(downloads) == 1 else "s"}'
        if len(downloads) > 0:
            msg += ':\n\n' + '\n'.join(downloads)
        tkinter.messagebox.showinfo('Assignments downloaded', msg)

def _codegrinder_save_and_sync_handler():
    thonny.get_workbench().get_editor_notebook().save_all_named_editors()
    res = get_codegrinder_project_info()
    if res is None:
        tkinter.messagebox.showwarning('Not a CodeGrinder project',
            'This command should only be run when editing\n' +
            'a file that is part of a CodeGrinder assignment.')
        return
    (filename, dotfile, problemSetDir, problemDir) = res

    mustLoadConfig()
    now = datetime.datetime.utcnow()

    user = mustGetNamedTuple('/users/me', None)

    (problemType, problem, assignment, commit, dotfile) = gatherStudent(now, problemDir)
    commit['action'] = ''
    commit['node'] = 'saving from thonny plugin'
    unsigned = {
        'userID': user.id,
        'commit': commit,
    }
    signed = mustPostObject('/commit_bundles/unsigned', None, unsigned)

    msg = 'A copy of your current work has been saved '
    msg += 'to the CodeGrinder server where your instructor '
    msg += 'can access it.\n\n'
    msg += 'You should always select this option '
    msg += 'before contacting your instructor for help.'
    tkinter.messagebox.showinfo('Saved successfully', msg)

def _codegrinder_grade_handler():
    thonny.get_workbench().get_editor_notebook().save_all_named_editors()
    res = get_codegrinder_project_info()
    if res is None:
        tkinter.messagebox.showwarning('Not a CodeGrinder project',
            'This command should only be run when editing\n' +
            'a file that is part of a CodeGrinder assignment.')
        return
    (filename, dotfile, problemSetDir, problemDir) = res

    mustLoadConfig()
    now = datetime.datetime.utcnow()

    # get the user ID
    user = mustGetNamedTuple('/users/me', None)

    (problemType, problem, assignment, commit, dotfile) = gatherStudent(now, problemDir)
    commit['action'] = 'grade'
    commit['node'] = 'grading from thonny plugin'
    unsigned = {
        'userID': user.id,
        'commit': commit,
    }

    # send the commit bundle to the server
    signed = mustPostObject('/commit_bundles/unsigned', None, unsigned)

    # send it to the daycare for grading
    if 'hostname' not in signed or not signed['hostname']:
        tkinter.messagebox.showerror('Server error',
            'The server was unable to find a suitable grader\n' +
            'for this problem type.\n\n' +
            'Please try again later or contact your instructor\n' +
            'for help.')
        return
    graded = mustConfirmCommitBundle(signed, None)

    # save the commit with report card
    toSave = {
        'hostname':         graded['hostname'],
        'userID':           graded['userID'],
        'commit':           graded['commit'],
        'commitSignature':  graded['commitSignature'],
    }
    saved = mustPostObject('/commit_bundles/signed', None, toSave)
    commit = saved['commit']

    shell = thonny.get_workbench().get_view('ShellView')
    shell.clear_shell()
    if 'reportCard' in commit and commit['reportCard'] and \
            commit['reportCard']['passed'] is True and commit['score'] == 1.0:
        tkinter.messagebox.showinfo('Step complete',
            'You have completed this step successfully ' +
            'and your updated grade was submitted to Canvas.\n\n' +
            'If there are additional steps, the files and instructions ' +
            'will be updated for the new step and Thonny may prompt you ' +
            'to see if you want to update to the "External Modification".\n\n' +
            'You should select "Yes" if you see that prompt and begin ' +
            'working on the next step.')

        if nextStep(problemDir, dotfile['problems'][problem.unique], problem, commit):
            # save the updated dotfile with the new step number
            saveDotFile(dotfile)

            step = commit['step']
            msg = f'reportCard = "Completed step {step}, moving on to step {step+1}"\n'
            shell.submit_python_code(msg)
            webbrowser.open_new_tab(f'file://{problemDir}/doc/index.html')
        else:
            msg = 'reportCard = "You have completed this problem successfully"\n'
            shell.submit_python_code(msg)

    else:
        # solution failed
        def escape(s):
            return s.replace('"""', '\\"\\"\\"')

        msg = 'reportCard = """\n'
        # play the transcript
        if 'transcript' in commit and commit['transcript']:
            for elt in commit['transcript']:
                msg += escape(dumpEventMessage(elt))

        if 'reportCard' in commit and commit['reportCard']:
            msg += '\n\n'
            msg += escape(commit['reportCard']['note'])

        msg += '\n"""\n'
        shell.submit_python_code(msg)

signals = {
        1:  "SIGHUP",
        2:  "SIGINT",
        3:  "SIGQUIT",
        4:  "SIGILL",
        5:  "SIGTRAP",
        6:  "SIGABRT",
        7:  "SIGBUS",
        8:  "SIGFPE",
        9:  "SIGKILL",
        10: "SIGUSR1",
        11: "SIGSEGV",
        12: "SIGUSR2",
        13: "SIGPIPE",
        14: "SIGALRM",
        15: "SIGTERM",
        16: "SIGSTKFLT",
        17: "SIGCHLD",
        18: "SIGCONT",
        19: "SIGSTOP",
        20: "SIGTSTP",
        21: "SIGTTIN",
        22: "SIGTTOU",
        23: "SIGURG",
        24: "SIGXCPU",
        25: "SIGXFSZ",
        26: "SIGVTALRM",
        27: "SIGPROF",
        28: "SIGWINCH",
        29: "SIGIO",
        30: "SIGPWR",
        31: "SIGSYS",
        34: "SIGRTMIN",
        35: "SIGRTMIN+1",
        36: "SIGRTMIN+2",
        37: "SIGRTMIN+3",
        38: "SIGRTMIN+4",
        39: "SIGRTMIN+5",
        40: "SIGRTMIN+6",
        41: "SIGRTMIN+7",
        42: "SIGRTMIN+8",
        43: "SIGRTMIN+9",
        44: "SIGRTMIN+10",
        45: "SIGRTMIN+11",
        46: "SIGRTMIN+12",
        47: "SIGRTMIN+13",
        48: "SIGRTMIN+14",
        49: "SIGRTMIN+15",
        50: "SIGRTMAX-14",
        51: "SIGRTMAX-13",
        52: "SIGRTMAX-12",
        53: "SIGRTMAX-11",
        54: "SIGRTMAX-10",
        55: "SIGRTMAX-9",
        56: "SIGRTMAX-8",
        57: "SIGRTMAX-7",
        58: "SIGRTMAX-6",
        59: "SIGRTMAX-5",
        60: "SIGRTMAX-4",
        61: "SIGRTMAX-3",
        62: "SIGRTMAX-2",
        63: "SIGRTMAX-1",
        64: "SIGRTMAX",
}

def dumpEventMessage(e):
    if e['event'] == 'exec':
        return f'$ {" ".join(e["execcommand"])}\n'

    if e['event'] == 'exit':
        if e['exitstatus'] == 0:
            return ''

        n = e['exitstatus'] - 128
        if n in signals:
            sig = signals[n]
            return f'exit status {e["exitstatus"]} (killed by {sig})\n'

        return f'exit status {e["exitstatus"]}\n'

    if e['event'] in ('stdin', 'stdout', 'stderr'):
        return base64.b64decode(e['streamdata'], validate=True).decode('utf-8')

    if e['event'] == 'error':
        return f'Error: {e["error"]}\n'

    return ''


def _codegrinder_show_instructions_handler():
    res = get_codegrinder_project_info()
    if res is None:
        tkinter.messagebox.showwarning('Not a CodeGrinder project',
            'This command should only be run when editing\n' +
            'a file that is part of a CodeGrinder assignment.')
        return
    (filename, dotfile, problemSetDir, problemDir) = res

    webbrowser.open_new_tab(f'file://{problemDir}/doc/index.html')

def _codegrinder_logout_handler():
    global failedState
    home = pathlib.Path.home()
    if home == '':
        failedState = True
        raise RuntimeError('Unable to locate home directory, giving up')

    configFile = os.path.join(home, perUserDotFile)
    os.remove(configFile)

def _codegrinder_login_enabled():
    if failedState:
        return False
    return not isConfigFilePresent()

def _codegrinder_in_project():
    if failedState:
        return False
    if not isConfigFilePresent():
        return False
    res = get_codegrinder_project_info()
    return res is not None

def _codegrinder_run_tests_enabled():
    if failedState:
        return False
    if not isConfigFilePresent():
        return False
    res = get_codegrinder_project_info()
    if res is None:
        return False
    (filename, dotfile, problemSetDir, problemDir) = res
    if os.path.exists(os.path.join(problemDir, 'tests')):
        return True
    if os.path.exists(os.path.join(problemDir, 'inputs')):
        return True
    return False

def _codegrinder_logout_enabled():
    if failedState:
        return False
    return isConfigFilePresent()

def load_plugin():
    wb = thonny.get_workbench()
    wb.add_command(command_id='CodeGrinder-test',
                   menu_name='CodeGrinder',
                   command_label='Run tests',
                   tester=_codegrinder_run_tests_enabled,
                   handler=_codegrinder_run_tests_handler,
                   group=20)
    wb.add_command(command_id='CodeGrinder-doc',
                   menu_name='CodeGrinder',
                   command_label='Show instructions',
                   tester=_codegrinder_in_project,
                   handler=_codegrinder_show_instructions_handler,
                   group=20)
    wb.add_command(command_id='CodeGrinder-grade',
                   menu_name='CodeGrinder',
                   command_label='Submit for grading',
                   tester=_codegrinder_in_project,
                   handler=_codegrinder_grade_handler,
                   group=50)
    wb.add_command(command_id='CodeGrinder-download',
                   menu_name='CodeGrinder',
                   command_label='Download new assignments',
                   tester=_codegrinder_logout_enabled,
                   handler=_codegrinder_download_handler,
                   group=70)
    wb.add_command(command_id='CodeGrinder-save',
                   menu_name='CodeGrinder',
                   command_label='Save and sync this assignment',
                   tester=_codegrinder_in_project,
                   handler=_codegrinder_save_and_sync_handler,
                   group=70)
    wb.add_command(command_id='CodeGrinder-login',
                   menu_name='CodeGrinder',
                   command_label='Login...',
                   tester=_codegrinder_login_enabled,
                   handler=_codegrinder_login_handler,
                   group=90)
    wb.add_command(command_id='CodeGrinder-logout',
                   menu_name='CodeGrinder',
                   command_label='Logout',
                   tester=_codegrinder_logout_enabled,
                   handler=_codegrinder_logout_handler,
                   group=90)
