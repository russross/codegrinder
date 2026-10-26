import {
    AssignmentKey,
    AssignmentProblemProgress,
    AssignmentActionResult,
    Commit,
    CommitSaveStatus,
    EventMessage,
    GetAssignmentRequest,
    GetWorkspaceRequest,
    HelloRequest,
    RunAssignmentActionRequest,
    SaveWorkspaceCommitRequest,
    WorkspaceFileState,
} from "./codegrinder";
import { CodeGrinderServiceClient } from "./codegrinder.client";
import { Timestamp } from "./google/protobuf/timestamp";
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";

import Split from "split.js";

import { EditorSession } from "./editor-session";
import type { SyncTrigger } from "./editor-session";
import { renderFileTree as renderWorkspaceFileTree } from "./workspace-view";
import { renderInstructions } from "./instructions";
import { changeAffectsPath } from "./workspace";
import type { VmTarget } from "./vm-session";

import { ProblemWorkspace } from "./problem-workspace";
import type { WorkspaceStudentChange } from "./problem-workspace";
import { SaveState } from "./saving";
import { EXAM_FILE_TRANSITION, EXAM_TRANSITION, VmController, vmImageForProblemType } from "./vm";
import { installExamClipboard, registerClipboardTerminal } from "./clipboard";
import { clearTerminal, GradingTerminal } from "./grading-terminal";
import type { TerminalView } from "./terminal";
import type { P9Change } from "@riscbox/storage";

interface ProblemData {
    problemId: string;
    note: string;
    currentStepNumber: bigint;
    firstStepNumber: bigint;
    lastStepNumber: bigint;
    problemType: string;
    actions: string[];
    workspace: ProblemWorkspace;
    instructionsHtml: string;
    instructionPaths: Set<string>;
    isComplete: boolean;
    saving: SaveState;
    target?: ProblemTarget;
    generation: number;
    instructionsGeneration: number;
}

interface ProblemTarget extends VmTarget { readonly problem: ProblemData; readonly generation: number; readonly problemType: string; }

declare global {
    interface Window {
        problemSet: ProblemData[];
    }
}

const DOC_PATH = "doc/doc.md";
const SESSION_STORAGE_KEY = "codegrinderExamSessionKey";
const textDecoder = new TextDecoder();

let currentProblem: ProblemData | null = null;
let editorSession: EditorSession;
let term: TerminalView;
let assignment: AssignmentKey | null = null;
let sessionKey = "";
let vmController: VmController<ProblemTarget>;
let saveQueue: Promise<void> = Promise.resolve();
let actionInProgress = false;

let resetInProgress = false;
let selecting = false;
let selectionReadOnly: boolean | undefined;
let viewGeneration = 0;
let selectionQueue: Promise<void> = Promise.resolve();
let fileSelectionGeneration = 0;
let vmRecoveryInProgress = false;
let restoringEditorFocus = 0;
let unregisterVmClipboard = (): void => {};
let activeAction: AbortController | undefined;

window.problemSet = [];

function createMainClient(): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
        new GrpcWebFetchTransport({
            baseUrl: window.location.origin,
            timeout: 10_000,
            fetchInit: { credentials: "same-origin" },
        }),
    );
}

function authOptions(): RpcOptions {
    if (sessionKey === "") {
        throw new Error("Missing session key");
    }
    return { meta: { authorization: `Bearer ${sessionKey}` } };
}

function getRequiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element;
}

function getRequiredButton(id: string): HTMLButtonElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) {
        throw new Error(`Missing required button: ${id}`);
    }
    return element;
}

function parseAssignmentKeyFromUrl(): AssignmentKey {
    const urlParams = new URLSearchParams(window.location.search);
    const raw = urlParams.get("assignment");
    if (raw === null || raw.trim() === "") {
        throw new Error("Assignment key not found in URL. Expected ?assignment=user:course:problem_set");
    }
    const parts = raw.split(":");
    if (parts.length !== 3 || parts.some((part) => part.trim() === "")) {
        throw new Error(`Invalid assignment key ${JSON.stringify(raw)}. Expected user_id:course_id:problem_set_id`);
    }
    return {
        userId: parts[0],
        courseId: parts[1],
        problemSetId: parts[2],
    };
}

function getLoginTokenFromUrl(): string {
    const raw = new URLSearchParams(window.location.search).get("token");
    return raw === null ? "" : raw;
}

function readStoredSessionKey(): string {
    try {
        return window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "";
    } catch (error: unknown) {
        console.warn("CodeGrinder: exam session storage is unavailable", error);
        return "";
    }
}

function storeSessionKey(value: string): void {
    try {
        if (value === "") {
            window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
            return;
        }
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, value);
    } catch (error: unknown) {
        console.warn("CodeGrinder: could not update exam session storage", error);
    }
}

function removeLoginTokenFromUrl(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", url);
}

async function authenticate(client: CodeGrinderServiceClient): Promise<string> {
    const loginToken = getLoginTokenFromUrl();
    if (loginToken !== "") {
        const helloCall = await client.hello(HelloRequest.create({ token: loginToken }), {});
        const response = helloCall.response;
        if (response.sessionKey === "") {
            throw new Error("Session key not returned from hello");
        }
        if (response.userId === "") {
            throw new Error("User not returned from hello");
        }
        sessionKey = response.sessionKey;
        storeSessionKey(sessionKey);
        removeLoginTokenFromUrl();
        return response.userId;
    }

    sessionKey = readStoredSessionKey();
    if (sessionKey === "") {
        throw new Error("This exam session has ended. Relaunch the assignment from Canvas.");
    }

    try {
        const helloCall = await client.hello(HelloRequest.create({ token: "" }), authOptions());
        if (helloCall.response.userId === "") {
            throw new Error("User not returned from hello");
        }
        return helloCall.response.userId;
    } catch (error: unknown) {
        console.warn("CodeGrinder: could not restore the exam session", error);
        sessionKey = "";
        storeSessionKey("");
        throw new Error("This exam session has expired. Relaunch the assignment from Canvas.");
    }
}

function normalizeRelativePath(raw: string): string {
    if (raw.includes("\\")) {
        throw new Error(`Invalid path from server: ${JSON.stringify(raw)}`);
    }
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("/")) {
        throw new Error(`Invalid path from server: ${JSON.stringify(raw)}`);
    }
    const parts = trimmed.split("/");
    if (parts.some((part) => part === "" || part === "." || part === "..")) {
        throw new Error(`Invalid path from server: ${JSON.stringify(raw)}`);
    }
    return parts.join("/");
}

function assignmentStepFileMap(entries: Record<string, Uint8Array>): Map<string, Uint8Array> {
    const result = new Map<string, Uint8Array>();
    for (const [rawPath, content] of Object.entries(entries)) {
        const path = normalizeRelativePath(rawPath);
        result.set(path, content);
    }
    return result;
}

function buildProblemData(summary: AssignmentProblemProgress, workspace: {
    problemId: string;
    problemNote: string;
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}): ProblemData {
    const systemFiles = assignmentStepFileMap(workspace.systemOwnedFiles);
    const studentFiles = assignmentStepFileMap(workspace.studentOwnedFiles);
    const problemWorkspace = new ProblemWorkspace(systemFiles, studentFiles);
    const instructionPaths = new Set([DOC_PATH]);
    const problem: ProblemData = {
        problemId: summary.problemId,
        note: summary.problemNote,
        currentStepNumber: BigInt(workspace.stepNumber),
        firstStepNumber: BigInt(workspace.firstStepNumber),
        lastStepNumber: BigInt(workspace.lastStepNumber),
        problemType: workspace.problemType,
        actions: [...workspace.actions].sort((left, right) => left.localeCompare(right)),
        workspace: problemWorkspace,
        instructionsHtml: "",
        instructionPaths,
        isComplete: summary.completed,
        saving: new SaveState(problemWorkspace.revision(), (): void => requestAutomaticSave(problem)),
        generation: 0,
        instructionsGeneration: 0,
    };
    problemWorkspace.subscribe((change: WorkspaceStudentChange): void => {
        if (problemWorkspace.isStudentOwned(change.path)) {
            problem.saving.changed();
        }
        if (currentProblem === problem) updateSaveButton();
    });
    problemWorkspace.onFilesystemChange = change => handleWorkspaceChange(problem, change);
    installProblemTarget(problem);
    return problem;
}

function actionLabel(action: string): string {
    return action.length === 0 ? "" : action.charAt(0).toUpperCase() + action.slice(1);
}

function updateSaveButton(): void {
    const saveButton = document.getElementById("save-button");
    if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = actionInProgress || selecting || vmRecoveryInProgress || currentProblem === null
            || (!editorSession.dirty && !currentProblem.saving.isDirty(currentProblem.workspace.revision()));
    }
}

async function applyWorkspaceRefresh(problem: ProblemData, workspace: {
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}): Promise<void> {
    await problem.workspace.refreshFromServer(
        assignmentStepFileMap(workspace.systemOwnedFiles),
        assignmentStepFileMap(workspace.studentOwnedFiles),
    );
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    await refreshInstructions(problem);
}

async function replaceProblemState(problem: ProblemData, workspace: {
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}): Promise<void> {
    problem.generation += 1;
    if (currentProblem === problem) editorSession.clear();
    await problem.workspace.replaceFromServer(
        assignmentStepFileMap(workspace.systemOwnedFiles),
        assignmentStepFileMap(workspace.studentOwnedFiles),
    );
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    installProblemTarget(problem);
    await refreshInstructions(problem);
    problem.saving.stop();
    problem.saving = new SaveState(problem.workspace.revision(), (): void => requestAutomaticSave(problem));
}

function reloadOpenFileFromState(): void {
    const path = editorSession.path;
    if (path === null || currentProblem === null || editorSession.dirty || selecting) return;
    if (currentProblem.workspace.listFiles().includes(path)) {
        const problem = currentProblem;
        updateEditorView(() => editorSession.open(problem.workspace, path));
        if (actionInProgress) editorSession.setReadOnly(true);
    }
}

// Background reloads preserve console focus and leave guest autosave debounce intact.
function updateEditorView(operation: () => void): void {
    const previousFocus = document.activeElement;
    operation();
    if (!(previousFocus instanceof HTMLElement) || editorSession.view.dom.contains(previousFocus)
        || !editorSession.view.dom.contains(document.activeElement)) return;
    restoringEditorFocus += 1;
    previousFocus.focus({ preventScroll: true });
    void editorSession.flush("interaction").catch(reportError).finally(() => { restoringEditorFocus -= 1; });
}

// A read-only renamed buffer must be resolved before any destructive selection.
async function flushEditor(trigger: SyncTrigger): Promise<void> {
    await editorSession.flush(trigger);
    if (!editorSession.dirty) return;
    if ((trigger === "selection" || trigger === "transition") && editorSession.readOnly
        && window.confirm("This file is no longer editable. Discard its buffered edits and continue?")) {
        editorSession.clear();
        return;
    }
    throw new Error("Editor changes could not be synchronized; resolve the current file before continuing");
}

function buildCommit(problem: ProblemData, action: string, note: string): Commit {
    const currentAssignment = assignment;
    if (currentAssignment === null) {
        throw new Error("Assignment not loaded");
    }
    const now = new Date();
    return Commit.create({
        assignment: currentAssignment,
        problemId: problem.problemId,
        step: problem.currentStepNumber.toString(),
        action,
        note,
        files: problem.workspace.studentSubmission(),
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
    });
}

async function fetchWorkspace(
    client: CodeGrinderServiceClient,
    assignmentKey: AssignmentKey,
    problemId: string,
    stepNumber: bigint,
    fileState: WorkspaceFileState = WorkspaceFileState.CURRENT,
): Promise<{
    problemId: string;
    problemNote: string;
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}> {
    const reply = await client.getWorkspace(
        GetWorkspaceRequest.create({
            assignment: assignmentKey,
            problemId,
            stepNumber: stepNumber.toString(),
            fileState,
            includeContents: true,
            includeSolutionFiles: false,
        }),
        authOptions(),
    );
    return reply.response;
}

async function loadProblem(
    client: CodeGrinderServiceClient,
    assignmentKey: AssignmentKey,
    summary: AssignmentProblemProgress,
): Promise<ProblemData> {
    const workspace = await fetchWorkspace(client, assignmentKey, summary.problemId, 0n);
    const problem = buildProblemData(summary, workspace);
    await refreshInstructions(problem);
    return problem;
}

async function loadAssignment(): Promise<void> {
    const client = createMainClient();
    const userId = await authenticate(client);

    assignment = parseAssignmentKeyFromUrl();
    const assignmentCall = await client.getAssignment(GetAssignmentRequest.create({ assignment }), authOptions());
    const assignmentResponse = assignmentCall.response;
    if (assignmentResponse.assignment === undefined) {
        throw new Error("Assignment not returned from GetAssignment");
    }
    if (assignmentResponse.assignment.userId !== userId) {
        throw new Error("Assignment user does not match current user");
    }

    window.problemSet = [];
    for (const summary of assignmentResponse.problems) {
        window.problemSet.push(await loadProblem(client, assignmentResponse.assignment, summary));
    }

    if (window.problemSet.length === 0) {
        throw new Error("Assignment contains no problems");
    }

    await selectProblem(window.problemSet[0]);
}

function writeSaveStatus(status: CommitSaveStatus): void {
    if (status === CommitSaveStatus.SAVED) {
        return;
    }
    selectTerminalTab();
    if (status === CommitSaveStatus.NOT_SAVED_LOCKED) {
        term.writeln("results will not be saved because the assignment is locked");
        return;
    }
    term.writeln("results will not be saved because you do not own this assignment");
}

function writeEvent(event: EventMessage): void {
    if (event.event === "files") {
        return;
    }
    if (event.event === "exec") {
        term.writeln(`$ ${event.execCommand.join(" ")}`);
        return;
    }
    if (event.event === "exit") {
        if (event.exitStatus !== 0) {
            term.writeln(`exit status ${event.exitStatus}`);
        }
        return;
    }
    if (event.event === "stdin" || event.event === "stdout" || event.event === "stderr") {
        term.write(textDecoder.decode(event.streamData));
        return;
    }
    if (event.event === "error") {
        term.writeln(`Error: ${event.error}`);
    }
}

async function handleAction(problem: ProblemData, request: RunAssignmentActionRequest): Promise<AssignmentActionResult> {
    selectTerminalTab();
    term.fit();

    activeAction?.abort();
    const controller = new AbortController();
    activeAction = controller;
    const abort = (): void => controller.abort();
    window.addEventListener("pagehide", abort);
    const stream = createMainClient().runAssignmentAction(request, {
        ...authOptions(), timeout: 120_000,
        abort: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
    });

    try {
        for await (const response of stream.responses) {
            if (response.response.oneofKind === "result") {
                const result = response.response.result;
                if (request.action === "grade" && result.grade === undefined) {
                    throw new Error("Server returned no grade");
                }
                if (request.action !== "grade" && result.grade !== undefined) {
                    throw new Error("Non-grade action returned an unexpected grade");
                }
                return result;
            }
            if (response.response.oneofKind !== "event") {
                throw new Error("Unexpected action response from server");
            }
            if (request.action === "grade") {
                continue;
            }
            const event = response.response.event;
            if (event.event === "files") {
                await applyReturnedFiles(problem, event.files);
                continue;
            }
            writeEvent(event);
        }

        throw new Error("Action stream ended without a completion result");
    } finally {
        controller.abort();
        window.removeEventListener("pagehide", abort);
        if (activeAction === controller) activeAction = undefined;
    }
}

// Returned files update the official workspace without changing VM power state.
async function applyReturnedFiles(problem: ProblemData, files: Readonly<Record<string, Uint8Array>>): Promise<void> {
    for (const [rawPath, content] of Object.entries(files)) {
        const path = normalizeRelativePath(rawPath);
        if (problem.workspace.isStudentOwned(path)) problem.workspace.writeServerStudentFile(path, content);
    }
    await refreshInstructions(problem);
    if (currentProblem === problem) {
        renderFileTree();
        renderInstructionsPane();
        reloadOpenFileFromState();
    }
}

async function advanceProblem(problem: ProblemData): Promise<void> {
    term.writeln(`step ${problem.currentStepNumber.toString()} passed`);
    selectTerminalTab();
    if (problem.currentStepNumber >= problem.lastStepNumber) {
        problem.isComplete = true;
        term.writeln("you have completed all steps for this problem");
        return;
    }
    const nextStepNumber = problem.currentStepNumber + 1n;
    const client = createMainClient();
    const currentAssignment = assignment;
    if (currentAssignment === null) {
        throw new Error("Assignment not loaded");
    }
    const workspace = await fetchWorkspace(client, currentAssignment, problem.problemId, nextStepNumber);
    selectInstructionsTab();
    await replaceProblemState(problem, workspace);
    await activateProblem(problem, () => currentProblem === problem);
    term.writeln(`moving to step ${problem.currentStepNumber.toString()}`);
}

async function refreshProblem(problem: ProblemData): Promise<boolean> {
    const currentAssignment = assignment;
    if (currentAssignment === null) {
        throw new Error("Assignment not loaded");
    }
    const saving = problem.saving;
    const generation = problem.generation;
    const client = createMainClient();
    const refreshedWorkspace = await fetchWorkspace(client, currentAssignment, problem.problemId, problem.currentStepNumber);
    if (problem.saving !== saving || generation !== problem.generation) {
        return false;
    }
    const activeTarget = vmController.target;
    if (currentProblem !== problem && activeTarget?.problem !== problem) return true;
    await applyWorkspaceRefresh(problem, refreshedWorkspace);
    if (currentProblem === problem && !selecting) {
        renderFileTree();
        renderInstructionsPane();
        updateInstructionsTabVisibility();
        if (!editorSession.dirty) {
            reloadOpenFileFromState();
        }
    }
    return true;
}

async function saveProblem(problem: ProblemData): Promise<void> {
    if (!await refreshProblem(problem)) {
        return;
    }
    await persistCaptured(problem);
}

// Transition persistence does not wait on its enclosing selection operation.
async function persistCaptured(problem: ProblemData, captured = {
    saving: problem.saving,
    generation: problem.generation,
    revision: problem.workspace.revision(),
    commit: buildCommit(problem, "", "exam interface: save"),
}): Promise<void> {
    const { saving, generation, revision, commit } = captured;
    if (generation !== problem.generation || saving !== problem.saving) return;
    saving.submitted();
    const saved = await createMainClient().saveWorkspaceCommit(SaveWorkspaceCommitRequest.create({ commit }), authOptions());
    if (problem.saving !== saving || problem.generation !== generation) {
        return;
    }
    if (saved.response.saveStatus !== CommitSaveStatus.SAVED) {
        throw new Error(saved.response.saveStatus === CommitSaveStatus.NOT_SAVED_LOCKED
            ? "Work was not saved because the assignment is locked"
            : "Work was not saved because you do not own this assignment");
    }
    saving.acknowledge(revision, problem.workspace.revision());
    if (saving.isDirty(problem.workspace.revision())) saving.retry();
    updateSaveButton();
}

function enqueuePersistence(problem: ProblemData): Promise<boolean> {
    const captured = {
        saving: problem.saving, generation: problem.generation, revision: problem.workspace.revision(),
        commit: buildCommit(problem, "", "exam interface: save"),
    };
    const operation = saveQueue.then(async () => {
        if (!captured.saving.isDirty(captured.revision)) return true;
        try { await persistCaptured(problem, captured); return true; }
        catch (error: unknown) { captured.saving.retry(); reportError(error); return false; }
    });
    saveQueue = operation.then(() => undefined, reportError);
    return operation;
}

async function doAction(problem: ProblemData, action: string): Promise<void> {
    const saving = problem.saving;
    clearTerminal(term);
    if (!await refreshProblem(problem)) {
        return;
    }

    const label = actionLabel(action);
    if (label !== "") {
        term.writeln(label);
        selectTerminalTab();
    }

    const submittedRevision = problem.workspace.revision();
    const currentAssignment = assignment;
    if (currentAssignment === null) throw new Error("Assignment not loaded");
    const request = RunAssignmentActionRequest.create({
        assignment: currentAssignment,
        problemId: problem.problemId,
        step: problem.currentStepNumber.toString(),
        action,
        note: `exam interface: ${action}`,
        files: problem.workspace.studentSubmission(),
    });
    saving.submitted();
    const result = await handleAction(problem, request);
    if (result.saveStatus === CommitSaveStatus.SAVED) {
        saving.acknowledge(submittedRevision, problem.workspace.revision());
    } else {
        saving.retry();
    }
    updateSaveButton();
    if (action !== "grade") { writeSaveStatus(result.saveStatus); return; }

    // Completion follows the server's result-save transaction. Applying its
    // files can introduce a newer local revision that still needs persistence.
    const gradedCommit = result.grade;
    if (gradedCommit === undefined) throw new Error("Server returned no grade");
    await applyReturnedFiles(problem, gradedCommit.files);

    const passed = gradedCommit.reportCard?.passed === true && gradedCommit.score === 1.0;
    if (passed) {
        if (result.saveStatus === CommitSaveStatus.SAVED) {
            await advanceProblem(problem);
            renderMenuBar();
            renderFileTree();
            renderInstructionsPane();
            updateInstructionsTabVisibility();
        } else {
            term.writeln(`step ${problem.currentStepNumber.toString()} passed`);
        }
    } else {
        term.writeln(`solution for step ${problem.currentStepNumber.toString()} failed`);
        for (const event of gradedCommit.transcript) {
            writeEvent(event);
        }
    }
    writeSaveStatus(result.saveStatus);
    if (result.lockedForLms && result.saveStatus === CommitSaveStatus.SAVED) {
        term.writeln("Grade was not posted to the LMS because the assignment is locked");
    }
}

function setActionInProgress(inProgress: boolean): void {
    actionInProgress = inProgress;
    renderMenuBar();
    if (inProgress) editorSession.setReadOnly(true);
    else if (editorSession.path !== null && currentProblem !== null) {
        editorSession.setReadOnly(!currentProblem.workspace.isStudentOwned(editorSession.path)
            || currentProblem.workspace.readFile(editorSession.path).includes(0));
    }
    getRequiredButton("vm-tab-button").disabled = inProgress;
    updateVmControls();
}

async function requestSave(problem: ProblemData | null = currentProblem, action: string = ""): Promise<boolean> {
    if (problem === null) {
        return false;
    }
    const generation = problem.generation;
    await selectionQueue;
    if (generation !== problem.generation) return false;
    if (currentProblem === problem) {
        try { await flushEditor("explicit"); }
        catch (error: unknown) { reportError(error); return false; }
    }
    if (action !== "") {
        if (actionInProgress) {
            return false;
        }
        setActionInProgress(true);
    }
    const saving = problem.saving;
    saving.cancelTimer();
    const operation = saveQueue.then(async (): Promise<boolean> => {
        const step = problem.currentStepNumber;
        try {
            if (problem.saving !== saving) {
                return false;
            }
            if (action === "" && !saving.isDirty(problem.workspace.revision())) {
                return true;
            }
            if (action === "") {
                if (currentProblem === problem) await saveProblem(problem);
                else await persistCaptured(problem);
            } else {
                await doAction(problem, action);
            }
            return true;
        } catch (error: unknown) {
            if (problem.saving === saving && saving.isDirty(problem.workspace.revision())) {
                saving.retry();
            }
            console.error("Save or action failed", error);
            selectTerminalTab();
            term.writeln(`${action === "" ? "Save" : actionLabel(action)} failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        } finally {
            if (action !== "") {
                if (problem.currentStepNumber !== step && currentProblem === problem) {
                    editorSession.clear();
                }
                setActionInProgress(false);
                if (problem.currentStepNumber !== step && currentProblem === problem) {
                    loadFirstEditableFileIntoEditor();
                    renderInstructionsPane();
                    updateInstructionsTabVisibility();
                    selectDefaultTab();
                }
            }
        }
    });
    const save = operation.catch((error: unknown): boolean => {
        console.error("Unexpected save queue failure", error);
        return false;
    });
    saveQueue = save.then((): void => {});
    return save;
}

function requestAutomaticSave(problem: ProblemData | null = currentProblem): void {
    if (vmRecoveryInProgress || restoringEditorFocus > 0) return;
    void requestSave(problem).catch(reportError);
}

async function requestReset(): Promise<void> {
    const problem = currentProblem;
    const currentAssignment = assignment;
    if (problem === null || currentAssignment === null || actionInProgress || resetInProgress) {
        return;
    }
    resetInProgress = true;
    renderMenuBar();
    const path = editorSession.path;
    const step = problem.currentStepNumber;
    try {
        const workspace = await fetchWorkspace(
            createMainClient(), currentAssignment, problem.problemId, step, WorkspaceFileState.STEP_START,
        );
        await saveQueue;
        if (currentProblem !== problem || problem.currentStepNumber !== step || editorSession.path !== path) {
            return;
        }
        await flushEditor("explicit");
        await applyWorkspaceRefresh(problem, workspace);
        renderFileTree();
        renderInstructionsPane();
        updateInstructionsTabVisibility();
        reloadOpenFileFromState();
        const starterFiles = assignmentStepFileMap(workspace.studentOwnedFiles);
        const dialog = document.getElementById("reset-dialog");
        if (!(dialog instanceof HTMLDialogElement)) {
            throw new Error("Reset dialog is missing");
        }
        const confirmed = await new Promise<boolean>((resolve) => {
            let revision = problem.workspace.revision();
            const render = (): void => {
                revision = problem.workspace.revision();
                const changed = [...starterFiles].filter(([filePath, starter]) => {
                    const local = problem.workspace.readVisibleFile(filePath);
                    return local === undefined || local.length !== starter.length
                        || starter.some((byte, i) => byte !== local[i]);
                }).map(([filePath]) => filePath).sort();
                const canReset = path !== null && changed.includes(path) && problem.workspace.isStudentOwned(path);
                const message = document.createElement("p");
                message.textContent = changed.length === 0
                    ? "All files are already in their reset state, nothing to do"
                    : canReset
                        ? "Warning! This will throw away all changes you have made to this file since the beginning of this step! The editor's undo function may be able to restore the changes."
                        : "Reset only applies to the file you are currently editing";
                dialog.replaceChildren(message);
                if (changed.length > 0) {
                    const heading = document.createElement("h2");
                    heading.textContent = "Changed files";
                    const list = document.createElement("ul");
                    for (const filePath of changed) {
                        const item = document.createElement("li");
                        item.textContent = filePath;
                        list.appendChild(item);
                    }
                    dialog.append(heading, list);
                }
                const cancel = document.createElement("button");
                cancel.type = "button";
                cancel.textContent = "Cancel";
                cancel.autofocus = true;
                cancel.addEventListener("click", (): void => { dialog.close(); resolve(false); });
                if (canReset) {
                    const accept = document.createElement("button");
                    accept.type = "button";
                    accept.textContent = "Reset";
                    accept.addEventListener("click", (): void => {
                        if (problem.workspace.revision() !== revision) {
                            render();
                            cancel.focus();
                            return;
                        }
                        dialog.close();
                        resolve(true);
                    });
                    dialog.appendChild(accept);
                }
                dialog.appendChild(cancel);
            };
            render();
            dialog.showModal();
        });
        if (!confirmed || path === null || currentProblem !== problem || problem.currentStepNumber !== step) {
            return;
        }
        const starter = starterFiles.get(path);
        if (starter === undefined) {
            throw new Error("Reset file is missing from the step-start workspace");
        }
        problem.workspace.writeStudentFile(path, starter);
        reloadOpenFileFromState();
        await requestSave(problem);
    } catch (error: unknown) {
        selectTerminalTab();
        term.writeln(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        resetInProgress = false;
        renderMenuBar();
    }
}

function loadFirstEditableFileIntoEditor(): void {
    if (currentProblem === null) {
        return;
    }
    const studentOwnedPaths = currentProblem.workspace.studentOwnedPaths();
    for (const filePath of currentProblem.workspace.visiblePaths()) {
        if (!studentOwnedPaths.has(filePath)) {
            continue;
        }
        editorSession.open(currentProblem.workspace, filePath);
        if (actionInProgress) editorSession.setReadOnly(true);
        renderFileTree();
        return;
    }
}

function renderMenuBar(): void {
    const menuItems = document.getElementById("menu-items");
    if (menuItems === null || currentProblem === null) {
        return;
    }
    const displayedProblem = currentProblem;
    menuItems.innerHTML = "";

    const problemLabel = document.createElement("span");
    problemLabel.textContent = window.problemSet.length > 1 ? "Problems:" : "Problem:";
    problemLabel.classList.add("menu-label");
    menuItems.appendChild(problemLabel);

    for (const problem of window.problemSet) {
        const problemButton = document.createElement("button");
        problemButton.textContent = problem.isComplete ? `✓ ${problem.note}` : problem.note;
        problemButton.classList.add("problem-button");
        if (problem.problemId === currentProblem.problemId) {
            problemButton.disabled = true;
            problemButton.classList.add("active-problem");
        } else {
            problemButton.disabled = actionInProgress || resetInProgress || vmRecoveryInProgress;
            problemButton.addEventListener("click", () => { void selectProblem(problem).catch(reportError); });
        }
        menuItems.appendChild(problemButton);
    }

    const actionsLabel = document.createElement("span");
    actionsLabel.textContent = "Actions:";
    actionsLabel.classList.add("menu-label", "actions-label");
    menuItems.appendChild(actionsLabel);

    const saveButton = document.createElement("button");
    saveButton.id = "save-button";
    saveButton.textContent = "Save";
    saveButton.disabled = actionInProgress || selecting || vmRecoveryInProgress
        || (!editorSession.dirty && !currentProblem.saving.isDirty(currentProblem.workspace.revision()));
    saveButton.addEventListener("click", (): void => {
        requestAutomaticSave(displayedProblem);
    });
    menuItems.appendChild(saveButton);

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.textContent = "Reset";
    resetButton.disabled = actionInProgress || resetInProgress || selecting || vmRecoveryInProgress;
    resetButton.addEventListener("click", (): void => { void requestReset(); });
    menuItems.appendChild(resetButton);

    for (const action of currentProblem.actions) {
        const actionButton = document.createElement("button");
        actionButton.id = `action-${action}-button`;
        actionButton.textContent = actionLabel(action);
        actionButton.disabled = actionInProgress || resetInProgress || selecting || vmRecoveryInProgress;
        actionButton.addEventListener("click", (): void => {
            if (actionInProgress) {
                return;
            }
            void requestSave(displayedProblem, action);
        });
        menuItems.appendChild(actionButton);
    }
}

function renderFileTree(): void {
    const fileTreePane = document.getElementById("file-tree-pane");
    if (fileTreePane === null || currentProblem === null) {
        return;
    }
    const problem = currentProblem;
    renderWorkspaceFileTree(fileTreePane, problem.workspace.visiblePaths().filter(path => !path.startsWith("doc/")), {
        selectedPath: editorSession.path,
        priority: path => problem.workspace.isStudentOwned(path) ? 0 : 1,
        onSelect: path => { void selectFile(problem, path).catch(reportError); },
    });
}

async function refreshInstructions(problem: ProblemData): Promise<void> {
    const generation = ++problem.instructionsGeneration;
    const dependencies = new Set([DOC_PATH]);
    try {
        const html = await renderInstructions(problem.workspace, dependencies, DOC_PATH);
        if (generation === problem.instructionsGeneration) problem.instructionsHtml = html;
    } catch (error: unknown) {
        if (generation === problem.instructionsGeneration) {
            const message = document.createElement("p");
            message.setAttribute("role", "status");
            message.textContent = `Could not display instructions: ${error instanceof Error ? error.message : String(error)}`;
            problem.instructionsHtml = message.outerHTML;
        }
    } finally {
        if (generation === problem.instructionsGeneration) problem.instructionPaths = dependencies;
    }
    if (currentProblem === problem && !selecting) {
        renderInstructionsPane();
        updateInstructionsTabVisibility();
    }
}

function renderInstructionsPane(): void {
    const instructionsPane = document.getElementById("instructions-tab-content");
    if (!(instructionsPane instanceof HTMLElement)) {
        return;
    }
    instructionsPane.innerHTML = currentProblem?.instructionsHtml ?? "";
}

function updateInstructionsTabVisibility(): void {
    const button = document.getElementById("instructions-tab-button");
    const content = document.getElementById("instructions-tab-content");
    if (!(button instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        return;
    }
    const visible = currentProblem !== null && currentProblem.instructionsHtml !== "";
    button.style.display = visible ? "" : "none";
    content.style.display = visible ? "" : "none";
    if (!visible && button.classList.contains("active") && !selecting && !actionInProgress) {
        selectDefaultTab();
    }
}

function installProblemTarget(problem: ProblemData): void {
    const image = vmImageForProblemType(problem.problemType);
    problem.target = image === undefined ? undefined : {
        problem, image, generation: problem.generation, problemType: problem.problemType,
        loadFiles: async () => problem.workspace.currentFiles(),
    };
}

function initializeVm(): void {
    unregisterVmClipboard();
    vmController = new VmController(getRequiredElement("vm-terminal"), {
        flushEditor: () => flushEditor("interaction"),
        canInteract: () => !selecting && !resetInProgress && !actionInProgress && !vmRecoveryInProgress,
        beforeReplace: () => {
            if (vmRecoveryInProgress) return;
            editorSession.clear();
            for (const problem of window.problemSet) problem.workspace.attach(undefined);
        },
        afterHalt: async target => {
            if (target.generation !== target.problem.generation) return;
            target.problem.workspace.attach(vmController.filesystem);
            target.problem.workspace.captureStudentFiles();
            if (vmRecoveryInProgress) return;
            if (!await enqueuePersistence(target.problem)) throw new Error("Outgoing work could not be saved");
        },
        afterSnapshot: async () => {},
        onFilesystemChange: change => {
            const target = vmController.target;
            if (target === undefined || target.generation !== target.problem.generation) return;
            target.problem.workspace.attach(vmController.filesystem);
            handleWorkspaceChange(target.problem, change);
        },
        onStateChange: updateVmControls,
        onError: reportError,
    });
    unregisterVmClipboard = registerClipboardTerminal(vmController.terminal);
}

function reportError(error: unknown): void {
    console.error("Exam operation failed", error);
    term.writeln(error instanceof Error ? error.message : String(error));
}

// Rebuilding the share must not turn reset events into editor conflicts or saves.
function handleWorkspaceChange(problem: ProblemData, change: P9Change): void {
    if (vmRecoveryInProgress || problem.workspace.rebuilding) return;
    problem.workspace.handleFilesystemChange(change);
    if (currentProblem !== problem || selecting) return;
    if (change.source !== "guest" || (editorSession.path !== null && problem.workspace.isStudentOwned(editorSession.path))) {
        updateEditorView(() => editorSession.handleChange(change));
    }
    if (editorSession.path !== null && (!problem.workspace.isStudentOwned(editorSession.path) || actionInProgress)) {
        editorSession.setReadOnly(true);
    }
    if ([...problem.instructionPaths].some(path => changeAffectsPath(change, path)
        && (change.source !== "guest" || problem.workspace.isStudentOwned(path)))) {
        void refreshInstructions(problem).catch(reportError);
    }
    if (change.kind !== "write" && change.kind !== "metadata") renderFileTree();
}

async function activateProblem(problem: ProblemData, isCurrent: () => boolean): Promise<boolean> {
    const target = problem.target;
    if (target === undefined) {
        await vmController.forceHalt();
        const previous = vmController.target;
        if (previous !== undefined && previous.generation === previous.problem.generation) {
            previous.problem.workspace.captureStudentFiles();
            if (!await enqueuePersistence(previous.problem)) throw new Error("Outgoing work could not be saved");
        }
        if (!isCurrent()) return false;
        for (const item of window.problemSet) item.workspace.attach(undefined);
        await vmController.destroy();
        // A new session has a fresh terminal and no stale filesystem handles.
        initializeVm();
        editorSession.clear();
    } else {
        const transition = vmController.target?.problemType === target.problemType
            ? EXAM_FILE_TRANSITION : EXAM_TRANSITION;
        if (!await vmController.setTarget(target, transition, isCurrent)) return false;
        problem.workspace.attach(vmController.filesystem);
    }
    return isCurrent();
}

// Selections recover their queue after failure and never display superseded targets.
function selectProblem(problem: ProblemData): Promise<void> {
    const generation = ++viewGeneration;
    const isCurrent = (): boolean => generation === viewGeneration;
    const operation = selectionQueue.then(async () => {
        if (!isCurrent()) return;
        const previousAccess = editorSession.readOnly;
        await flushEditor("transition");
        selectionReadOnly = previousAccess;
        selecting = true;
        selectInstructionsTab();
        editorSession.setReadOnly(true);
        updateVmControls();
        try {
            if (currentProblem?.target === undefined && currentProblem !== null
                && !await enqueuePersistence(currentProblem)) throw new Error("Outgoing work could not be saved");
            if (!await activateProblem(problem, isCurrent)) return;
            currentProblem = problem;
            editorSession.clear();
            await refreshInstructions(problem);
            clearTerminal(term);
        } finally {
            selecting = false;
            editorSession.setReadOnly(previousAccess);
            selectionReadOnly = undefined;
            renderMenuBar();
            renderFileTree();
            renderInstructionsPane();
            updateInstructionsTabVisibility();
            updateVmControls();
        }
        if (isCurrent()) {
            loadFirstEditableFileIntoEditor();
            selectDefaultTab();
        }
    });
    selectionQueue = operation.catch(reportError);
    return operation;
}

async function selectFile(problem: ProblemData, path: string): Promise<void> {
    if (actionInProgress || resetInProgress || selecting || vmRecoveryInProgress || currentProblem !== problem) return;
    const generation = viewGeneration;
    const fileGeneration = ++fileSelectionGeneration;
    await flushEditor("selection");
    if (!await requestSave(problem) || generation !== viewGeneration || currentProblem !== problem
        || fileGeneration !== fileSelectionGeneration) return;
    editorSession.open(problem.workspace, path);
    renderFileTree();
}

function updateVmControls(): void {
    const supported = currentProblem?.target !== undefined;
    const state = vmController.state;
    const boot = getRequiredButton("vm-boot-button");
    boot.hidden = !supported;
    boot.disabled = !supported || selecting || actionInProgress || resetInProgress || vmRecoveryInProgress
        || state === "loading";
    boot.textContent = state === "stopping" ? "Reset VM" : state === "running" ? "Reboot VM"
        : state === "loading" ? "Preparing VM…" : "Boot VM";
    getRequiredButton("vm-tab-button").hidden = !supported;
}

// Emergency halt bypasses the selection queue so it can release a stuck shutdown.
async function resetVm(): Promise<void> {
    if (actionInProgress || resetInProgress || vmRecoveryInProgress || vmController.state === "loading") return;
    const previousAccess = selectionReadOnly ?? editorSession.readOnly;
    vmRecoveryInProgress = true;
    editorSession.setReadOnly(true);
    renderMenuBar();
    updateVmControls();
    ++viewGeneration;
    try {
        await vmController.forceHalt();
        const operation = selectionQueue.then(() => vmController.reset());
        selectionQueue = operation.then(() => undefined, reportError);
        await operation;
    } finally {
        vmRecoveryInProgress = false;
        editorSession.setReadOnly(previousAccess);
        if (currentProblem?.saving.isDirty(currentProblem.workspace.revision())) currentProblem.saving.retry();
        renderMenuBar();
        updateVmControls();
    }
}

function selectDefaultTab(): void {
    if (currentProblem?.instructionsHtml !== "") selectInstructionsTab();
    else if (currentProblem?.target !== undefined) selectVmTab();
    else selectTerminalTab();
}

function selectInstructionsTab(): void {
    const button = document.getElementById("instructions-tab-button");
    if (button instanceof HTMLButtonElement && button.style.display !== "none") {
        button.click();
    }
}

function selectTerminalTab(): void {
    const button = document.getElementById("terminal-tab-button");
    if (button instanceof HTMLButtonElement) {
        button.click();
    }
}

function selectVmTab(): void {
    const button = document.getElementById("vm-tab-button");
    if (button instanceof HTMLButtonElement && !button.hidden) {
        button.click();
    }
}

function initializeTabs(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-button");
    const tabContents = document.querySelectorAll<HTMLElement>(".tab-content");

    for (const button of tabButtons) {
        button.addEventListener("click", (): void => {
            if (actionInProgress && button.id === "vm-tab-button") {
                return;
            }
            for (const candidate of tabButtons) {
                candidate.classList.remove("active");
            }
            button.classList.add("active");

            for (const content of tabContents) {
                content.classList.remove("active");
            }
            const contentId = button.id.replace("-button", "-content");
            const activeContent = document.getElementById(contentId);
            if (activeContent instanceof HTMLElement) {
                activeContent.classList.add("active");
            }
            if (button.id === "vm-tab-button") {
                vmController.fit();
                void flushEditor("interaction").then(() => vmController.bootIfInactive()).catch(reportError);
            }
            if (button.id === "terminal-tab-button") {
                term.fit();
                term.focus();
            }
        });
    }
}

async function initializeTerminal(): Promise<void> {
    term = new GradingTerminal(getRequiredElement("terminal"));
    await term.ready;
    registerClipboardTerminal(term);
}

async function initialize(): Promise<void> {
    getRequiredElement("reset-dialog").addEventListener("cancel", (event: Event): void => {
        event.preventDefault();
    });
    Split(["#file-tree-pane", "#editor-pane", "#info-pane"], {
        sizes: [10, 45, 45],
        gutterSize: 8,
        cursor: "grabbing",
        onDrag: (): void => {
            if (term !== undefined) {
                term.fit();
            }
            if (vmController !== undefined) {
                vmController.fit();
            }
        },
    });

    initializeTabs();
    await initializeTerminal();
    editorSession = new EditorSession(getRequiredElement("editor-pane"), {
        canEdit: path => !actionInProgress && !selecting && currentProblem?.workspace.isStudentOwned(path) === true,
        onChange: () => updateSaveButton(),
        onSynced: trigger => {
            if (trigger === "blur" || trigger === "timer") requestAutomaticSave();
        },
        onError: reportError,
        confirmDiscard: () => window.confirm("The workspace changed this file while you have unsaved edits. Use the workspace version and discard your edits?"),
    });
    installExamClipboard(editorSession.view);
    initializeVm();
    await vmController.ready;
    getRequiredButton("vm-boot-button").addEventListener("click", () => {
        if (vmController.state === "stopping") {
            void resetVm().catch(reportError);
            return;
        }
        void flushEditor("interaction").then(async () => {
            const running = vmController.runtime?.started === true;
            selectVmTab();
            if (running) await vmController.reboot();
        }).catch(reportError);
    });
    getRequiredButton("vm-boot-button").addEventListener("pointerdown", event => {
        // A second reboot click must preserve buffered edits during forced reset.
        if (vmController.state === "stopping") event.preventDefault();
    });

    await loadAssignment();
}

document.addEventListener("DOMContentLoaded", (): void => {
    void initialize().catch((error: unknown): void => {
        console.error("Error loading exam client:", error);
        const menuItems = document.getElementById("menu-items");
        if (menuItems instanceof HTMLElement) {
            const message = document.createElement("p");
            message.style.color = "red";
            message.textContent = error instanceof Error ? error.message : "Error loading exam data";
            menuItems.replaceChildren(message);
        }
    });
});
