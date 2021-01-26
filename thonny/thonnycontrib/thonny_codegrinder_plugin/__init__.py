'''Thonny plugin to integrate with CodeGrinder for coding practice'''

__version__ = '2.5.4'

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
import tkinter.ttk
import tkinterhtml
import websocket

#
# inject the CodeGrinder menu items into Thonny
#

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
    wb.add_command(command_id='CodeGrinder-progress',
                   menu_name='CodeGrinder',
                   command_label='Show assignment progress',
                   tester=_codegrinder_in_project,
                   handler=_codegrinder_progress_handler,
                   group=50)
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
    wb.add_view(tkinterhtml.HtmlFrame, "Instructions", "ne", default_position_key="zzz")

#
# These functions are predicates to decide if menu items should be enabled
#

def _codegrinder_login_enabled():
    try:
        check_config_file_present()
        return False
    except SilentException:
        return True
    except DialogException:
        return False

def _codegrinder_logout_enabled():
    try:
        check_config_file_present()
        return True
    except SilentException:
        return False
    except DialogException:
        return False

def _codegrinder_in_project():
    try:
        check_config_file_present()
        get_codegrinder_project_info()
        return True
    except SilentException:
        return False
    except DialogException:
        return False

def _codegrinder_run_tests_enabled():
    try:
        check_config_file_present()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()
        if os.path.exists(os.path.join(problemDir, 'tests')):
            return True
        if os.path.exists(os.path.join(problemDir, 'inputs')):
            return True
        return False
    except SilentException:
        return False
    except DialogException:
        return False

#
# These functions are invoked directly from the menu
#

def _codegrinder_login_handler():
    try:
        code = tkinter.simpledialog.askstring(
            'Login to CodeGrinder',
            'Please paste the login code from a Canvas assignment page. ' +
            'It should look something like:\n\n' +
            'grind login some.servername.edu 8chrcode\n\n' +
            'Note: this is normally only necessary once per semester')
        if code is None:
            return

        # sanity check
        fields = code.split()
        if len(fields) != 4 or fields[0] != 'grind' or fields[1] != 'login':
            raise DialogException('Login failed',
                'The login code you supplied does not look right.\n\n' +
                'Copy the login code directly from a Canvas assignment page.')

        # get a session key
        CONFIG['host'] = fields[2]
        session = get_named_tuple('/users/session', {'key':fields[3]})
        if session is None:
            raise DialogException('Login failed',
                str(err) + '\n\n' +
                'Make sure you use a fresh login code (no more than 5 minutes old).')

        cookie = session.Cookie

        # set up config
        CONFIG['cookie'] = cookie

        # see if they need an upgrade
        check_version()

        # try it out by fetching a user record
        user = must_get_named_tuple('/users/me', None)

        # save config for later use
        must_write_config()

        tkinter.messagebox.showinfo('Login successful',
            f'Login successful; welcome {user.name}')

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_logout_handler():
    try:
        home = get_home()
        configFile = os.path.join(home, perUserDotFile)
        os.remove(configFile)
        tkinter.messagebox.showinfo('Logged out',
            'Note that when you are on your own machine '+
            'or are logged into your own account, '+
            'you can normally leave yourself logged in '+
            'for the entire semester')
    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_show_instructions_handler():
    try:
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()
        show_instructions(problemDir)
    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def show_instructions(problemDir):
    with open(os.path.join(problemDir, 'doc', 'index.html')) as fp:
        doc = fp.read()

    iv = thonny.get_workbench().get_view('HtmlFrame')
    iv.set_content(doc)
    thonny.get_workbench().show_view('HtmlFrame', set_focus=False)

def _codegrinder_run_tests_handler():
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        # run the commands
        cmd_line = '%cd ' + shlex.quote(problemDir) + '\n'
        python = 'python3'
        if os.name == 'nt':
            python = 'python'
        if os.path.exists(os.path.join(problemDir, 'tests')):
            cmd_line += f'!{python} -m unittest discover -vs tests\n'
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
            cmd_line += f'!{python} bin/inout-stepall.py {python} {main}'
        else:
            raise DialogException('Unknown problem type',
                'I do not know how to run the tests for this problem.',
                True)
        thonny.get_workbench().get_view('ShellView').clear_shell()
        thonny.get_workbench().get_view('ShellView').submit_magic_command(cmd_line)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_download_handler():
    try:
        home = get_home()
        must_load_config()
        user = must_get_named_tuple('/users/me', None)
        assignments = must_get_named_tuple_list(f'/users/{user.id}/assignments', None)
        if len(assignments) == 0:
            tkinter.messagebox.showinfo('No assignments found',
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
                courses[assignment.courseID] = must_get_named_tuple(f'/courses/{assignment.courseID}', None)
            course = courses[assignment.courseID]

            # download the assignment
            problemDir = get_assignment(assignment, course, home)
            if problemDir is not None:
                downloads.append(problemDir)

        if len(downloads) == 0:
            tkinter.messagebox.showinfo('No new assignments found',
                'You must click on each assignment in Canvas once ' +
                'before you can access it here.\n\nIf you have clicked on it in Canvas and ' +
                'are seeing this message, then you have probably already downloaded it ' +
                'and are ready to start working on it.')
        else:
            msg = f'Downloaded {len(downloads)} new assignment{"" if len(downloads) == 1 else "s"}'
            if len(downloads) > 0:
                msg += ':\n\n' + '\n'.join(downloads)
            tkinter.messagebox.showinfo('Assignments downloaded', msg)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_save_and_sync_handler():
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        user = must_get_named_tuple('/users/me', None)

        (problemType, problem, assignment, commit, dotfile) = gather_student(now, problemDir)
        commit['action'] = ''
        commit['note'] = 'thonny plugin save'
        unsigned = {
            'userID': user.id,
            'commit': commit,
        }
        signed = must_post_object('/commit_bundles/unsigned', None, unsigned)

        msg = 'A copy of your current work has been saved '
        msg += 'to the CodeGrinder server where your instructor '
        msg += 'can access it.\n\n'
        msg += 'You should always select this option '
        msg += 'before contacting your instructor for help.'
        tkinter.messagebox.showinfo('Saved successfully', msg)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_progress_handler():
    try:
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        # get the assignment
        assignment = must_get_named_tuple(f'/assignments/{dotfile["assignmentID"]}', None)

        # get the course
        course = must_get_named_tuple(f'/courses/{assignment.courseID}', None)

        # get the problems
        problem_set = must_get_named_tuple(f'/problem_sets/{assignment.problemSetID}', None)
        problem_set_problems = must_get_named_tuple_list(f'/problem_sets/{assignment.problemSetID}/problems', None)
        msg = f'{assignment.canvasTitle}\n'
        if len(problem_set_problems) == 0:
            raise DialogException('No problems found',
                'Could not find any problems as part of this assignment.')

        msg += f'Location: {problemSetDir}\n'
        if len(problem_set_problems) > 1:
            msg += f'This assignment has {len(problem_set_problems)} problems:\n\n'
        else:
            msg += '\n'

        for psp in problem_set_problems:
            problem = must_get_named_tuple(f'/problems/{psp.problemID}', None)
            msg += f'[*] {problem.note}\n'
            if len(problem_set_problems) > 1:
                msg += f'    Location: {problem.unique}\n'

            # get the steps
            steps = must_get_named_tuple_list(f'/problems/{problem.id}/steps', None)
            if problem.unique in assignment.rawScores:
                scores = assignment.rawScores[problem.unique]
            else:
                scores = []
            weightSum, scoreSum = 0.0, 0.0
            completed = 0

            # compute a weighted score for this problem
            for (i, step) in enumerate(steps):
                weightSum += step.weight
                if i < len(scores):
                    scoreSum += scores[i] * step.weight
                    if scores[i] == 1:
                        completed += 1
            if weightSum == 0:
                stepScore = 0.0
            else:
                stepScore = scoreSum / weightSum

            msg += f'    Score: {stepScore * 100.0:.0f}%'
            if len(steps) > 1:
                msg += f' (completed {completed}/{len(steps)} steps)'
            msg += '\n\n'

        if len(problem_set_problems) > 1:
            msg += f'Overall score: {assignment.score * 100.0:.0f}%'

        tkinter.messagebox.showinfo('Assignment progress report', msg)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_grade_handler():
    bar = None
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        # get the user ID
        user = must_get_named_tuple('/users/me', None)

        (problemType, problem, assignment, commit, dotfile) = gather_student(now, problemDir)
        commit['action'] = 'grade'
        commit['note'] = 'thonny plugin grade'
        unsigned = {
            'userID': user.id,
            'commit': commit,
        }

        # send the commit bundle to the server
        signed = must_post_object('/commit_bundles/unsigned', None, unsigned)
        if 'hostname' not in signed or not signed['hostname']:
            raise DialogException('Server error',
                'The server was unable to find a suitable grader for this problem type.\n\n' +
                'Please try again later or contact your instructor for help.')

        # send it to the daycare for grading
        # with a progress spinner popup
        bar = Progress(thonny.get_workbench().winfo_toplevel())
        graded = must_confirm_commit_bundle(signed, None, bar)
        bar.stop()

        # save the commit with report card
        toSave = {
            'hostname':         graded['hostname'],
            'userID':           graded['userID'],
            'commit':           graded['commit'],
            'commitSignature':  graded['commitSignature'],
        }
        saved = must_post_object('/commit_bundles/signed', None, toSave)
        commit = saved['commit']

        shell = thonny.get_workbench().get_view('ShellView')
        shell.clear_shell()
        if 'reportCard' in commit and commit['reportCard'] and \
                commit['reportCard']['passed'] is True and commit['score'] == 1.0:

            # peek ahead to see if there is another step
            newStep = get_named_tuple(f'/problems/{problem.id}/steps/{commit["step"]+1}', None)
            if newStep is not None:
                tkinter.messagebox.showinfo('Step complete',
                    'You have completed this step successfully ' +
                    'and your updated grade was submitted to Canvas.\n\n' +
                    'This problem has another step, so the files and instructions ' +
                    'will now be updated for the next step.\n\n' +
                    'Thonny may notice that files are changing and prompt you to see ' +
                    'if you want to update to the "External Modification".\n\n' +
                    'You should select "Yes" if you see that prompt.')

            if next_step(problemDir, dotfile['problems'][problem.unique], problem, commit):
                # save the updated dotfile with the new step number
                save_dot_file(dotfile)

                step = commit['step']
                msg = f'reportCard = "Completed step {step}, moving on to step {step+1}"\n'
                shell.submit_python_code(msg)

                show_instructions(problemDir)
            else:
                msg = 'reportCard = "You have completed this problem successfully ' + \
                    'and your updated grade was submitted to Canvas"\n'
                shell.submit_python_code(msg)

        else:
            # solution failed
            def escape(s):
                return s.replace('"""', '\\"\\"\\"')

            msg = 'reportCard = """\n'
            # play the transcript
            if 'transcript' in commit and commit['transcript']:
                for elt in commit['transcript']:
                    msg += escape(dump_event_message(elt))

            if 'reportCard' in commit and commit['reportCard']:
                msg += '\n\n'
                msg += escape(commit['reportCard']['note'])

            msg += '\n"""\n'
            shell.submit_python_code(msg)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

    if bar:
        bar.stop()

#
# The rest are helper functions, mostly ported from the grind CLI tool
#

# constants
perUserDotFile = '.codegrinderrc'
perProblemSetDotFile = '.grind'
urlPrefix = '/v2'

CONFIG = { 'host': '', 'cookie': 'codegrinder=not_logged_in' }
VERSION_WARNING = False

class SilentException(Exception):
    pass

class DialogException(Exception):
    def __init__(self, title, message, warning=False):
        self.title = title
        self.message = message
        self.warning = warning

    def show_dialog(self):
        if self.warning:
            tkinter.messagebox.showwarning(self.title, self.message)
        else:
            tkinter.messagebox.showerror(self.title, self.message)

class Progress(tkinter.simpledialog.SimpleDialog):
    def __init__(self, parent):
        super().__init__(
                parent,
                title='Grading your solution...',
                text='Your solution is being tested on a CodeGrinder server')
        self.parent = parent
        self.default = None
        self.cancel = None
        self.bar = tkinter.ttk.Progressbar(
                self.root, orient='horizontal', length=200, mode='indeterminate')
        self.bar.pack(expand=True, fill=tkinter.X, side=tkinter.BOTTOM)
        self.root.attributes('-topmost', True)
        self.parent.update_idletasks()
        self.active = True

    def show_progress(self):
        if self.active:
            self.bar.step(10)
            self.parent.update_idletasks()

    def stop(self):
        if self.active:
            self.root.destroy()
            self.active = False

def from_slash(name):
    parts = name.split('/')
    return os.path.join(*parts)

def get_home():
    home = pathlib.Path.home()
    if home == '':
        raise DialogException('Fatal error', 'Unable to locate home directory, giving up')
    return home

def must_load_config():
    global CONFIG

    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    with open(configFile) as fp:
        CONFIG = json.load(fp)

    check_version()

def check_config_file_present():
    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    if not os.path.exists(configFile):
        raise SilentException()

def must_write_config():
    global CONFIG

    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    with open(configFile, 'w') as fp:
        json.dump(CONFIG, fp, indent=4)
        print('', file=fp)

def version_tuple(s):
    return tuple(int(elt) for elt in s.split('.'))

def check_version():
    global VERSION_WARNING
    server = must_get_named_tuple('/version', None)
    if version_tuple(server.thonnyVersionRequired) > version_tuple(__version__):
        raise DialogException('CodeGrinder upgrade required',
            f'This is version {__version__} of the CodeGrinder plugin, ' +
            f'but the server requires {server.thonnyVersionRequired} or higher.\n\n' +
            'You must upgrade to continue\n\n' +
            'To upgrade:\n' +
            '1. Select the menu item "Tools" -> "Manage plug-ins..."\n' +
            '2. Find "thonny-codegrinder-plugin" in the list on the left and click on it\n' +
            '3. Click the "Upgrade" button at the bottom\n' +
            '4. After it finishes upgrading, quit Thonny and restart it')
    elif version_tuple(server.thonnyVersionRecommended) > version_tuple(__version__) and not VERSION_WARNING:
        VERSION_WARNING = True
        raise DialogException('CodeGrinder upgrade recommended',
            f'This is version {__version__} of the CodeGrinder plugin, ' +
            f'but the server recommends {server.thonnyVersionRecommended} or higher.\n\n' +
            'Please upgrade as soon as possible\n\n' +
            'To upgrade:\n' +
            '1. Select the menu item "Tools" -> "Manage plug-ins..."\n' +
            '2. Find "thonny-codegrinder-plugin" in the list on the left and click on it\n' +
            '3. Click the "Upgrade" button at the bottom\n' +
            '4. After it finishes upgrading, quit Thonny and restart it',
            True)

# send an API request and gather the result
# returns (result object, error string)
def do_request(path, params, method, upload=None, notfoundokay=False):
    if not path.startswith('/'):
        raise TypeError('do_request path must start with /')

    if method not in ('GET', 'POST', 'PUT', 'DELETE'):
        raise TypeError('do_request only recognizes GET, POST, PUT, and DELETE methods')

    url = f'https://{CONFIG["host"]}{urlPrefix}{path}'
    (ck, cv) = CONFIG['cookie'].split('=', 1)
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
        raise DialogException('Unexpected status from server',
            f'Received unexpected status from {url}:\n\n{resp.text}')

    return json.loads(resp.content.decode(encoding='utf-8'))

def must_get_named_tuple(path, params):
    elt = do_request(path, params, 'GET', notfoundokay=True)
    if elt is None:
        raise DialogException('Server error',
            'Unable to download a needed object from the server. ' +
            'Please make sure your internet connection is working.\n\n' +
            f'URL was {path}')
    return collections.namedtuple('x', elt.keys())(**elt)

def must_get_named_tuple_list(path, params):
    lst = do_request(path, params, 'GET')
    if lst is None:
        raise DialogException('Server error',
            'Unable to download a needed object from the server. ' +
            'Please make sure your internet connection is working.\n\n' +
            f'URL was {path}')
    return [ collections.namedtuple('x', elt.keys())(**elt) for elt in lst ]

def get_named_tuple(path, params):
    elt = do_request(path, params, 'GET', notfoundokay=True)
    if elt is None:
        return None
    return collections.namedtuple('x', elt.keys())(**elt)

def must_get_object(path, params):
    return do_request(path, params, 'GET')

def get_object(path, params):
    return do_request(path, params, 'GET', notfoundokay=True)

def must_post_object(path, params, upload):
    return do_request(path, params, 'POST', upload=upload)

def must_put_object(path, params, upload):
    return do_request(path, params, 'PUT', upload=upload)

def course_directory(label):
    match = re.match(r'^([A-Za-z]+[- ]*\d+\w*)\b', label)
    if match:
        return match.group(1)
    else:
        return label

def get_assignment(assignment, course, rootDir):
    # get the problem set
    problemSet = must_get_named_tuple(f'/problem_sets/{assignment.problemSetID}', None)

    # if the target directory exists, skip this assignment
    rootDir = os.path.join(rootDir, course_directory(course.label), problemSet.unique)
    if os.path.exists(rootDir):
        return None

    # get the list of problems in the problem set
    problemSetProblems = must_get_named_tuple_list(f'/problem_sets/{assignment.problemSetID}/problems', None)

    # for each problem get the problem, the most recent commit (or create one),
    # and the corresponding step
    commits = {}
    infos = {}
    problems = {}
    steps = {}
    types = {}
    for elt in problemSetProblems:
        problem = must_get_named_tuple(f'/problems/{elt.problemID}', None)
        problems[problem.unique] = problem

        # get the problem type if we do not already have it
        if problem.problemType not in types:
            problemType = must_get_named_tuple(f'/problem_types/{problem.problemType}', None)
            types[problem.problemType] = problemType

        # get the commit and create a problem info based on it
        commit = get_object(f'/assignments/{assignment.id}/problems/{problem.id}/commits/last', None)
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
        step = must_get_named_tuple(f'/problems/{problem.id}/steps/{info["step"]}', None)
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
            path = os.path.join(target, from_slash(name))
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
                path = os.path.join(target, from_slash(name))
                with open(path, 'wb') as fp:
                    fp.write(base64.b64decode(contents, validate=True))

            # does this commit indicate the step was finished and needs to advance?
            if 'reportCard' in commit and commit['reportCard'] and \
                    commit['reportCard']['passed'] is True and commit['score'] == 1.0:
                next_step(target, infos[unique], problem, commit)

        # save any problem type files
        problemType = types[problem.problemType]
        for (name, contents) in problemType.files.items():
            path = os.path.join(target, from_slash(name))
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
    save_dot_file(dotfile)

    return os.path.join(course_directory(course.label), problemSet.unique)

def next_step(directory, info, problem, commit):
    # log.Printf("step %d passed", commit['step'])

    # advance to the next step
    newStep = get_named_tuple(f'/problems/{problem.id}/steps/{commit["step"]+1}', None)
    if newStep is None:
        return False
    oldStep = must_get_named_tuple(f'/problems/{problem.id}/steps/{commit["step"]}', None)
    if oldStep is None:
        return False
    # log.Printf("moving to step %d", newStep.Step)

    # delete all the files from the old step
    if len(oldStep.instructions) > 0:
        name = os.path.join('doc', 'index.html')
        path = os.path.join(directory, name)
        if os.path.exists(path):
            os.remove(path)
    for name in oldStep.files.keys():
        if os.path.dirname(from_slash(name)) == '':
            continue
        path = os.path.join(directory, from_slash(name))
        os.remove(path)
        dirpath = os.path.dirname(path)
        try:
            # ignore errors--the directory may not be empty
            os.rmdir(dirpath)
        except (FileNotFoundError, OSError):
            pass
    for (name, contents) in newStep.files.items():
        path = os.path.join(directory, from_slash(name))
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

def save_dot_file(dotfile):
    path = dotfile['path']
    del dotfile['path']
    with open(path, 'w') as fp:
        json.dump(dotfile, fp, indent=4)
        fp.write('\n')
    dotfile['path'] = path

def gather_student(now, startDir):
    # find the .grind file containing the problem set info
    (dotfile, problemSetDir, problemDir) = find_dot_file(startDir)

    # get the assignment
    assignment = must_get_named_tuple(f'/assignments/{dotfile["assignmentID"]}', None)

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
    problem = must_get_named_tuple(f'/problems/{info["id"]}', None)

    # check that the on-disk file matches the expected contents
    # and update as needed
    def check_and_update(name, contents):
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
    problemType = must_get_named_tuple(f'/problem_types/{problem.problemType}', None)
    for (name, contents) in problemType.files.items():
        check_and_update(from_slash(name), base64.b64decode(contents, validate=True))

    # get the problem step and verify local files match
    step = must_get_named_tuple(f'/problems/{problem.id}/steps/{info["step"]}', None)
    for (name, contents) in step.files.items():
        if os.path.dirname(from_slash(name)) == '':
            # in main directory, skip files that exist (but write files that are missing)
            path = os.path.join(problemDir, name)
            if os.path.exists(path):
                continue
        check_and_update(from_slash(name), base64.b64decode(contents, validate=True))
    check_and_update(os.path.join('doc', 'index.html'), step.instructions.encode())

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

def must_confirm_commit_bundle(bundle, args, bar):
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
        bar.show_progress()

        reply = json.loads(socket.recv())

        if 'error' in reply and reply['error']:
            socket.close()
            raise DialogException('Server error',
                'The server reported an unexpected error:\n\n' +
                f'{reply["error"]}')

        if 'commitBundle' in reply and reply['commitBundle']:
            socket.close()
            return reply['commitBundle']

        if 'event' in reply and reply['event']:
            # ignore the streamed data
            pass

        else:
            socket.close()
            raise DialogException('Server error',
                'The server returned an unexpected message type.')

    socket.close()
    raise DialogException('No result returned from server',
        'The server did not return the graded code, ' +
        'so the grading process cannot continue.')

# returns (filename, dotfile, problemSetDir, problemDir)
def get_codegrinder_project_info():
    notebook = thonny.get_workbench().get_editor_notebook()

    current = notebook.get_current_editor()
    if not current:
        raise DialogException('Not a CodeGrinder project',
                'This command should only be run when editing ' +
                'a file that is part of a CodeGrinder assignment.')
    filename = current.get_filename()
    if not filename:
        raise DialogException('Not a CodeGrinder project',
                'This command should only be run when editing ' +
                'a file that is part of a CodeGrinder assignment.')
    filename = os.path.realpath(filename)

    # see if this file is part of a codegrinder project
    (dotfile, problemSetDir, problemDir) = find_dot_file(os.path.dirname(filename))
    if len(dotfile['problems']) == 1:
        problemDir = problemSetDir

    return (os.path.basename(filename), dotfile, problemSetDir, problemDir)

def find_dot_file(startDir):
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
            raise DialogException('Not a CodeGrinder project',
                'This command should only be run when editing ' +
                'a file that is part of a CodeGrinder assignment.')

    # read the .grind file
    with open(path) as fp:
        dotfile = json.load(fp)
    dotfile['path'] = path

    return (dotfile, problemSetDir, problemDir)

def dump_event_message(e):
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
