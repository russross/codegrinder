import {
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
    ProblemType,
    Problem,
    ProblemStep,
    Assignment,
    ProblemSetProblem,
    User,
    DaycareResponse,
    EventMessage
} from "./codegrinder";
import { Timestamp } from "./google/protobuf/timestamp";
import { Duration } from "./google/protobuf/duration";
import { CodeGrinderServiceClient } from './codegrinder.client';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';

import Split from 'split.js';

import {EditorView, keymap, ViewUpdate} from "@codemirror/view";
import {defaultKeymap, indentWithTab} from "@codemirror/commands";
import {basicSetup} from "codemirror";
import {EditorState, Compartment, StateEffect, Extension} from "@codemirror/state";
import {javascript} from "@codemirror/lang-javascript";
import {cpp} from "@codemirror/lang-cpp";
import {markdown} from "@codemirror/lang-markdown";
import {python} from "@codemirror/lang-python";
import {StreamLanguage, LanguageSupport} from "@codemirror/language";
import {gas} from "@codemirror/legacy-modes/mode/gas";
import {shell} from "@codemirror/legacy-modes/mode/shell";
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';

interface ProblemData {
    id: string;
    problem: Problem;
    unique: string;
    note: string;
    merged_file_list: string[];
    problem_type: ProblemType;
    merged_files: Map<string, Uint8Array>;
    instructions: string;
    current_step_number: string;
    problem_set_problem: ProblemSetProblem;
    problem_step: ProblemStep;
    is_complete?: boolean;
}

interface FileTreeNode {
    _is_file: boolean;
    _path: string;
    children: { [key: string]: FileTreeNode };
}

declare global {
    interface Window {
        problemSet: ProblemData[];
    }
}

let currentProblem: ProblemData | null = null;
let editor: EditorView;
let fitAddon: FitAddon;
let term: Terminal;
window.problemSet = []; // Initialize as empty, will be populated by gRPC
let assignment: Assignment | null = null;
let language = new Compartment();
let editableCompartment = new Compartment();
let currentlyOpenFilePath: string | null = null;
let hasUserMadeChanges: boolean = false;
let isProgrammaticEditorUpdate: boolean = false;

function getLanguageExtension(filename: string): LanguageSupport | null {
    const ext = filename.split('.').pop();
    switch (ext) {
        case 'c':
        case 'h':
            return cpp();
        case 's':
        case 'S':
            return new LanguageSupport(StreamLanguage.define(gas));
        case 'md':
            return markdown();
        case 'py':
            return python();
    }
    if (filename.endsWith('Makefile')) {
        return new LanguageSupport(StreamLanguage.define(shell));
    }
    return null;
}

document.addEventListener('DOMContentLoaded', (): void => {
    // Initialize Split.js for draggable panes
    Split(['#file-tree-pane', '#editor-pane', '#info-pane'], {
        sizes: [10, 45, 45],
        gutterSize: 8,
        cursor: 'col-resize',
        onDrag: (): void => {
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
            keymap.of([indentWithTab, ...defaultKeymap]),
            language.of([]),
            editableCompartment.of(EditorView.editable.of(true)),
            EditorView.updateListener.of((update: ViewUpdate): void => {
                if (update.docChanged) {
                    // Only enable save button if the change was user-initiated
                    if (!isProgrammaticEditorUpdate && update.transactions.some(tr => tr.isUserEvent)) {
                        hasUserMadeChanges = true; // Set the flag
                        if (currentProblem) {
                            const selectedFile = document.querySelector('.file-tree li.selected') as HTMLLIElement | null;
                            if (selectedFile) {
                                const filePath = selectedFile.dataset.path;
                                if (filePath) {
                                    const newContentString = editor.state.doc.toString();
                                    const newContentUint8 = new TextEncoder().encode(newContentString);
                                    currentProblem.merged_files.set(filePath, newContentUint8);
                                    // Enable the save button
                                    (document.getElementById('save-button') as HTMLButtonElement).disabled = false;
                                }
                            }
                        }
                    }
                }
            })
        ]
    });

    editor = new EditorView({
        state,
        parent: document.getElementById('editor-pane')!
    });

    loadAssignment();
});

let user: User;

async function loadAssignment(): Promise<void> {
    const transport = new GrpcWebFetchTransport({ baseUrl: window.location.origin });
    const client = new CodeGrinderServiceClient(transport);
    window.problemSet = []; // Clear existing problem set

    try {
        // 1. GetUserMe
        console.log('loadAssignment: Fetching user...');
        const userCall = await client.getUserMe(GetUserMeRequest.create(), {});
        user = userCall.response.user!;
        console.log('loadAssignment: User:', user);

        // Get assignment_id from URL
        const urlParams = new URLSearchParams(window.location.search);
        const assignmentIdStr = urlParams.get('assignment');
        if (!assignmentIdStr) {
            throw new Error('Assignment ID not found in URL. Please provide ?assignment=<ID>');
        }
        const assignmentId = BigInt(assignmentIdStr);
        console.log('loadAssignment: Assignment ID from URL:', assignmentId);

        // 2. GetAssignment
        console.log('loadAssignment: Fetching assignment...');
        const assignmentRequest = GetAssignmentRequest.create({ assignmentId: assignmentId.toString() });
        const assignmentCall = await client.getAssignment(assignmentRequest, {});
        assignment = assignmentCall.response.assignment!;
        console.log('loadAssignment: Assignment:', assignment);

        // Validate user_id
        if (assignment.userId !== user.id) {
            throw new Error('User ID from Assignment does not match current User ID.');
        }

        // 3. GetProblemSetProblems
        console.log('loadAssignment: Fetching problem set problems...');
        const problemSetProblemsRequest = GetProblemSetProblemsRequest.create({ problemSetId: assignment.problemSetId });
        const problemSetProblemsResponse = await client.getProblemSetProblems(problemSetProblemsRequest, {});
        const problemSetProblems = problemSetProblemsResponse.response.problemSetProblems;
        console.log('loadAssignment: Problem Set Problems:', problemSetProblems.map(psp => psp));

        // 4. Create a catalog of ProblemType objects to be filled in lazily.
        const problemTypes = new Map<string, ProblemType>();

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
        const menuBar = document.getElementById('menu-bar');
        if (menuBar) {
            menuBar.innerHTML = '<p style="color: red;">Error loading data. Please try again later.</p>';
        }
    }
}

// Function to load a single problem as per RPC.md
async function loadProblem(client: CodeGrinderServiceClient, assignment: Assignment, problemSetProblem: ProblemSetProblem, problemTypes: Map<string, ProblemType>): Promise<void> {
    console.log(`loadProblem: Loading data for problemSetProblem: ${problemSetProblem}`);

    // 1. GetProblem
    console.log('loadProblem: Fetching problem...');
    const problemRequest = GetProblemRequest.create({ problemId: problemSetProblem.problemId });
    const problemResponse = await client.getProblem(problemRequest, {});
    const problem = problemResponse.response.problem!;
    console.log('loadProblem: Problem:', problem);

    // 2. GetAssignmentProblemCommitLast
    console.log('loadProblem: Fetching last commit...');
    const commitRequest = GetAssignmentProblemCommitLastRequest.create({
        assignmentId: assignment.id,
        problemId: problem.id
    });
    let commit: Commit | null = null;
    try {
        const commitResponse = await client.getAssignmentProblemCommitLast(commitRequest, {});
        commit = commitResponse.response.commit!;
        console.log('loadProblem: Commit:', commit);
    } catch (e) {
        console.log('loadProblem: No commit found for this problem.');
    }

    // 3. GetProblemStep
    const step = commit ? commit.step : "1";
    console.log(`loadProblem: Using step: ${step}`);

    console.log('loadProblem: Fetching problem step...');
    const problemStepRequest = GetProblemStepRequest.create({
        problemId: problem.id,
        step: step.toString()
    });
    const problemStepResponse = await client.getProblemStep(problemStepRequest, {});
    const currentStep = problemStepResponse.response.problemStep!;
    console.log('loadProblem: Current Problem Step:', currentStep);

    // 4. If the ProblemStep field problem_type (a string) is missing
    //    as a key in the ProblemType catalog, fetch the ProblemType
    //    using GetProblemType and then add it to the catalog.
    if (!problemTypes.has(currentStep.problemType)) {
        console.log(`loadProblem: Fetching problem type: ${currentStep.problemType}`);
        const problemTypeRequest = GetProblemTypeRequest.create({ name: currentStep.problemType });
        const problemTypeResponse = await client.getProblemType(problemTypeRequest, {});
        problemTypes.set(currentStep.problemType, problemTypeResponse.response.problemType!);
    }
    const problemType = problemTypes.get(currentStep.problemType)!;
    console.log('loadProblem: Problem Type:', problemType);

    // 5. Build a merged set of files
    const mergedFiles = new Map<string, Uint8Array>();
    // Start with the files field of the ProblemStep
    for (const [path, content] of Object.entries(currentStep.files)) {
        console.assert(content instanceof Uint8Array, `File content for ${path} is not Uint8Array in ProblemStep`);
        mergedFiles.set(path, content);
    }
    // If there was a Commit object, merge its files field
    if (commit) {
        for (const [path, content] of Object.entries(commit.files)) {
            console.assert(content instanceof Uint8Array, `File content for ${path} is not Uint8Array in Commit`);
            mergedFiles.set(path, content);
        }
    }
    console.log('loadProblem: Merged files:', [...mergedFiles.keys()]);

    // Store the problem data
    window.problemSet.push({
        id: problem.id.toString(),
        problem: problem, // Keep the protobuf message
        unique: problem.unique,
        note: problem.note,
        merged_file_list: [...mergedFiles.keys()],
        problem_type: problemType,
        merged_files: mergedFiles,
        instructions: currentStep.instructions,
        current_step_number: step.toString(), // Store the current step number
        problem_set_problem: problemSetProblem, // Store the original problemSetProblem
        problem_step: currentStep, // Store the current problem step
    });
    if (commit && commit.reportCard && commit.reportCard.passed && commit.score === 1.0) {
        console.log('loadProblem: Commit indicates step passed, advancing to next step...');
        await nextStep(client, assignment, problem, currentStep, mergedFiles, problemTypes);
    }
}

// Function to advance to the next step as per RPC.md
async function nextStep(client: CodeGrinderServiceClient, assignment: Assignment, problem: Problem, oldStep: ProblemStep, mergedFiles: Map<string, Uint8Array>, problemTypes: Map<string, ProblemType>): Promise<void> {
    console.log(`nextStep: Attempting to advance problem ${problem.unique} from step ${oldStep.step}`);
    const nextStepNumber = oldStep.step + 1n;

    try {
        // 1. Print the string "step {step} passed" to the terminal
            term.writeln(`step ${oldStep.step} passed`);
            selectTerminalTab();

            // 2. Try loading newStep using GetProblemStep
            console.log(`nextStep: Fetching problem step ${nextStepNumber}...`);
            const newProblemStepRequest = GetProblemStepRequest.create({
                problemId: problem.id,
                step: nextStepNumber.toString()
            });
            const newProblemStepResponse = await client.getProblemStep(newProblemStepRequest, {});
            const newStep = newProblemStepResponse.response.problemStep!;
            console.log('nextStep: New Problem Step found:', newStep);

            // 3. If newStep was found and fetched, merge its files
            //    * Each file path in newStep either replaces one in the main file set for the problem (if it is a duplicate) or adds to the set.
            for (const [path, content] of Object.entries(newStep.files)) {
                console.assert(content instanceof Uint8Array, `File content for ${path} is not Uint8Array in newStep`);
                mergedFiles.set(path, content);
            };

            //    * The file sets from oldStep and newStep are compared (note: NOT the merged file set).
            //      Any file path that appears in oldStep but is missing from newStep is REMOVED from the merged file set.
            const oldStepFiles = new Set(Object.keys(oldStep.files));
            const newStepFiles = new Set(Object.keys(newStep.files));

            for (const oldFilePath of oldStepFiles) {
                if (!newStepFiles.has(oldFilePath)) {
                    console.log(`nextStep: Removing file ${oldFilePath} as it's no longer in new step.`);
                    mergedFiles.delete(oldFilePath);
                }
            }
            console.log('nextStep: Merged files after advancing:', [...mergedFiles.keys()]);

            // Print the string "moving to step {step}" to the terminal
            term.writeln(`moving to step ${newStep.step}`);

            // Update the problem in window.problemSet with the new step information
            const problemIndex = window.problemSet.findIndex(p => p.id === problem.id.toString());
            if (problemIndex !== -1) {
                window.problemSet[problemIndex].instructions = newStep.instructions;
                window.problemSet[problemIndex].merged_file_list = [...mergedFiles.keys()];
                window.problemSet[problemIndex].merged_files = mergedFiles;
                window.problemSet[problemIndex].current_step_number = newStep.step.toString();

                // Also update problem type if new step has a different one
                if (!problemTypes.has(newStep.problemType)) {
                    console.log(`nextStep: Fetching new problem type: ${newStep.problemType}`);
                    const problemTypeRequest = GetProblemTypeRequest.create({ name: newStep.problemType });
                    const problemTypeResponse = await client.getProblemType(problemTypeRequest, {});
                    problemTypes.set(newStep.problemType, problemTypeResponse.response.problemType!);
                }
                window.problemSet[problemIndex].problem_type = problemTypes.get(newStep.problemType)!;
            }

        } catch (err) {
            console.log(`nextStep: No further steps found for problem ${problem.unique}. Problem complete.`);
            // Mark problem as complete if GetProblemStep fails for next step
            const problemIndex = window.problemSet.findIndex(p => p.id === problem.id.toString());
            if (problemIndex !== -1) {
                window.problemSet[problemIndex].is_complete = true;
            }
            term.writeln('you have completed all steps for this problem');    }
}

// Function to handle Daycare interaction as per RPC.md
async function handleDaycare(bundle: CommitBundle): Promise<CommitBundle | void> {
    console.log('handleDaycare: Initiating Daycare interaction...');
    selectTerminalTab(); // Automatically select terminal tab
    if (fitAddon) {
        fitAddon.fit();
    }

    const daycareClient = new CodeGrinderServiceClient(new GrpcWebFetchTransport({ baseUrl: `${window.location.protocol}//${bundle.hostname}` }));
    const daycareRequest = DaycareRequest.create({
        commitBundle: bundle,
        problemType: currentProblem!.problem_type.name,
        action: bundle.commit!.action,
        args: []
    }); // Empty list of strings

    const stream = daycareClient.daycare(daycareRequest, {});
    let finalBundle: CommitBundle | null = null;

    try {
        for await (const response of stream.responses) {
            if (response.response.oneofKind === 'event') {
                const event = response.response.event;
                if (bundle.commit!.action === 'grade') continue;

                if (event.event === 'files') {
                    for (const [path, content] of Object.entries(event.files)) {
                        console.assert(content instanceof Uint8Array, `File content for ${path} is not Uint8Array in Daycare event`);
                        const whitelist = currentProblem!.problem_step.whitelist;
                        if (whitelist && whitelist[path]) {
                            currentProblem!.merged_files.set(path, content);
                            term.writeln(`downloading file ${path}`);
                        }
                    }
                    renderFileTree();
                } else if (event.event === 'exec') {
                    term.writeln(`$ ${event.execCommand.join(' ')}`);
                } else if (event.event === 'exit') {
                    if (event.exitStatus !== 0) {
                        term.writeln(`exit status ${event.exitStatus}`);
                    }
                } else if (event.event === 'stdin' || event.event === 'stdout' || event.event === 'stderr') {
                    term.write(event.streamData);
                } else if (event.event === 'error') {
                    term.writeln(`Error: ${event.error}`);
                }
            } else if (response.response.oneofKind === 'error') {
                term.writeln(`server return an error: ${response.response.error}`);
                throw new Error(response.response.error);
            }
        }
        console.log('handleDaycare: Daycare stream ended.');
        return finalBundle ?? undefined;
    } catch (err: unknown) {
        console.error('handleDaycare: Daycare stream error:', err);
        if (err instanceof Error) {
            term.writeln(`Daycare stream error: ${err.message}`);
        } else {
            term.writeln(`Daycare stream error: ${String(err)}`);
        }
        throw err;
    }
}


// Function to perform an action as per RPC.md
async function doAction(action: string): Promise<void> {
    const problem = currentProblem;
    if (!problem || !assignment) {
        console.error("Cannot perform action: currentProblem or assignment not loaded.");
        return;
    }

    if (action !== 'save') {
        term!.clear();
    }
    const transport = new GrpcWebFetchTransport({ baseUrl: window.location.origin });
    const client = new CodeGrinderServiceClient(transport);

    try {
        // 1. Re-load the current ProblemStep
        console.log('doAction: Re-loading current problem step...');
        const problemStepRequest = GetProblemStepRequest.create({
            problemId: problem.id,
            step: problem.current_step_number
        });
        const problemStepResponse = await client.getProblemStep(problemStepRequest, {});
        const reloadedProblemStep = problemStepResponse.response.problemStep!;
        problem.problem_step = reloadedProblemStep;
        problem.instructions = reloadedProblemStep.instructions;
        renderInstructionsPane();

        // 2. Identify whitelisted files and collect "student files"
        const studentFiles = new Map<string, Uint8Array>();
        const whitelist = problem.problem_step.whitelist;

        problem.merged_files.forEach((content, path) => {
            if (whitelist[path]) {
                studentFiles.set(path, content);
            }
        });

        // For files that are NOT in the whitelist, replace the version in the active file set with the version from the newly-loaded ProblemStep.
        for (const [path, content] of Object.entries(reloadedProblemStep.files)) {
            console.assert(content instanceof Uint8Array, `File content for ${path} is not Uint8Array in reloadedProblemStep`);
            if (!whitelist[path]) {
                problem.merged_files.set(path, content);
            }
        }
        renderFileTree(); // Re-render file tree to reflect changes

        // 3. Create a Commit object
        const commit = Commit.create({
            id: "0",
            assignmentId: assignment.id,
            problemId: problem.id,
            step: reloadedProblemStep.step,
            files: Object.fromEntries(studentFiles) // Convert Map to plain object
        });
        const now = new Date();
        commit.createdAt = Timestamp.fromDate(now);
        commit.updatedAt = Timestamp.fromDate(now);

        if (action === '') {
            commit.action = '';
            commit.note = 'exam interface: save';
        }

        else {
            commit.action = action;
            commit.note = `exam interface: ${action}`;
        }

        // 4. Create a CommitBundle object
        const commitBundle = CommitBundle.create({
            userId: user.id,
            commit: commit
        });

        // 5. Call PostCommitBundlesUnsignedRequest
        console.log('doAction: Posting unsigned commit bundle...');
        const postUnsignedRequest = PostCommitBundlesUnsignedRequest.create({ bundle: commitBundle });
        const postUnsignedResponse = await client.postCommitBundlesUnsigned(postUnsignedRequest, {});
        let responseBundle = postUnsignedResponse.response.bundle!;
        console.log('doAction: Unsigned commit bundle response:', responseBundle);

        // Mark as saved (no unsaved changes), possibly de-activating the save button.
        (document.getElementById('save-button') as HTMLButtonElement).disabled = true;

        if (action === '') {
            console.log('doAction: Save action complete.');
            return; // End of doAction for save
        }

        // 6. Print the message field from the ProblemStepAction
        const problemTypeActionsList = problem.problem_type.actions;
        const problemStepAction = problemTypeActionsList[action];
        if (problemStepAction && problemStepAction.message) {
            term.writeln(problemStepAction.message);
        }

        // 7. Run the handleDaycare sequence
        const daycareResult = await handleDaycare(responseBundle);
        if (daycareResult) {
            responseBundle = daycareResult;
        }


        if (action !== 'grade') {
            console.log('doAction: Non-grade action complete.');
            return; // End of doAction for non-grade actions
        }

        // For "grade" actions continue with the remaining steps.
        // 8. Construct a new CommitBundle called toSave
        const toSave = CommitBundle.create({
            hostname: responseBundle.hostname,
            userId: responseBundle.userId,
            commit: responseBundle.commit,
            commitSignature: responseBundle.commitSignature
        });

        // Call PostCommitBundlesSigned
        console.log('doAction: Posting signed commit bundle...');
        const postSignedRequest = PostCommitBundlesSignedRequest.create({ bundle: toSave });
        const postSignedResponse = await client.postCommitBundlesSigned(postSignedRequest, {});
        const signedBundle = postSignedResponse.response.bundle!;
        const gradedCommit = signedBundle.commit!;
        console.log('doAction: Signed commit bundle response:', gradedCommit);

        // 9. If the commit has a report_card field with a passed field that is true and the commit has a score field that is equal to 1.0:
        if (gradedCommit.reportCard && gradedCommit.reportCard.passed && gradedCommit.score === 1.0) {
            await nextStep(client, assignment, signedBundle.problem!, reloadedProblemStep, problem.merged_files, new Map());

            // Re-render UI after nextStep might have updated currentProblem
            renderMenuBar();
            renderFileTree();
            renderInstructionsPane();
            loadFirstWhitelistedFileIntoEditor();
        } else {
            // 10. Else: Print failure message and transcript
            term.writeln(`solution for step ${problem.current_step_number} failed`);
            gradedCommit.transcript.forEach((event: EventMessage) => {
                if (event.event === 'exec') {
                    term.writeln(`$ ${event.execCommand.join(' ')}`);
                } else if (event.event === 'exit') {
                    if (event.exitStatus !== 0) {
                        term.writeln(`exit status ${event.exitStatus}`);
                    }
                } else if (event.event === 'stdin' || event.event === 'stdout' || event.event === 'stderr') {
                    term.write(event.streamData);
                } else if (event.event === 'error') {
                    term.writeln(`Error: ${event.error}`);
                }
            });
        }

    } catch (err: unknown) {
        console.error('doAction: Error performing action:', err);
        if (err instanceof Error) {
            term.writeln(`Error performing action: ${err.message}`);
        } else {
            term.writeln(`Error performing action: ${String(err)}`);
        }
    }
}

function loadFirstWhitelistedFileIntoEditor(): void {
    if (!currentProblem || !currentProblem.merged_file_list || currentProblem.merged_file_list.length === 0) {
        return;
    }

    const whitelist = currentProblem.problem_step.whitelist;

    for (const filePath of currentProblem.merged_file_list) {
        // Check if the file is in the whitelist
        if (whitelist && whitelist[filePath]) {
            // Find the corresponding list item in the file tree and simulate a click
            const fileTreeElement = document.querySelector(`.file-tree li[data-path="${filePath}"]`) as HTMLLIElement | null;
            if (fileTreeElement) {
                fileTreeElement.click();
                return; // Stop after loading the first whitelisted file
            }
        }
    }
}

function initializeProblemSelection(): void {
    if (!window.problemSet || window.problemSet.length === 0) {
        console.error("No problems defined in problemSet.");
        return;
    }

    // Select the first problem (already sorted by unique in fetchAndRenderProblems)
    currentProblem = window.problemSet[0];
    console.log("Initial problem selected:", currentProblem.note);
}



async function saveIfNeeded(): Promise<void> {
    // The save action is a no-op if there are no unsaved changes.
    if (hasUserMadeChanges) { // Use the new flag
        console.log("Unsaved changes detected, performing save action...");
        await doAction('');
        hasUserMadeChanges = false; // Reset the flag after saving
    }
}

function renderMenuBar(): void {
    const menuBar = document.getElementById('menu-bar');
    if (!menuBar) return;
    menuBar.innerHTML = ''; // Clear existing content

    if (!currentProblem) {
        return;
    }

    // 1. Problem Selection Buttons
    const problemLabel = document.createElement('span');
    problemLabel.textContent = window.problemSet.length > 1 ? 'Problems:' : 'Problem:';
    problemLabel.classList.add('menu-label');
    menuBar.appendChild(problemLabel);
    window.problemSet.forEach(problem => {
        const problemButton = document.createElement('button');
        problemButton.textContent = problem.note;
        problemButton.classList.add('problem-button');
        if (problem.unique === currentProblem!.unique) {
            problemButton.disabled = true;
            problemButton.classList.add('active-problem');
        } else {
            problemButton.addEventListener('click', async (): Promise<void> => {
                await saveIfNeeded();
                currentProblem = window.problemSet.find(p => p.unique === problem.unique) || null;
                if (currentProblem) {
                    console.log("Problem selected:", currentProblem.note);
                    // Re-render UI based on new problem
                    renderMenuBar();
                    renderFileTree();
                    renderInstructionsPane();
                    selectInstructionsTab();
                    isProgrammaticEditorUpdate = true; // Set flag before dispatch
                    editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: ''}});
                    isProgrammaticEditorUpdate = false; // Reset flag after dispatch
                    if (term) {
                        term.clear();
                    }
                    loadFirstWhitelistedFileIntoEditor();
                }
            });
        }
        menuBar.appendChild(problemButton);
    });

    // Add Actions label
    const actionsLabel = document.createElement('span');
    actionsLabel.textContent = 'Actions:';
    actionsLabel.classList.add('menu-label', 'actions-label');
    menuBar.appendChild(actionsLabel);

    // 3. Save Button
    const saveButton = document.createElement('button');
    saveButton.id = 'save-button';
    saveButton.textContent = 'Save';
    saveButton.disabled = true; // Initially disabled
    saveButton.addEventListener('click', saveIfNeeded);
    menuBar.appendChild(saveButton);

    // 4. Actions Buttons
    // Ensure problem_type and actionsMap exist before accessing
    const actionsMap = currentProblem.problem_type.actions;
    let availableActions = Object.values(actionsMap as any)
        .map((actionObj: any) => {
            const actionName = actionObj.action;
            return { name: actionName, text: actionName.charAt(0).toUpperCase() + actionName.slice(1) };
        })
        .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)); // Sort actions alphabetically

    availableActions.forEach((action: { name: string, text: string }) => {
        const actionButton = document.createElement('button');
        actionButton.id = `action-${action.name}-button`;
        actionButton.textContent = action.text;
        actionButton.addEventListener('click', async (): Promise<void> => {
            console.log(`Action button clicked: ${action.name}`);
            await saveIfNeeded(); // Ensure changes are saved before performing action
            await doAction(action.name);
        });
        menuBar.appendChild(actionButton);
    });
}

function renderFileTree(): void {
    const fileTreePane = document.getElementById('file-tree-pane');
    if (!fileTreePane) return;
    fileTreePane.innerHTML = ''; // Clear existing content

    if (!currentProblem) {
        return;
    }

    const whitelist = currentProblem.problem_step.whitelist;
    console.log('Whitelist files:', Object.keys(whitelist));

    const fileList = currentProblem.merged_file_list;
    const tree = buildFileTree(fileList);
    const ul = document.createElement('ul');
    ul.classList.add('file-tree');
    renderTree(tree, ul, currentProblem.merged_files, currentProblem.problem_step.whitelist, '', currentlyOpenFilePath); // Pass whitelist and empty path for root
    fileTreePane.appendChild(ul);
}

function buildFileTree(filePaths: string[]): { [key: string]: FileTreeNode } {
    const tree: { [key: string]: FileTreeNode } = {};

    filePaths.forEach(path => {
        // Skip the 'doc' top-level folder
        if (path.startsWith('doc/')) {
            return;
        }

        const parts = path.split('/');
        let currentLevel: { [key: string]: FileTreeNode } = tree;

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

function renderTree(node: { [key: string]: FileTreeNode }, parentElement: HTMLElement, mergedFiles: Map<string, Uint8Array>, whitelist: { [key: string]: boolean }, currentPath: string, fileToSelectPath: string | null): void {

    // Helper to check if a path (file or directory) is whitelisted or contains a whitelisted file
    const isWhitelistedRecursive = (itemNode: FileTreeNode, itemFullPath: string): boolean => {
        if (itemNode._is_file) {
            return whitelist && whitelist[itemFullPath];
        } else {
            // It's a directory, check if any child is whitelisted
            for (const childKey in itemNode.children) {
                const childNode = itemNode.children[childKey];
                const childFullPath = childNode._path; // Use _path directly as it's the full path
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

        const aFullPath = itemA._path;
        const bFullPath = itemB._path;

        const aInWhitelist = isWhitelistedRecursive(itemA, aFullPath);
        const bInWhitelist = isWhitelistedRecursive(itemB, bFullPath);

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
        return aIsFile ? 1 : -1; // Directories before files
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
            if (item._path === fileToSelectPath) {
                li.classList.add('selected');
            }
            li.addEventListener('click', async (event: MouseEvent): Promise<void> => {
                event.stopPropagation();
                // Perform save action if there are unsaved changes
                if (!(document.getElementById('save-button') as HTMLButtonElement).disabled) {
                    await saveIfNeeded();
                }

                const previouslySelected = document.querySelector('.file-tree li.selected');
                if (previouslySelected) {
                    previouslySelected.classList.remove('selected');
                }
                li.classList.add('selected');
                console.log("File selected:", item._path);
                currentlyOpenFilePath = item._path; // Update global variable
                const fileContentUint8 = mergedFiles.get(item._path);
                if (!fileContentUint8) return;

                let fileContentString: string;
                let isBinary = false;

                // Check for null bytes to identify potential binary files
                for (let i = 0; i < fileContentUint8.length; i++) {
                    if (fileContentUint8[i] === 0) {
                        isBinary = true;
                        break;
                    }
                }

                const isEditable = (whitelist && whitelist[item._path]) || false;                const effects: StateEffect<any>[] = [];

                if (isBinary) {
                    fileContentString = "This file appears to be a binary file and cannot be displayed in the editor.";
                    effects.push(editableCompartment.reconfigure(EditorView.editable.of(false))); // Binary files are never editable
                } else {
                    fileContentString = new TextDecoder().decode(fileContentUint8);
                    effects.push(editableCompartment.reconfigure(EditorView.editable.of(isEditable))); // Text files' editability depends on whitelist
                }

                const lang = getLanguageExtension(item._path);
                // Reconfigure language
                if (lang) {
                    effects.push(language.reconfigure(lang));
                } else {
                    effects.push(language.reconfigure([]));
                }

                isProgrammaticEditorUpdate = true; // Set flag before dispatch
                editor!.dispatch({
                    changes: {from: 0, to: editor!.state.doc.length, insert: fileContentString},
                    effects: effects
                });
                isProgrammaticEditorUpdate = false; // Reset flag after dispatch
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
            renderTree(item.children, ul, mergedFiles, whitelist, nextPath, fileToSelectPath); // Pass fileToSelectPath
        }
    });
}


function renderInstructionsPane(): void {
    const instructionsPane = document.getElementById('instructions-tab-content');
    if (!instructionsPane) return;
    instructionsPane.innerHTML = ''; // Clear existing content

    if (!currentProblem) {
        return;
    }

    instructionsPane.innerHTML = currentProblem.instructions;
}

function selectInstructionsTab(): void {
    (document.getElementById('instructions-tab-button') as HTMLButtonElement)?.click();
}

function selectTerminalTab(): void {
    (document.getElementById('terminal-tab-button') as HTMLButtonElement)?.click();
}

function initializeTabs(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('.tab-button');
    const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', (): void => {
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => content.classList.remove('active'));
            const contentId = button.id.replace('-button', '-content');
            const activeContent = document.getElementById(contentId);
            if (activeContent) {
                activeContent.classList.add('active');
            }
        });
    });
}

function initializeTerminal(): void {
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
    const terminalElement = document.getElementById('terminal');
    if (terminalElement) {
        term.open(terminalElement);
        fitAddon.fit();
    }
    window.addEventListener('resize', (): void => fitAddon.fit());
}
