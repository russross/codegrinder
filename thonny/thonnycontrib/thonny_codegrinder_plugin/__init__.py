'''Thonny plugin to integrate with CodeGrinder for coding practice'''

__version__ = '2.6.2'

import base64
import collections
from dataclasses import dataclass
from dataclasses_json.api import DataClassJsonMixin
import datetime
import glob
import gzip
import json
import os
import os.path
import re
import requests
import shlex
import thonny
import thonny.common
import tkinter.messagebox
import tkinter.simpledialog
import tkinter.ttk
import tkinterhtml
from typing import List, Dict, Tuple, Optional, Any
import websocket

#
# inject the CodeGrinder menu items into Thonny
#

def load_plugin() -> None:
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
    wb.add_command(command_id='CodeGrinder-reset',
                   menu_name='CodeGrinder',
                   command_label='Reset to beginning of current step...',
                   tester=_codegrinder_in_project,
                   handler=_codegrinder_reset_handler,
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

def _codegrinder_login_enabled() -> bool:
    try:
        check_config_file_present()
        return False
    except SilentException:
        return True
    except DialogException:
        return False

def _codegrinder_logout_enabled() -> bool:
    try:
        check_config_file_present()
        return True
    except SilentException:
        return False
    except DialogException:
        return False

def _codegrinder_in_project() -> bool:
    try:
        check_config_file_present()
        get_codegrinder_project_info()
        return True
    except SilentException:
        return False
    except DialogException:
        return False

def _codegrinder_run_tests_enabled() -> bool:
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

def _codegrinder_login_handler() -> None:
    global CONFIG
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
        CONFIG.host = fields[2]
        session: Optional[Session] = get_object('/users/session', {'key':fields[3]}, Session)
        if session is None:
            raise DialogException('Login failed',
                'Make sure you use a fresh login code (no more than 5 minutes old).')

        # set up config
        CONFIG.cookie = session.cookie

        # see if they need an upgrade
        check_version()

        # try it out by fetching a user record
        user: User = must_get_object('/users/me', None, User)

        # save config for later use
        must_write_config()

        tkinter.messagebox.showinfo('Login successful',
            f'Login successful; welcome {user.name}',
            master=thonny.get_workbench())

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_logout_handler() -> None:
    try:
        home = get_home()
        configFile = os.path.join(home, perUserDotFile)
        os.remove(configFile)
        tkinter.messagebox.showinfo('Logged out',
            'Note that when you are on your own machine '+
            'or are logged into your own account, '+
            'you can normally leave yourself logged in '+
            'for the entire semester',
            master=thonny.get_workbench())
    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_show_instructions_handler() -> None:
    try:
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()
        show_instructions(problemDir)
    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def show_instructions(problemDir: str) -> None:
    with open(os.path.join(problemDir, 'doc', 'index.html'), 'rb') as fp:
        doc = fp.read()

    iv = thonny.get_workbench().get_view('HtmlFrame')
    iv.set_content(doc)
    thonny.get_workbench().show_view('HtmlFrame', set_focus=False)

def _codegrinder_run_tests_handler() -> None:
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
            count = 0
            py_files = [ os.path.basename(s) for s in glob.glob(f'{problemDir}/*.py')]
            for name in py_files:
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

def _codegrinder_download_handler() -> None:
    try:
        home = get_home()
        must_load_config()
        user: User = must_get_object('/users/me', None, User)
        assignments: List[Assignment] = must_get_object_list(f'/users/{user.id}/assignments', None, Assignment)
        if len(assignments) == 0:
            tkinter.messagebox.showinfo('No assignments found',
                'Remember that you must click on each assignment in Canvas once ' +
                'before you can access it here.',
                master=thonny.get_workbench())
            return

        # cache the course downloads
        courses: Dict[int, Course] = {}

        downloads: List[str] = []
        for assignment in assignments:
            # ignore quizzes
            if assignment.problemSetID <= 0:
                continue

            # get the course
            if assignment.courseID not in courses:
                courses[assignment.courseID] = must_get_object(f'/courses/{assignment.courseID}', None, Course)
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
                'and are ready to start working on it.',
                master=thonny.get_workbench())
        else:
            msg = f'Downloaded {len(downloads)} new assignment{"" if len(downloads) == 1 else "s"}'
            if len(downloads) > 0:
                msg += ':\n\n' + '\n'.join(downloads)
            tkinter.messagebox.showinfo('Assignments downloaded', msg,
                master=thonny.get_workbench())

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_save_and_sync_handler() -> None:
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        user: User = must_get_object('/users/me', None, User)

        (problemType, problem, assignment, commit, dotfile) = gather_student(now, problemDir)
        commit.action = ''
        commit.note = 'thonny plugin save'
        unsigned = {
            'userID': user.id,
            'commit': commit.to_dict(),
        }
        signed = must_post_commit_bundle('/commit_bundles/unsigned', None, unsigned)

        msg = 'A copy of your current work has been saved '
        msg += 'to the CodeGrinder server where your instructor '
        msg += 'can access it.\n\n'
        msg += 'You should always select this option '
        msg += 'before contacting your instructor for help.'
        tkinter.messagebox.showinfo('Saved successfully', msg,
            master=thonny.get_workbench())

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_reset_handler() -> None:
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        user: User = must_get_object('/users/me', None, User)

        (problemType, problem, assignment, _, dotfile) = gather_student(now, problemDir)
        info = dotfile.problems[problem.unique]

        step: ProblemStep = must_get_object(f'/problems/{problem.id}/steps/{info.step}', None, ProblemStep)

        # gather all the files that make up this step
        files: Dict[str, bytes] = {}

        # get the commit from the previous step if applicable
        if info.step > 1:
            commit: Commit = must_get_object(f'/assignments/{assignment.id}/problems/{problem.id}/steps/{info.step - 1}/commits/last', None, Commit)
            if commit.files:
                for (name, contents) in commit.files.items():
                    files[from_slash(name)] = decode64(contents)

        # commit files may be overwritten by new step files
        for (name, contents) in step.files.items():
            files[from_slash(name)] = decode64(contents)
        files[os.path.join('doc', 'index.html')] = step.instructions.encode()
        for (name, contents) in problemType.files.items():
            files[from_slash(name)] = decode64(contents)

        # report which files have changed since the step started
        changed: List[str] = []
        for name in step.whitelist.keys():
            if name not in files:
                # not good: file on the whitelist but not in the file set
                continue

            expected = files[name]
            path = os.path.join(problemDir, from_slash(name))
            if not os.path.exists(path):
                # file is missing; leave it on the list and it will be restored
                changed.append(name)
            else:
                with open(path, 'rb') as fp:
                    ondisk = fp.read()
                if ondisk != expected:
                    changed.append(name)

        if len(changed) == 0:
            tkinter.messagebox.showinfo('No files have been changed',
                'No files have been changed since the beginning of the current step.',
                master=thonny.get_workbench())
            return

        file_list = '\n'.join(changed)
        answer: bool = tkinter.messagebox.askokcancel('Are you sure?',
            f'Any changes you have made in the following files will be overwritten:\n\n{file_list}\n\n'+
            f'Do you wish to continue?',
            master=thonny.get_workbench())

        if answer:
            update_files(problemDir, files, {})

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_progress_handler() -> None:
    try:
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        # get the assignment
        assignment: Assignment = must_get_object(f'/assignments/{dotfile.assignmentID}', None, Assignment)

        # get the course
        course: Course = must_get_object(f'/courses/{assignment.courseID}', None, Course)

        # get the problems
        problem_set: ProblemSet = must_get_object(f'/problem_sets/{assignment.problemSetID}', None, ProblemSet)
        problem_set_problems: List[ProblemSetProblem] = must_get_object_list(f'/problem_sets/{assignment.problemSetID}/problems', None, ProblemSetProblem)
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
            problem: Problem = must_get_object(f'/problems/{psp.problemID}', None, Problem)
            msg += f'[*] {problem.note}\n'
            if len(problem_set_problems) > 1:
                msg += f'    Location: {problem.unique}\n'

            # get the steps
            steps: List[ProblemStep] = must_get_object_list(f'/problems/{problem.id}/steps', None, ProblemStep)
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

        tkinter.messagebox.showinfo('Assignment progress report', msg,
            master=thonny.get_workbench())

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

def _codegrinder_grade_handler() -> None:
    bar: Optional[Progress] = None
    try:
        thonny.get_workbench().get_editor_notebook().save_all_named_editors()
        (filename, dotfile, problemSetDir, problemDir) = get_codegrinder_project_info()

        must_load_config()
        now = datetime.datetime.utcnow()

        # get the user ID
        user: User = must_get_object('/users/me', None, User)

        (problemType, problem, assignment, commit, dotfile) = gather_student(now, problemDir)
        commit.action = 'grade'
        commit.note = 'thonny plugin grade'
        unsigned = {
            'userID': user.id,
            'commit': commit.to_dict(),
        }

        # send the commit bundle to the server
        signed = must_post_commit_bundle('/commit_bundles/unsigned', None, unsigned)
        if not signed.hostname:
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
            'hostname':         graded.hostname,
            'userID':           graded.userID,
            'commit':           graded.commit.to_dict(),
            'commitSignature':  graded.commitSignature,
        }
        saved = must_post_commit_bundle('/commit_bundles/signed', None, toSave)
        commit = saved.commit

        shell = thonny.get_workbench().get_view('ShellView')
        shell.clear_shell()
        if commit.reportCard and commit.reportCard.passed is True and commit.score == 1.0:

            # peek ahead to see if there is another step
            newStep: Optional[ProblemStep] = get_object(f'/problems/{problem.id}/steps/{commit.step+1}', None, ProblemStep)
            if newStep is not None:
                tkinter.messagebox.showinfo('Step complete',
                    'You have completed this step successfully ' +
                    'and your updated grade was submitted to Canvas.\n\n' +
                    'This problem has another step, so the files and instructions ' +
                    'will now be updated for the next step.\n\n' +
                    'Thonny may notice that files are changing and prompt you to see ' +
                    'if you want to update to the "External Modification".\n\n' +
                    'You should select "Yes" if you see that prompt.',
                    master=thonny.get_workbench())

                if next_step(problemDir, dotfile.problems[problem.unique], problem, commit, {problemType.name: problemType}, newStep):
                    # save the updated dotfile with the new step number
                    save_dot_file(dotfile)

                    step = commit.step
                    msg = f'reportCard = "Completed step {step}, moving on to step {step+1}"\n'
                    shell.submit_python_code(msg)

                    show_instructions(problemDir)
            else:
                msg = 'reportCard = "You have completed this problem successfully ' + \
                    'and your updated grade was submitted to Canvas"\n'
                shell.submit_python_code(msg)

        else:
            # solution failed
            def escape(s: str) -> str:
                return s.replace('"""', '\\"\\"\\"')

            msg = 'reportCard = """\n'
            # play the transcript
            if commit.transcript and len(commit.transcript) > 0:
                for elt in commit.transcript:
                    msg += escape(dump_event_message(elt))

            if commit.reportCard:
                msg += '\n\n'
                msg += escape(commit.reportCard.note)

            msg += '\n"""\n'
            shell.submit_python_code(msg)

    except SilentException:
        pass
    except DialogException as dialog:
        dialog.show_dialog()

    if bar:
        bar.stop()

#
# Object types, mainly mirroring the server object types
#

@dataclass
class Config(DataClassJsonMixin):
    host:   str
    cookie: str

@dataclass
class Info(DataClassJsonMixin):
    id:     int
    step:   int

@dataclass
class DotFile(DataClassJsonMixin):
    assignmentID:   int
    problems:       Dict[str, Info]
    path:           str = ''


@dataclass
class Version(DataClassJsonMixin):
    version:                    str
    grindVersionRequired:       str
    grindVersionRecommended:    str
    thonnyVersionRequired:      str
    thonnyVersionRecommended:   str

@dataclass
class Session(DataClassJsonMixin):
    cookie: str

@dataclass
class ProblemTypeAction(DataClassJsonMixin):
    problemType:    str = ''
    action:         str = ''
    command:        str = ''
    parser:         str = ''
    message:        str = ''
    interactive:    bool = False
    maxCPU:         int = 0
    maxSession:     int = 0
    maxTimeout:     int = 0
    maxFD:          int = 0
    maxFileSize:    int = 0
    maxMemory:      int = 0
    maxThreads:     int = 0

@dataclass
class ProblemType(DataClassJsonMixin):
    name:       str
    image:      str
    files:      Dict[str, str]
    actions:    Dict[str, ProblemTypeAction]

@dataclass
class Problem(DataClassJsonMixin):
    id:             int
    unique:         str
    note:           str
    tags:           List[str]
    options:        List[str]
    createdAt:      str
    updatedAt:      str

@dataclass
class ProblemStep(DataClassJsonMixin):
    problemID:      int
    step:           int
    problemType:    str
    note:           str
    instructions:   str
    weight:         float
    files:          Dict[str, str]
    whitelist:      Dict[str, bool]
    solution:       Optional[Dict[str, str]] = None

@dataclass
class ProblemSet(DataClassJsonMixin):
    id:         int
    unique:     str
    note:       str
    tags:       List[str]
    createdAt:  str
    updatedAt:  str

@dataclass
class ProblemSetProblem(DataClassJsonMixin):
    problemSetID:   int
    problemID:      int
    weight:         float

@dataclass
class Course(DataClassJsonMixin):
    id:         int
    name:       str
    label:      str
    ltiID:      str
    canvasID:   int
    createdAt:  str
    updatedAt:  str

@dataclass
class User(DataClassJsonMixin):
    id:                 int
    name:               str
    email:              str
    ltiID:              str
    imageURL:           str
    canvasLogin:        str
    canvasID:           int
    author:             bool
    admin:              bool
    createdAt:          str
    updatedAt:          str
    lastSignedInAt:     str

@dataclass
class Assignment(DataClassJsonMixin):
    id:             int
    courseID:       int
    problemSetID:   int
    userID:         int
    roles:          str
    instructor:     bool
    rawScores:      Dict[str, List[float]]
    score:          float
    canvasTitle:    str
    canvasID:       int
    consumerKey:    str
    unlockAt:       Optional[str] = None
    dueAt:          Optional[str] = None
    lockAt:         Optional[str] = None
    createdAt:      str = ''
    updatedAt:      str = ''

@dataclass
class ReportCardResult(DataClassJsonMixin):
    name:       str = ''
    outcome:    str = ''
    details:    str = ''
    context:    str = ''

@dataclass
class ReportCard(DataClassJsonMixin):
    passed:     bool = False
    note:       str = ''
    duration:   str = ''
    results:    Optional[List[ReportCardResult]] = None

@dataclass
class EventMessage(DataClassJsonMixin):
    time:           str = ''
    event:          str = ''
    execCommand:    Optional[List[str]] = None
    exitStatus:     Optional[int] = None
    streamData:     Optional[str] = None
    error:          Optional[str] = None
    reportCard:     Optional[ReportCard] = None
    files:          Optional[Dict[str, str]] = None

@dataclass
class Commit(DataClassJsonMixin):
    id:             int = 0
    assignmentID:   int = 0
    problemID:      int = 0
    step:           int = 0
    action:         str = ''
    note:           str = ''
    files:          Optional[Dict[str, str]] = None
    transcript:     Optional[List[EventMessage]] = None
    reportCard:     Optional[ReportCard] = None
    score:          float = 0.0
    createdAt:      str = ''
    updatedAt:      str = ''

@dataclass
class CommitBundle(DataClassJsonMixin):
    problemType:            ProblemType
    problemTypeSignature:   str
    problem:                Problem
    problemSteps:           List[ProblemStep]
    problemSignature:       str
    action:                 str
    hostname:               str
    userID:                 int
    commit:                 Commit
    commitSignature:        str


# constants
perUserDotFile = '.codegrinderrc'
perProblemSetDotFile = '.grind'
urlPrefix = '/v2'

CONFIG = Config('', 'codegrinder=not_logged_in')
VERSION_WARNING = False

class SilentException(Exception):
    pass

class DialogException(Exception):
    def __init__(self, title: str, message: str, warning: bool = False):
        self.title = title
        self.message = message
        self.warning = warning

    def show_dialog(self) -> None:
        if self.warning:
            tkinter.messagebox.showwarning(self.title, self.message, master=thonny.get_workbench())
        else:
            tkinter.messagebox.showerror(self.title, self.message, master=thonny.get_workbench())

class Progress(tkinter.simpledialog.SimpleDialog):
    def __init__(self, parent: tkinter.Tk):
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

    def show_progress(self) -> None:
        if self.active:
            self.bar.step(10)
            self.parent.update_idletasks()

    def stop(self) -> None:
        if self.active:
            self.root.destroy()
            self.active = False

#
# The rest are helper functions, mostly ported from the grind CLI tool
#

def from_slash(name: str) -> str:
    parts = name.split('/')
    return os.path.join(*parts)

def get_home() -> str:
    home = os.path.expanduser('~')
    if home == '':
        raise DialogException('Fatal error', 'Unable to locate home directory, giving up')
    return home

def must_load_config() -> None:
    global CONFIG

    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    with open(configFile) as fp:
        CONFIG = Config.from_json(fp.read())

    check_version()

def check_config_file_present() -> None:
    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    if not os.path.exists(configFile):
        raise SilentException()

def must_write_config() -> None:
    global CONFIG

    home = get_home()
    configFile = os.path.join(home, perUserDotFile)
    with open(configFile, 'w') as fp:
        print(CONFIG.to_json(indent=4), file=fp)

def version_tuple(s: str) -> Tuple[int, ...]:
    return tuple(int(elt) for elt in s.split('.'))

def check_version() -> None:
    global VERSION_WARNING
    server: Version = must_get_object('/version', None, Version)
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
def do_request(path: str, params: Optional[Dict[str, Any]], method: str, upload: str='', notfoundokay: bool=False) -> Any:
    global CONFIG
    if not path.startswith('/'):
        raise TypeError('do_request path must start with /')

    if method not in ('GET', 'POST', 'PUT', 'DELETE'):
        raise TypeError('do_request only recognizes GET, POST, PUT, and DELETE methods')

    url = f'https://{CONFIG.host}{urlPrefix}{path}'
    (ck, cv) = CONFIG.cookie.split('=', 1)
    headers = {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
    }
    data = None
    if upload != '' and method in ('POST', 'PUT'):
        headers['Content-Type'] = 'application/json'
        headers['Content-Encoding'] = 'gzip'
        data = upload.encode('utf-8')

    resp = requests.request(method, url, params=params, data=data, cookies={ck: cv})

    if notfoundokay and resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise DialogException('Unexpected status from server',
            f'Received unexpected status from {url}:\n\n{resp.text}')

    return json.loads(resp.content.decode(encoding='utf-8'))

def must_get_object_list(path: str, params: Optional[Dict[str, Any]], type_class: Any) -> List[Any]:
    lst = do_request(path, params, 'GET')
    if lst is None:
        raise DialogException('Server error',
            'Unable to download a needed object from the server. ' +
            'Please make sure your internet connection is working.\n\n' +
            f'URL was {path}')
    return [ type_class.from_dict(elt) for elt in lst ]

def must_get_object(path: str , params: Optional[Dict[str, Any]], type_class: Any) -> Any:
    elt = do_request(path, params, 'GET')
    if elt is None:
        raise DialogException('Server error',
            'Unable to download a needed object from the server. ' +
            'Please make sure your internet connection is working.\n\n' +
            f'URL was {path}')
    return type_class.from_dict(elt)

def get_object(path: str, params: Optional[Dict[str, Any]], type_class: Any) -> Optional[Any]:
    elt = do_request(path, params, 'GET', notfoundokay=True)
    return type_class.from_dict(elt) if elt is not None else None

def must_post_commit_bundle(path: str, params: Optional[Dict[str, Any]], upload: Dict[str, Any]) -> CommitBundle:
    elt = do_request(path, params, 'POST', upload=json.dumps(upload))
    if elt is None:
        raise DialogException('Server error',
            'Unable to download a needed object from the server. ' +
            'Please make sure your internet connection is working.\n\n' +
            f'URL was {path}')
    bundle: CommitBundle = CommitBundle.from_dict(elt)
    return bundle

def course_directory(label: str) -> str:
    match = re.match(r'^([A-Za-z]+[- ]*\d+\w*)\b', label)
    if match:
        return match.group(1)
    else:
        return label

def get_assignment(assignment: Assignment, course: Course, rootDir: str) -> Optional[str]:
    # get the problem set
    problemSet: ProblemSet = must_get_object(f'/problem_sets/{assignment.problemSetID}', None, ProblemSet)

    # if the target directory exists, skip this assignment
    rootDir = os.path.join(rootDir, course_directory(course.label), problemSet.unique)
    if os.path.exists(rootDir):
        return None

    # get the list of problems in the problem set
    problemSetProblems: List[ProblemSetProblem] = must_get_object_list(f'/problem_sets/{assignment.problemSetID}/problems', None, ProblemSetProblem)

    # for each problem get the problem, the most recent commit (or create one),
    # and the corresponding step
    commits = {}
    infos = {}
    problems = {}
    steps = {}
    types = {}
    for elt in problemSetProblems:
        problem: Problem = must_get_object(f'/problems/{elt.problemID}', None, Problem)
        problems[problem.unique] = problem

        # get the commit and create a problem info based on it
        commit: Optional[Commit] = get_object(f'/assignments/{assignment.id}/problems/{problem.id}/commits/last', None, Commit)
        if commit is not None:
            info = Info(problem.id, commit.step)
        else:
            # if there is no commit for this problem, we're starting from step one
            commit = None
            info = Info(problem.id, 1)

        step: ProblemStep = must_get_object(f'/problems/{problem.id}/steps/{info.step}', None, ProblemStep)
        infos[problem.unique] = info
        commits[problem.unique] = commit
        steps[problem.unique] = step

        # get the problem type if we do not already have it
        if step.problemType not in types:
            problemType: ProblemType = must_get_object(f'/problem_types/{step.problemType}', None, ProblemType)
            types[step.problemType] = problemType

    for unique in steps.keys():
        commit, problem, step = commits[unique], problems[unique], steps[unique]

        # if there is only one problem in the set, use the main directory
        target = rootDir
        if len(steps) > 1:
            target = os.path.join(rootDir, unique)

        # save the step files
        files: Dict[str, bytes] = {}
        for (name, contents) in step.files.items():
            files[from_slash(name)] = decode64(contents)
        files[os.path.join('doc', 'index.html')] = step.instructions.encode()

        # step files may be overwritten by commit files
        if commit is not None and commit.files is not None:
            for (name, contents) in commit.files.items():
                files[from_slash(name)] = decode64(contents)

        # save any problem type files
        for (name, contents) in types[step.problemType].files.items():
            files[from_slash(name)] = decode64(contents)

        update_files(target, files, {})

    # does this commit indicate the step was finished and needs to advance?
    if commit is not None and commit.reportCard and commit.reportCard.passed is True and commit.score == 1.0:
        next_step(target, infos[unique], problem, commit, types, None)

    save_dot_file(DotFile(assignment.id, infos, os.path.join(rootDir, perProblemSetDotFile)))

    return os.path.join(course_directory(course.label), problemSet.unique)

def decode64(contents: str) -> bytes:
    return base64.b64decode(contents, validate=True)

def encode64(contents: bytes) -> str:
    return base64.b64encode(contents).decode()

def next_step(directory: str, info: Info, problem: Problem, commit: Commit, types: Dict[str, ProblemType], newStep: Optional[ProblemStep]) -> bool:
    # log.Printf("step %d passed", commit['step'])

    # advance to the next step
    if newStep is None:
        newStep = get_object(f'/problems/{problem.id}/steps/{commit.step+1}', None, ProblemStep)
        if newStep is None:
            return False
    oldStep: ProblemStep = must_get_object(f'/problems/{problem.id}/steps/{commit.step}', None, ProblemStep)
    # log.Printf("moving to step %d", newStep.Step)

    if oldStep.problemType not in types:
        oldType: ProblemType = must_get_object(f'/problem_types/{oldStep.problemType}', None, ProblemType)
        if oldType is None:
            return False
        types[oldStep.problemType] = oldType
    if newStep.problemType not in types:
        newType: ProblemType = must_get_object(f'/problem_types/{newStep.problemType}', None, ProblemType)
        if newType is None:
            return False
        types[newStep.problemType] = newType

    # gather all the files for the new step
    files: Dict[str, bytes] = {}
    if commit.files is not None:
        for (name, contents) in commit.files.items():
            files[from_slash(name)] = decode64(contents)

    # commit files may be overwritten by new step files
    for (name, contents) in newStep.files.items():
        files[from_slash(name)] = decode64(contents)
    files[os.path.join('doc', 'index.html')] = newStep.instructions.encode()
    for (name, contents) in types[newStep.problemType].files.items():
        files[from_slash(name)] = decode64(contents)

    # files from the old problem type and old step may need to be removed
    oldFiles: Dict[str, bool] = {}
    for name in types[oldStep.problemType].files.keys():
        oldFiles[from_slash(name)] = True
    for name in oldStep.files.keys():
        oldFiles[from_slash(name)] = True

    update_files(directory, files, oldFiles)

    info.step += 1
    return True

def save_dot_file(dotfile: DotFile) -> None:
    with open(dotfile.path, 'w') as fp:
        as_dict = dotfile.to_dict()
        del as_dict['path']
        json.dump(as_dict, fp, indent=4)
        fp.write('\n')

def update_files(directory: str, files: Dict[str, bytes], oldFiles: Dict[str, bool]) -> None:
    for (name, contents) in files.items():
        path = os.path.join(directory, name)
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

    for name in oldFiles.keys():
        if name in files:
            continue
        path = os.path.join(directory, name)
        if os.path.exists(path):
            os.remove(path)
        dirpath = os.path.dirname(name)
        if dirpath != '':
            try:
                # ignore errors--the directory may not be empty
                os.rmdir(os.path.join(directory, dirpath))
            except (FileNotFoundError, OSError):
                pass

def gather_student(now: datetime.datetime, startDir: str) -> Tuple[ProblemType, Problem, Assignment, Commit, DotFile]:
    # find the .grind file containing the problem set info
    (dotfile, problemSetDir, problemDir) = find_dot_file(startDir)

    # get the assignment
    assignment: Assignment = must_get_object(f'/assignments/{dotfile.assignmentID}', None, Assignment)

    # get the problem
    unique = ''
    if len(dotfile.problems) == 1:
        # only one problem? files should be in dotfile directory
        for u in dotfile.problems:
            unique = u
        problemDir = problemSetDir
    else:
        # use the subdirectory name to identify the problem
        if problemDir == '':
            raise RuntimeError('unable to identify which problem this file is part of')
        unique = os.path.basename(problemDir)
    info = dotfile.problems[unique]
    if not info:
        raise RuntimeError('unable to recognize the problem based on the directory name of ' + unique)
    problem: Problem = must_get_object(f'/problems/{info.id}', None, Problem)

    # get the problem step
    step: ProblemStep = must_get_object(f'/problems/{problem.id}/steps/{info.step}', None, ProblemStep)

    # get the problem type and verify local files match
    problemType: ProblemType = must_get_object(f'/problem_types/{step.problemType}', None, ProblemType)

    # make sure all step and problemtype files are up to date
    stepFiles: Dict[str, bytes] = {}
    for (name, contents) in step.files.items():
        # do not overwrite student files
        if name not in step.whitelist:
            stepFiles[from_slash(name)] = decode64(contents)
    for (name, contents) in problemType.files.items():
        stepFiles[from_slash(name)] = decode64(contents)
    stepFiles[os.path.join('doc', 'index.html')] = step.instructions.encode()
    update_files(problemDir, stepFiles, {})

    # gather the commit files from the file system
    files: Dict[str, str] = {}
    missing: List[str] = []
    for name in step.whitelist.keys():
        path = os.path.join(problemDir, from_slash(name))
        if not os.path.exists(path):
            missing.append(name)
            continue
        with open(path, 'rb') as fp:
            files[name] = encode64(fp.read())
    if len(missing) > 0:
        msg = 'Could not find all expected files:\n\n' + '\n'.join(missing)
        raise DialogException('Missing files', msg)

    # form a commit object
    commit = Commit(
        id=0,
        assignmentID=dotfile.assignmentID,
        problemID=info.id,
        step=info.step, 
        action='',
        note='',
        files=files,
        transcript=None,
        reportCard=None,
        score=0.0,
        createdAt=now.isoformat() + 'Z',
        updatedAt=now.isoformat() + 'Z')

    return (problemType, problem, assignment, commit, dotfile)

def must_confirm_commit_bundle(bundle: CommitBundle, args: Optional[List[str]], bar: Progress) -> CommitBundle:
    # create a websocket connection to the server
    url = 'wss://' + bundle.hostname + urlPrefix + '/sockets/' + \
        bundle.problemType.name + '/' + bundle.commit.action
    socket = websocket.create_connection(url)

    # form the initial request
    req = {
        'commitBundle': bundle.to_dict(),
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
            result: CommitBundle = CommitBundle.from_dict(reply['commitBundle'])
            return result

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
def get_codegrinder_project_info() -> Tuple[str, DotFile, str, str]:
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
    if len(dotfile.problems) == 1:
        problemDir = problemSetDir

    return (os.path.basename(filename), dotfile, problemSetDir, problemDir)

def find_dot_file(startDir: str) -> Tuple[DotFile, str, str]:
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
        as_dict = json.loads(fp.read())
        as_dict['path'] = path
        dotfile = DotFile.from_dict(as_dict)

    return (dotfile, problemSetDir, problemDir)

def dump_event_message(e: EventMessage) -> str:
    if e.event == 'exec' and e.execCommand is not None:
        return f'$ {" ".join(e.execCommand)}\n'

    if e.event == 'exit' and e.exitStatus is not None:
        if e.exitStatus == 0:
            return ''

        n = e.exitStatus - 128
        if n in signals:
            sig = signals[n]
            return f'exit status {e.exitStatus} (killed by {sig})\n'

        return f'exit status {e.exitStatus}\n'

    if e.event in ('stdin', 'stdout', 'stderr') and e.streamData is not None:
        return base64.b64decode(e.streamData, validate=True).decode('utf-8')

    if e.event == 'error':
        return f'Error: {e.error}\n'

    return ''

signals: Dict[int, str] = {
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
