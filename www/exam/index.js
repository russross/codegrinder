
const { CodeGrinderServicePromiseClient } = require('./codegrinder_grpc_web_pb');
const {
    GetUserMeRequest,
    GetAssignmentRequest,
    GetProblemSetProblemsRequest,
    GetProblemRequest,
    GetProblemStepRequest,
    GetProblemTypeRequest,
    GetAssignmentProblemCommitLastRequest,
    Commit,
    CommitBundle,
    PostCommitBundlesUnsignedRequest,
    PostCommitBundlesSignedRequest,
    DaycareRequest,
    ReportCard,
    ProblemType,
    Problem,
    ProblemStep
} = require('./codegrinder_pb');
const { Timestamp } = require('google-protobuf/google/protobuf/timestamp_pb.js');
const google_protobuf_duration_pb = require('google-protobuf/google/protobuf/duration_pb.js');
const {EditorView, keymap} = require("@codemirror/view");
const {defaultKeymap} = require("@codemirror/commands");
const {basicSetup} = require("codemirror");
const {EditorState, Compartment} = require("@codemirror/state");
const {javascript} = require("@codemirror/lang-javascript");
const {cpp} = require("@codemirror/lang-cpp");
const {markdown} = require("@codemirror/lang-markdown");
const {python} = require("@codemirror/lang-python");
const {StreamLanguage} = require("@codemirror/language");
const {gas} = require("@codemirror/legacy-modes/mode/gas");
const {shell} = require("@codemirror/legacy-modes/mode/shell");
const { Terminal } = require('@xterm/xterm');
require('@xterm/xterm/css/xterm.css');
const { FitAddon } = require('@xterm/addon-fit');

let currentProblem = null;
let currentFileContent = ''; // To store the content of the currently selected file
let editor = null; // To hold the CodeMirror instance
let fitAddon = null; // To hold the FitAddon instance
let term = null; // To hold the xterm.js instance
window.problemSet = []; // Initialize as empty, will be populated by gRPC
let user = null;
let assignment = null;
let language = new Compartment();
let editableCompartment = new Compartment();

function getLanguageExtension(filename) {
    const ext = filename.split('.').pop();
    switch (ext) {
        case 'c':
        case 'h':
            return cpp();
        case 's':
        case 'S':
            return StreamLanguage.define(gas);
        case 'md':
            return markdown();
        case 'py':
            return python();
    }
    if (filename.endsWith('Makefile')) {
        return StreamLanguage.define(shell);
    }
    return null;
}

document.addEventListener('DOMContentLoaded', () => {
    // Initialize Split.js for draggable panes
    Split(['#file-tree-pane', '#editor-pane', '#info-pane'], {
        sizes: [10, 45, 45],
        gutterSize: 8,
        cursor: 'col-resize',
        snapOffset: 30,
        onDrag: () => {
            if (fitAddon) {
                fitAddon.fit();
            }
        }
    });

    initializeTabs();
    initializeTerminal();

    // Initialize CodeMirror
    const state = EditorState.create({
        extensions: [
            basicSetup,
            keymap.of(defaultKeymap),
            language.of([]),
            editableCompartment.of(EditorView.editable.of(true)),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    if (currentProblem) {
                        const selectedFile = document.querySelector('.file-tree li.selected');
                        if (selectedFile) {
                            const filePath = selectedFile.dataset.path;
                            const newContent = editor.state.doc.toString();
                            const newContentUint8 = new TextEncoder().encode(newContent);
                            currentProblem.merged_files.set(filePath, newContentUint8);
                            currentFileContent = newContent;
                            // Enable the save button
                            document.getElementById('save-button').disabled = false;
                        }
                    }
                }
            })
        ]
    });

    editor = new EditorView({
        state,
        parent: document.getElementById('editor-pane')
    });

    loadAssignment();
});

async function loadAssignment() {
    const client = new CodeGrinderServicePromiseClient(window.location.origin);
    window.problemSet = []; // Clear existing problem set

    try {
        // 1. GetUserMe
        console.log('loadAssignment: Fetching user...');
        const userResponse = await client.getUserMe(new GetUserMeRequest(), {});
        user = userResponse.getUser();
        console.log('loadAssignment: User:', user.toObject());

        // Get assignment_id from URL
        const urlParams = new URLSearchParams(window.location.search);
        const assignmentId = urlParams.get('assignment');
        if (!assignmentId) {
            throw new Error('Assignment ID not found in URL. Please provide ?assignment=<ID>');
        }
        console.log('loadAssignment: Assignment ID from URL:', assignmentId);

        // 2. GetAssignment
        console.log('loadAssignment: Fetching assignment...');
        const assignmentRequest = new GetAssignmentRequest().setAssignmentId(assignmentId);
        const assignmentResponse = await client.getAssignment(assignmentRequest, {});
        assignment = assignmentResponse.getAssignment();
        console.log('loadAssignment: Assignment:', assignment.toObject());

        // Validate user_id
        if (assignment.getUserId() !== user.getId()) {
            throw new Error('User ID from Assignment does not match current User ID.');
        }

        // 3. GetProblemSetProblems
        console.log('loadAssignment: Fetching problem set problems...');
        const problemSetProblemsRequest = new GetProblemSetProblemsRequest().setProblemSetId(assignment.getProblemSetId());
        const problemSetProblemsResponse = await client.getProblemSetProblems(problemSetProblemsRequest, {});
        const problemSetProblems = problemSetProblemsResponse.getProblemSetProblemsList();
        console.log('loadAssignment: Problem Set Problems:', problemSetProblems.map(psp => psp.toObject()));

        // 4. Create a catalog of ProblemType objects to be filled in lazily.
        const problemTypes = new Map(); // Map<string, ProblemType>

        // Next, each ProblemSetProblem object has a problem_id field,
        // which we use in the "Loading a single problem" sequence below to get problem data
        for (const problemSetProblem of problemSetProblems) {
            await loadProblem(client, assignment, problemSetProblem, problemTypes);
        }

        window.problemSet.sort((a, b) => a.unique.localeCompare(b.unique));

        initializeProblemSelection();
        renderMenuBar();
        renderFileTree();
        renderInstructionsPane();
        selectInstructionsTab();
        loadFirstWhitelistedFileIntoEditor();

    } catch (err) {
        console.error('Error loading assignment:', err);
        document.getElementById('menu-bar').innerHTML = '<p style="color: red;">Error loading data. Please try again later.</p>';
    }
}

// Function to load a single problem as per RPC.md
async function loadProblem(client, assignment, problemSetProblem, problemTypes) {
    console.log(`loadProblem: Loading data for problemSetProblem: ${problemSetProblem.toObject()}`);

    // 1. GetProblem
    console.log('loadProblem: Fetching problem...');
    const problemRequest = new GetProblemRequest().setProblemId(problemSetProblem.getProblemId());
    const problemResponse = await client.getProblem(problemRequest, {});
    const problem = problemResponse.getProblem();
    console.log('loadProblem: Problem:', problem.toObject());

    // 2. GetAssignmentProblemCommitLast
    console.log('loadProblem: Fetching last commit...');
    const commitRequest = new GetAssignmentProblemCommitLastRequest()
        .setAssignmentId(assignment.getId())
        .setProblemId(problem.getId());
    let commit = null;
    try {
        const commitResponse = await client.getAssignmentProblemCommitLast(commitRequest, {});
        commit = commitResponse.getCommit();
        console.log('loadProblem: Commit:', commit.toObject());
    } catch (e) {
        console.log('loadProblem: No commit found for this problem.');
    }

    // 3. GetProblemStep
    const step = commit ? commit.getStep() : 1;
    console.log(`loadProblem: Using step: ${step}`);

    console.log('loadProblem: Fetching problem step...');
    const problemStepRequest = new GetProblemStepRequest()
        .setProblemId(problem.getId())
        .setStep(step);
    const problemStepResponse = await client.getProblemStep(problemStepRequest, {});
    const currentStep = problemStepResponse.getProblemStep();
    console.log('loadProblem: Current Problem Step:', currentStep.toObject());

    // 4. If the ProblemStep field problem_type (a string) is missing
    //    as a key in the ProblemType catalog, fetch the ProblemType
    //    using GetProblemType and then add it to the catalog.
    if (!problemTypes.has(currentStep.getProblemType())) {
        console.log(`loadProblem: Fetching problem type: ${currentStep.getProblemType()}`);
        const problemTypeRequest = new GetProblemTypeRequest().setName(currentStep.getProblemType());
        const problemTypeResponse = await client.getProblemType(problemTypeRequest, {});
        problemTypes.set(currentStep.getProblemType(), problemTypeResponse.getProblemType());
    }
    const problemType = problemTypes.get(currentStep.getProblemType());
    console.log('loadProblem: Problem Type:', problemType.toObject());

    // 5. Build a merged set of files
    const mergedFiles = new Map();
    // Start with the files field of the ProblemStep
    currentStep.getFilesMap().forEach((content, name) => mergedFiles.set(name, content));
    // If there was a Commit object, merge its files field
    if (commit) {
        commit.getFilesMap().forEach((content, name) => mergedFiles.set(name, content));
    }
    console.log('loadProblem: Merged files:', [...mergedFiles.keys()]);

    // Store the problem data
    window.problemSet.push({
        id: problem.getId(),
        problem: problem, // Keep the protobuf message
        unique: problem.getUnique(),
        note: problem.getNote(),
        merged_file_list: [...mergedFiles.keys()],
        problem_type: problemType,
        merged_files: mergedFiles,
        instructions: currentStep.getInstructions(),
        current_step_number: step, // Store the current step number
        problem_set_problem: problemSetProblem.toObject(), // Store the original problemSetProblem
        problem_step: currentStep, // Store the current problem step
    });
    if (commit && commit.getReportCard() && commit.getReportCard().getPassed() && commit.getScore() === 1.0) {
        console.log('loadProblem: Commit indicates step passed, advancing to next step...');
        await nextStep(client, assignment, problem, currentStep, mergedFiles, problemTypes);
    }
}

// Function to advance to the next step as per RPC.md
async function nextStep(client, assignment, problem, oldStep, mergedFiles, problemTypes) {
    console.log(`nextStep: Attempting to advance problem ${problem.getUnique()} from step ${oldStep.getStep()}`);
    const nextStepNumber = oldStep.getStep() + 1;

    try {
        // 1. Print the string "step {step} passed" to the terminal
        term.writeln(`step ${oldStep.getStep()} passed`);
        selectTerminalTab();

        // 2. Try loading newStep using GetProblemStep
        console.log(`nextStep: Fetching problem step ${nextStepNumber}...`);
        const newProblemStepRequest = new GetProblemStepRequest()
            .setProblemId(problem.getId())
            .setStep(nextStepNumber);
        const newProblemStepResponse = await client.getProblemStep(newProblemStepRequest, {});
        const newStep = newProblemStepResponse.getProblemStep();
        console.log('nextStep: New Problem Step found:', newStep.toObject());

        // 3. If newStep was found and fetched, merge its files
        //    * Each file path in newStep either replaces one in the main file set for the problem (if it is a duplicate) or adds to the set.
        newStep.getFilesMap().forEach((content, name) => mergedFiles.set(name, content));

        //    * The file sets from oldStep and newStep are compared (note: NOT the merged file set).
        //      Any file path that appears in oldStep but is missing from newStep is REMOVED from the merged file set.
        const oldStepFiles = new Set(oldStep.getFilesMap().keys());
        const newStepFiles = new Set(newStep.getFilesMap().keys());

        for (const oldFilePath of oldStepFiles) {
            if (!newStepFiles.has(oldFilePath)) {
                console.log(`nextStep: Removing file ${oldFilePath} as it's no longer in new step.`);
                mergedFiles.delete(oldFilePath);
            }
        }
        console.log('nextStep: Merged files after advancing:', [...mergedFiles.keys()]);

        // Print the string "moving to step {step}" to the terminal
        term.writeln(`moving to step ${newStep.getStep()}`);
        selectTerminalTab();

        // Update the problem in window.problemSet with the new step information
        const problemIndex = window.problemSet.findIndex(p => p.id === problem.getId());
        if (problemIndex !== -1) {
            window.problemSet[problemIndex].instructions = newStep.getInstructions();
            window.problemSet[problemIndex].merged_file_list = [...mergedFiles.keys()];
            window.problemSet[problemIndex].merged_files = mergedFiles;
            window.problemSet[problemIndex].current_step_number = nextStepNumber;

            // Also update problem type if new step has a different one
            if (!problemTypes.has(newStep.getProblemType())) {
                console.log(`nextStep: Fetching new problem type: ${newStep.getProblemType()}`);
                const problemTypeRequest = new GetProblemTypeRequest().setName(newStep.getProblemType());
                const problemTypeResponse = await client.getProblemType(problemTypeRequest, {});
                problemTypes.set(newStep.getProblemType(), problemTypeResponse.getProblemType());
            }
            window.problemSet[problemIndex].problem_type = problemTypes.get(newStep.getProblemType());
        }

    } catch (err) {
        console.log(`nextStep: No further steps found for problem ${problem.getUnique()}. Problem complete.`);
        // Mark problem as complete if GetProblemStep fails for next step
        const problemIndex = window.problemSet.findIndex(p => p.id === problem.getId());
        if (problemIndex !== -1) {
            window.problemSet[problemIndex].is_complete = true;
        }
        term.writeln('you have completed all steps for this problem');
        selectTerminalTab();
    }
}

// Function to handle Daycare interaction as per RPC.md
async function handleDaycare(bundle) {
    console.log('handleDaycare: Initiating Daycare interaction...');
    selectTerminalTab(); // Automatically select terminal tab

    const daycareClient = new CodeGrinderServicePromiseClient(bundle.getHostname() || window.location.origin);
    const daycareRequest = new DaycareRequest()
        .setCommitBundle(bundle)
        .setProblemType(currentProblem.problem_type.getName())
        .setAction(bundle.getCommit().getAction())
        .setArgsList([]); // Empty list of strings

    return new Promise((resolve, reject) => {
        const stream = daycareClient.daycare(daycareRequest, {});
        let finalBundle = null;

        stream.on('data', (response) => {
            if (response.hasEvent()) {
                const event = response.getEvent();
                if (bundle.getCommit().getAction() === 'grade') {
                    // Ignore event for grade action
                    return;
                } else if (event.getEvent() === 'files') {
                    event.getFilesMap().forEach((content, path) => {
                        const whitelist = new Set(currentProblem.problem_step.getWhitelistMap().getEntryList().map(item => item[0]));
                        if (whitelist.has(path)) {
                            currentProblem.merged_files.set(path, content);
                            term.writeln(`downloading file ${path}`);
                        }
                    });
                    renderFileTree(); // Re-render file tree to reflect changes
                } else {
                    // Print to terminal using the same rules as when transcript is printed
                    if (event.getEvent() === 'exec') {
                        term.writeln(`$ ${event.getExecCommandList().join(' ')}`);
                    } else if (event.getEvent() === 'exit') {
                        if (event.getExitStatus() !== 0) {
                            term.writeln(`exit status ${event.getExitStatus()}`);
                        }
                    } else if (event.getEvent() === 'stdin' || event.getEvent() === 'stdout' || event.getEvent() === 'stderr') {
                        term.write(new TextDecoder().decode(event.getStreamData()));
                    } else if (event.getEvent() === 'error') {
                        term.writeln(`Error: ${event.getError()}`);
                    }
                }
            } else if (response.hasError()) {
                term.writeln(`server return an error: ${response.getError()}`);
                reject(new Error(response.getError()));
                stream.cancel();
            } else if (response.hasCommitBundle()) {
                finalBundle = response.getCommitBundle();
            }
        });

        stream.on('end', () => {
            console.log('handleDaycare: Daycare stream ended.');
            if (finalBundle) {
                resolve(finalBundle);
            } else {
                reject(new Error('Daycare stream ended without a final CommitBundle.'));
            }
        });

        stream.on('error', (err) => {
            console.error('handleDaycare: Daycare stream error:', err);
            term.writeln(`Daycare stream error: ${err.message}`);
            reject(err);
        });
    });
}

// Function to perform an action as per RPC.md
async function doAction(action) {
    console.log(`doAction: Performing action: ${action}`);
    const client = new CodeGrinderServicePromiseClient(window.location.origin);

    try {
        // 1. Re-load the current ProblemStep
        console.log('doAction: Re-loading current problem step...');
        const problemStepRequest = new GetProblemStepRequest()
            .setProblemId(currentProblem.id)
            .setStep(currentProblem.current_step_number);
        const problemStepResponse = await client.getProblemStep(problemStepRequest, {});
        const reloadedProblemStep = problemStepResponse.getProblemStep();
        currentProblem.problem_step = reloadedProblemStep;
        currentProblem.instructions = reloadedProblemStep.getInstructions();
        renderInstructionsPane();

        // 2. Identify whitelisted files and collect "student files"
        const studentFiles = new Map();
        const whitelist = new Set(currentProblem.problem_step.getWhitelistMap().getEntryList().map(item => item[0]));

        currentProblem.merged_files.forEach((content, path) => {
            if (whitelist.has(path)) {
                studentFiles.set(path, content);
            }
        });

        // For files that are NOT in the whitelist, replace the version in the active file set with the version from the newly-loaded ProblemStep.
        reloadedProblemStep.getFilesMap().forEach((content, path) => {
            if (!whitelist.has(path)) {
                currentProblem.merged_files.set(path, content);
            }
        });
        renderFileTree(); // Re-render file tree to reflect changes

        // 3. Create a Commit object
        const commit = new Commit();
        commit.setId(0);
        commit.setAssignmentId(assignment.getId());
        commit.setProblemId(currentProblem.id);
        commit.setStep(reloadedProblemStep.getStep());
        const filesMap = commit.getFilesMap();
        studentFiles.forEach((content, path) => filesMap.set(path, content));
        const now = new Date();
        const timestamp = new Timestamp();
        timestamp.fromDate(now);
        commit.setCreatedAt(timestamp);
        commit.setUpdatedAt(timestamp);

        if (action === '') {
            commit.setAction('');
            commit.setNote('exam interface: save');
        } else {
            commit.setAction(action);
            commit.setNote(`exam interface: ${action}`);
        }

        // 4. Create a CommitBundle object
        const commitBundle = new CommitBundle();
        commitBundle.setUserId(user.getId());
        commitBundle.setCommit(commit);

        // 5. Call PostCommitBundlesUnsignedRequest
        console.log('doAction: Posting unsigned commit bundle...');
        const postUnsignedRequest = new PostCommitBundlesUnsignedRequest().setBundle(commitBundle);
        const postUnsignedResponse = await client.postCommitBundlesUnsigned(postUnsignedRequest, {});
        let responseBundle = postUnsignedResponse.getBundle();
        console.log('doAction: Unsigned commit bundle response:', responseBundle.toObject());

        // Mark as saved (no unsaved changes), possibly de-activating the save button.
        document.getElementById('save-button').disabled = true;

        if (action === '') {
            console.log('doAction: Save action complete.');
            return; // End of doAction for save
        }

        // 6. Print the message field from the ProblemStepAction
        const problemTypeActionsMap = currentProblem.problem_type.getActionsMap();
        const problemStepAction = problemTypeActionsMap.get(action);
        if (problemStepAction && problemStepAction.getMessage()) {
            term.writeln(problemStepAction.getMessage());
            selectTerminalTab();
        }

        // 7. Run the handleDaycare sequence
        responseBundle = await handleDaycare(responseBundle);

        if (action !== 'grade') {
            console.log('doAction: Non-grade action complete.');
            return; // End of doAction for non-grade actions
        }

        // For "grade" actions continue with the remaining steps.
        // 8. Construct a new CommitBundle called toSave
        const toSave = new CommitBundle();
        toSave.setHostname(responseBundle.getHostname());
        toSave.setUserId(responseBundle.getUserId());
        toSave.setCommit(responseBundle.getCommit());
        toSave.setCommitSignature(responseBundle.getCommitSignature());

        // Call PostCommitBundlesSigned
        console.log('doAction: Posting signed commit bundle...');
        const postSignedRequest = new PostCommitBundlesSignedRequest().setBundle(toSave);
        const postSignedResponse = await client.postCommitBundlesSigned(postSignedRequest, {});
        const signedBundle = postSignedResponse.getBundle();
        const gradedCommit = signedBundle.getCommit();
        console.log('doAction: Signed commit bundle response:', gradedCommit.toObject());

        // 9. If the commit has a report_card field with a passed field that is true and the commit has a score field that is equal to 1.0:
        if (gradedCommit.hasReportCard() && gradedCommit.getReportCard().getPassed() && gradedCommit.getScore() === 1.0) {
            term.writeln(`step ${currentProblem.current_step_number} passed`);
            await nextStep(client, assignment, signedBundle.getProblem(), reloadedProblemStep, currentProblem.merged_files, new Map());

            // Re-render UI after nextStep might have updated currentProblem
            renderMenuBar();
            renderFileTree();
            renderInstructionsPane();
            loadFirstWhitelistedFileIntoEditor();
        } else {
            // 10. Else: Print failure message and transcript
            term.writeln(`solution for step ${currentProblem.current_step_number} failed`);
            gradedCommit.getTranscriptList().forEach(event => {
                if (event.getEvent() === 'exec') {
                    term.writeln(`$ ${event.getExecCommandList().join(' ')}`);
                } else if (event.getEvent() === 'exit') {
                    if (event.getExitStatus() !== 0) {
                        term.writeln(`exit status ${event.getExitStatus()}`);
                    }
                } else if (event.getEvent() === 'stdin' || event.getEvent() === 'stdout' || event.getEvent() === 'stderr') {
                    term.write(new TextDecoder().decode(event.getStreamData()));
                } else if (event.getEvent() === 'error') {
                    term.writeln(`Error: ${event.getError()}`);
                }
            });
            selectTerminalTab();
        }

    } catch (err) {
        console.error('doAction: Error performing action:', err);
        term.writeln(`Error performing action: ${err.message}`);
        selectTerminalTab();
    }
}

function loadFirstWhitelistedFileIntoEditor() {
    if (!currentProblem || !currentProblem.merged_file_list || currentProblem.merged_file_list.length === 0) {
        return;
    }

    const whitelist = currentProblem.problem_step.getWhitelistMap();

    for (const filePath of currentProblem.merged_file_list) {
        // Check if the file is in the whitelist
        if (whitelist.has(filePath)) {
            // Find the corresponding list item in the file tree and simulate a click
            const fileTreeElement = document.querySelector(`.file-tree li[data-path="${filePath}"]`);
            if (fileTreeElement) {
                fileTreeElement.click();
                return; // Stop after loading the first whitelisted file
            }
        }
    }
}

function initializeProblemSelection() {
    if (!window.problemSet || window.problemSet.length === 0) {
        console.error("No problems defined in problemSet.");
        return;
    }

    // Select the first problem (already sorted by unique in fetchAndRenderProblems)
    currentProblem = window.problemSet[0];
    console.log("Initial problem selected:", currentProblem.note);
}



async function performSaveAction() {
    console.log("Performing save action...");
    await doAction('');
}

function renderMenuBar() {
    const menuBar = document.getElementById('menu-bar');
    menuBar.innerHTML = ''; // Clear existing content

    // 1. Problem Selection Buttons
    window.problemSet.forEach(problem => {
        const problemButton = document.createElement('button');
        problemButton.textContent = problem.note;
        problemButton.classList.add('problem-button');
        if (problem.unique === currentProblem.unique) {
            problemButton.disabled = true;
            problemButton.classList.add('active-problem');
        } else {
            problemButton.addEventListener('click', async () => {
                // Perform save action if there are unsaved changes
                if (!document.getElementById('save-button').disabled) {
                    await performSaveAction();
                }
                currentProblem = window.problemSet.find(p => p.unique === problem.unique);
                console.log("Problem selected:", currentProblem.note);
                // Re-render UI based on new problem
                renderMenuBar();
                renderFileTree();
                renderInstructionsPane();
                selectInstructionsTab();
                editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: ''}});
                if (term) {
                    term.clear();
                }
                loadFirstWhitelistedFileIntoEditor();
            });
        }
        menuBar.appendChild(problemButton);
    });

    // Add a divider
    const divider = document.createElement('div');
    divider.classList.add('menu-divider');
    menuBar.appendChild(divider);

    // 3. Save Button
    const saveButton = document.createElement('button');
    saveButton.id = 'save-button';
    saveButton.textContent = 'Save';
    saveButton.disabled = true; // Initially disabled
    saveButton.addEventListener('click', performSaveAction);
    menuBar.appendChild(saveButton);

    // 4. Actions Buttons
    // Ensure problem_type and actionsMap exist before accessing
    const actionsMap = currentProblem.problem_type.getActionsMap();
    const actionsList = actionsMap.getEntryList(); // Array of [key, value]
    let availableActions = actionsList
        .map(([name, actionObj]) => {
            return { name, text: name.charAt(0).toUpperCase() + name.slice(1) };
        })
        .sort((a, b) => a.name.localeCompare(b.name)); // Sort actions alphabetically

    availableActions.forEach(action => {
        const actionButton = document.createElement('button');
        actionButton.id = `action-${action.name}-button`;
        actionButton.textContent = action.text;
        actionButton.addEventListener('click', async () => {
            console.log(`Action button clicked: ${action.name}`);
            await doAction(action.name);
        });
        menuBar.appendChild(actionButton);
    });
}

function renderFileTree() {
    const fileTreePane = document.getElementById('file-tree-pane');
    fileTreePane.innerHTML = ''; // Clear existing content

    if (!currentProblem || !currentProblem.merged_file_list) {
        fileTreePane.innerHTML = '<p>No files to display.</p>';
        return;
    }

    const whitelist = new Set(currentProblem.problem_step.getWhitelistMap().getEntryList().map(item => item[0]));
    console.log('Whitelist files:', [...whitelist]);

    const fileList = currentProblem.merged_file_list;
    const tree = buildFileTree(fileList);
    const ul = document.createElement('ul');
    ul.classList.add('file-tree');
    renderTree(tree, ul, currentProblem.merged_files, whitelist, ''); // Pass whitelist and empty path for root
    fileTreePane.appendChild(ul);
}

function buildFileTree(filePaths) {
    const tree = {};

    filePaths.forEach(path => {
        // Skip the 'doc' top-level folder
        if (path.startsWith('doc/')) {
            return;
        }

        const parts = path.split('/');
        let currentLevel = tree;

        parts.forEach((part, index) => {
            if (!currentLevel[part]) {
                currentLevel[part] = {
                    _is_file: (index === parts.length - 1),
                    _path: path,
                    children: {}
                };
            }
            currentLevel = currentLevel[part].children;
        });
    });
    return tree;
}

function renderTree(node, parentElement, mergedFiles, whitelist, currentPath) {

    // Helper to check if a path (file or directory) is whitelisted or contains a whitelisted file
    const isWhitelistedRecursive = (itemNode, itemRelativePath) => {
        const fullPath = itemRelativePath; // itemRelativePath is already the full path from root

        if (itemNode._is_file) {
            return whitelist.has(fullPath);
        } else {
            // It's a directory, check if any child is whitelisted
            for (const childKey in itemNode.children) {
                const childNode = itemNode.children[childKey];
                const childFullPath = fullPath === '' ? childKey : `${fullPath}/${childKey}`;
                if (isWhitelistedRecursive(childNode, childFullPath)) {
                    return true;
                }
            }
        }
        return false;
    };

    const sortedKeys = Object.keys(node).sort((a, b) => {
        const itemA = node[a];
        const itemB = node[b];

        const aIsFile = itemA._is_file;
        const bIsFile = itemB._is_file;

        const aRelativePath = currentPath === '' ? a : `${currentPath}/${a}`;
        const bRelativePath = currentPath === '' ? b : `${currentPath}/${b}`;

        const aInWhitelist = isWhitelistedRecursive(itemA, aRelativePath);
        const bInWhitelist = isWhitelistedRecursive(itemB, bRelativePath);

        // Prioritize whitelisted items
        if (aInWhitelist && !bInWhitelist) {
            return -1;
        }
        if (!aInWhitelist && bInWhitelist) {
            return 1;
        }

        // If both are whitelisted or neither are, use existing sorting logic
        if (aIsFile === bIsFile) {
            return a.localeCompare(b);
        }
        return aIsFile ? -1 : 1; // Files before directories
    });

    sortedKeys.forEach(key => {
        const item = node[key];
        const li = document.createElement('li');
        li.classList.add(item._is_file ? 'file' : 'folder');

        const itemContent = document.createElement('div');
        itemContent.classList.add('item-content-wrapper');

        const iconSpan = document.createElement('span');
        iconSpan.classList.add('icon');
        itemContent.appendChild(iconSpan);

        const textSpan = document.createElement('span');
        textSpan.textContent = key;
        itemContent.appendChild(textSpan);

        li.appendChild(itemContent);

        if (item._is_file) {
            li.dataset.path = item._path;
            li.addEventListener('click', async (event) => {
                event.stopPropagation();
                // Perform save action if there are unsaved changes
                if (!document.getElementById('save-button').disabled) {
                    await performSaveAction();
                }

                const previouslySelected = document.querySelector('.file-tree li.selected');
                if (previouslySelected) {
                    previouslySelected.classList.remove('selected');
                }
                li.classList.add('selected');
                console.log("File selected:", item._path);
                const fileContent = new TextDecoder().decode(mergedFiles.get(item._path));
                currentFileContent = fileContent;

                // Check if the file is in the problem step's whitelist
                const isEditable = currentProblem.problem_step.getWhitelistMap().has(item._path);
                console.log('File:', item._path, 'Is Editable:', isEditable);

                const lang = getLanguageExtension(item._path);
                const effects = [];

                // Reconfigure editable state
                effects.push(editableCompartment.reconfigure(EditorView.editable.of(isEditable)));

                // Reconfigure language
                if (lang) {
                    effects.push(language.reconfigure(lang));
                } else {
                    effects.push(language.reconfigure([]));
                }

                editor.dispatch({
                    changes: {from: 0, to: editor.state.doc.length, insert: fileContent},
                    effects: effects
                });
                document.getElementById('save-button').disabled = true;
            });
        } else {
            // Folders are no longer interactive for expanding/collapsing.
            // The hierarchical display remains, but is static.
        }
        parentElement.appendChild(li);

        if (Object.keys(item.children).length > 0) {
            const ul = document.createElement('ul');
            li.appendChild(ul);
            const nextPath = currentPath === '' ? key : `${currentPath}/${key}`;
            renderTree(item.children, ul, mergedFiles, whitelist, nextPath); // Pass nextPath
        }
    });
}


function renderInstructionsPane() {
    const instructionsPane = document.getElementById('instructions-tab-content');
    instructionsPane.innerHTML = ''; // Clear existing content

    if (!currentProblem || !currentProblem.instructions) {
        instructionsPane.innerHTML = '<p>No instructions available.</p>';
        return;
    }

    instructionsPane.innerHTML = currentProblem.instructions;
}

function selectInstructionsTab() {
    document.getElementById('instructions-tab-button').click();
}

function selectTerminalTab() {
    document.getElementById('terminal-tab-button').click();
}

function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => content.classList.remove('active'));
            const contentId = button.id.replace('-button', '-content');
            document.getElementById(contentId).classList.add('active');
        });
    });
}

function initializeTerminal() {
    term = new Terminal({
        convertEol: true,
        scrollback: 500,
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4'
        },
        disableStdin: true, // Disable user input
        cursorBlink: false, // Hide blinking cursor
        cursorStyle: 'underline' // Set cursor style to none to hide it
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();
    window.addEventListener('resize', () => fitAddon.fit());

    term.writeln('Welcome to the CodeGrinder Terminal!');
    term.writeln('This is a test of the ANSI color support.');
    term.writeln('\x1b[1;31mRed\x1b[0m \x1b[1;32mGreen\x1b[0m \x1b[1;33mYellow\x1b[0m \x1b[1;34mBlue\x1b[0m \x1b[1;35mMagenta\x1b[0m \x1b[1;36mCyan\x1b[0m \x1b[1;37mWhite\x1b[0m');
    selectTerminalTab();
}
