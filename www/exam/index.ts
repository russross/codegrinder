import * as commonmark from "commonmark";

import {
    AssignmentKey,
    AssignmentProblemProgress,
    Commit,
    CommitSaveStatus,
    DaycareRequest,
    EventMessage,
    GetAssignmentRequest,
    GetWorkspaceRequest,
    GradingCommit,
    HelloRequest,
    RuntimeBundle,
    SaveGradedCommitRequest,
    SaveUngradedCommitRequest,
    SaveWorkspaceCommitRequest,
    SignedRuntimeBundle,
    WorkspaceFileState,
} from "./codegrinder";
import { CodeGrinderServiceClient } from "./codegrinder.client";
import { Timestamp } from "./google/protobuf/timestamp";
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";

import Split from "split.js";

import { EditorView, keymap, ViewUpdate } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { cpp } from "@codemirror/lang-cpp";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { StreamLanguage, LanguageSupport } from "@codemirror/language";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";

import { ProblemWorkspace } from "./workspace";
import type { WorkspaceStudentChange } from "./workspace";
import { VmController, vmImageForProblemType } from "./vm";

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
    isComplete: boolean;
    savedWorkspaceRevision: number;
}

interface FileTreeNode {
    isFile: boolean;
    fullPath: string;
    children: Record<string, FileTreeNode>;
}

declare global {
    interface Window {
        problemSet: ProblemData[];
    }
}

const DOC_PATH = "doc/doc.md";
const SESSION_STORAGE_KEY = "codegrinderExamSessionKey";
const AUTOSAVE_DELAY_MS = 30_000;
const markdownParser = new commonmark.Parser();
const markdownRenderer = new commonmark.HtmlRenderer();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let currentProblem: ProblemData | null = null;
let editor: EditorView;
let fitAddon: FitAddon;
let term: Terminal;
let assignment: AssignmentKey | null = null;
let userId = "";
let sessionKey = "";
let currentlyOpenFilePath: string | null = null;
let isProgrammaticEditorUpdate = false;
let vmController: VmController;
let autosaveTimer: number | undefined;
let saveInFlight: Promise<void> | undefined;

const language = new Compartment();
const editableCompartment = new Compartment();

window.problemSet = [];

function softTab(view: EditorView): boolean {
    const tabSize = 4;
    const transaction = view.state.changeByRange((range) => {
        const line = view.state.doc.lineAt(range.from);
        const column = range.from - line.from;
        let spacesToInsert = tabSize - (column % tabSize);
        if (spacesToInsert === 0) {
            spacesToInsert = tabSize;
        }
        const insert = " ".repeat(spacesToInsert);
        return {
            changes: { from: range.from, to: range.to, insert },
            range: EditorSelection.cursor(range.from + insert.length),
        };
    });
    view.dispatch(transaction);
    return true;
}

function getLanguageExtension(filename: string): LanguageSupport | null {
    const ext = filename.split(".").pop();
    switch (ext) {
        case "c":
        case "h":
            return cpp();
        case "s":
        case "S":
            return new LanguageSupport(StreamLanguage.define(gas));
        case "md":
            return markdown();
        case "py":
            return python();
        default:
            break;
    }
    if (filename.endsWith("Makefile")) {
        return new LanguageSupport(StreamLanguage.define(shell));
    }
    return null;
}

function createMainClient(): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
        new GrpcWebFetchTransport({
            baseUrl: window.location.origin,
            fetchInit: { credentials: "same-origin" },
        }),
    );
}

function createPageExitClient(): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
        new GrpcWebFetchTransport({
            baseUrl: window.location.origin,
            fetchInit: { credentials: "same-origin", keepalive: true },
        }),
    );
}

function authOptions(): RpcOptions {
    if (sessionKey === "") {
        throw new Error("Missing session key");
    }
    return { meta: { authorization: `Bearer ${sessionKey}` } };
}

function createDaycareClient(hostname: string): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
        new GrpcWebFetchTransport({
            baseUrl: `${window.location.protocol}//${hostname}`,
            fetchInit: { credentials: "omit" },
        }),
    );
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

function bytesToBase64(content: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < content.length; offset += 32768) {
        chunks.push(String.fromCharCode(...content.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(""));
}

function imageMimeType(path: string): string | null {
    const parts = path.split(".");
    const extension = parts[parts.length - 1]?.toLowerCase();
    switch (extension) {
        case "gif": return "image/gif";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "png": return "image/png";
        case "svg": return "image/svg+xml";
        default: return null;
    }
}

function renderInstructionsMarkdown(workspace: ProblemWorkspace): string {
    const file = workspace.readVisibleFile(DOC_PATH);
    if (file === undefined) {
        return "";
    }
    const source = textDecoder.decode(file);
    const document = markdownParser.parse(source);
    const documentUrl = new URL(DOC_PATH, "https://workspace.invalid/");
    const walker = document.walker();
    let event = walker.next();
    while (event !== null) {
        if (event.entering && event.node.type === "image" && event.node.destination !== null) {
            const url = new URL(event.node.destination, documentUrl);
            if (url.origin === documentUrl.origin) {
                const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
                const content = workspace.readVisibleFile(path);
                const mimeType = imageMimeType(path);
                if (content === undefined) {
                    throw new Error(`Instruction image not found: ${path}`);
                }
                if (mimeType === null) {
                    throw new Error(`Instruction image has an unsupported type: ${path}`);
                }
                event.node.destination = `data:${mimeType};base64,${bytesToBase64(content)}`;
            }
        }
        event = walker.next();
    }
    return markdownRenderer.render(document);
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
    const problem: ProblemData = {
        problemId: summary.problemId,
        note: summary.problemNote,
        currentStepNumber: BigInt(workspace.stepNumber),
        firstStepNumber: BigInt(workspace.firstStepNumber),
        lastStepNumber: BigInt(workspace.lastStepNumber),
        problemType: workspace.problemType,
        actions: [...workspace.actions].sort((left, right) => left.localeCompare(right)),
        workspace: problemWorkspace,
        instructionsHtml: renderInstructionsMarkdown(problemWorkspace),
        isComplete: summary.completed,
        savedWorkspaceRevision: problemWorkspace.revision(),
    };
    problemWorkspace.subscribe((change: WorkspaceStudentChange): void => {
        if (currentProblem !== problem) {
            return;
        }
        updateSaveButton();
        if (currentlyOpenFilePath === change.path) {
            reloadOpenFileFromState();
        }
    });
    return problem;
}

function actionLabel(action: string): string {
    return action.length === 0 ? "" : action.charAt(0).toUpperCase() + action.slice(1);
}

function isBinaryFile(content: Uint8Array): boolean {
    for (const value of content) {
        if (value === 0) {
            return true;
        }
    }
    return false;
}

function getCurrentProblemOrThrow(): ProblemData {
    if (currentProblem === null) {
        throw new Error("No current problem");
    }
    return currentProblem;
}

function updateSaveButton(): void {
    const saveButton = document.getElementById("save-button");
    if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = currentProblem === null
            || currentProblem.workspace.revision() === currentProblem.savedWorkspaceRevision;
    }
}

function applyWorkspaceRefresh(problem: ProblemData, workspace: {
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}): void {
    problem.workspace.refreshFromServer(
        assignmentStepFileMap(workspace.systemOwnedFiles),
        assignmentStepFileMap(workspace.studentOwnedFiles),
    );
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    problem.instructionsHtml = renderInstructionsMarkdown(problem.workspace);
}

function replaceProblemState(problem: ProblemData, workspace: {
    stepNumber: string;
    problemType: string;
    actions: string[];
    systemOwnedFiles: Record<string, Uint8Array>;
    studentOwnedFiles: Record<string, Uint8Array>;
    firstStepNumber: string;
    lastStepNumber: string;
}): void {
    problem.workspace.replaceFromServer(
        assignmentStepFileMap(workspace.systemOwnedFiles),
        assignmentStepFileMap(workspace.studentOwnedFiles),
    );
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    problem.instructionsHtml = renderInstructionsMarkdown(problem.workspace);
    problem.savedWorkspaceRevision = problem.workspace.revision();
}

function resetEditorContents(content: string, editable: boolean, filename: string): void {
    const effects = [];
    effects.push(editableCompartment.reconfigure(EditorView.editable.of(editable)));
    const lang = getLanguageExtension(filename);
    effects.push(language.reconfigure(lang ?? []));
    isProgrammaticEditorUpdate = true;
    editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: content },
        effects,
    });
    isProgrammaticEditorUpdate = false;
}

function editorTextFromFile(content: Uint8Array): string {
    const text = textDecoder.decode(content);
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function fileContentFromEditor(): Uint8Array {
    const text = editor.state.doc.toString();
    return textEncoder.encode(text === "" ? "" : `${text}\n`);
}

function reloadOpenFileFromState(): void {
    if (currentlyOpenFilePath === null || currentProblem === null) {
        return;
    }
    const content = currentProblem.workspace.readVisibleFile(currentlyOpenFilePath);
    if (content === undefined) {
        return;
    }
    const editable = currentProblem.workspace.isStudentOwned(currentlyOpenFilePath);
    if (isBinaryFile(content)) {
        resetEditorContents(
            "This file appears to be a binary file and cannot be displayed in the editor.",
            false,
            currentlyOpenFilePath,
        );
        return;
    }
    resetEditorContents(editorTextFromFile(content), editable, currentlyOpenFilePath);
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
            fileState: WorkspaceFileState.CURRENT,
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
    return buildProblemData(summary, workspace);
}

async function loadAssignment(): Promise<void> {
    const client = createMainClient();
    userId = await authenticate(client);

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

    currentProblem = window.problemSet[0];
    renderMenuBar();
    renderFileTree();
    renderInstructionsPane();
    updateInstructionsTabVisibility();
    resetVmForCurrentProblem();
    if (currentProblem.instructionsHtml !== "") {
        selectInstructionsTab();
    } else {
        selectTerminalTab();
    }
    loadFirstEditableFileIntoEditor();
}

function writeSaveStatus(status: CommitSaveStatus, context: "save" | "grade" | "action"): void {
    if (status === CommitSaveStatus.SAVED) {
        return;
    }
    selectTerminalTab();
    if (status === CommitSaveStatus.NOT_SAVED_LOCKED) {
        if (context === "save") {
            term.writeln("work was not saved because the assignment is locked");
            return;
        }
        term.writeln("results will not be saved because the assignment is locked");
        return;
    }
    if (context === "save") {
        term.writeln("work was not saved because you do not own this assignment");
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

async function handleDaycare(bundle: SignedRuntimeBundle, action: string): Promise<SignedRuntimeBundle> {
    selectTerminalTab();
    fitAddon.fit();

    const runtime = RuntimeBundle.fromBinary(bundle.bundle);
    const daycareClient = createDaycareClient(runtime.hostname);
    const stream = daycareClient.daycare(DaycareRequest.create({ bundle, args: [] }), {});

    for await (const response of stream.responses) {
        if (response.response.oneofKind === "error") {
            term.writeln(`server return an error: ${response.response.error}`);
            throw new Error(response.response.error);
        }
        if (response.response.oneofKind === "bundle") {
            return response.response.bundle;
        }
        if (response.response.oneofKind !== "event") {
            continue;
        }
        if (action === "grade") {
            continue;
        }
        const event = response.response.event;
        if (event.event === "files") {
            const problem = getCurrentProblemOrThrow();
            const studentOwnedPaths = problem.workspace.studentOwnedPaths();
            for (const [rawPath, content] of Object.entries(event.files)) {
                const path = normalizeRelativePath(rawPath);
                if (!studentOwnedPaths.has(path)) {
                    continue;
                }
                const syncError = problem.workspace.writeServerStudentFile(path, content);
                if (syncError !== undefined) {
                    vmController.reportFilesystemSyncError(syncError);
                }
                term.writeln(`downloading file ${path}`);
            }
            if (currentProblem === problem) {
                renderFileTree();
                reloadOpenFileFromState();
            }
            continue;
        }
        writeEvent(event);
    }

    throw new Error("Daycare stream ended without returning a bundle");
}

async function advanceProblem(problem: ProblemData): Promise<void> {
    term.writeln(`step ${problem.currentStepNumber.toString()} passed`);
    selectTerminalTab();
    if (problem.currentStepNumber >= problem.lastStepNumber) {
        problem.isComplete = true;
        term.writeln("you have completed all steps for this problem");
        resetVmForCurrentProblem();
        return;
    }
    const nextStepNumber = problem.currentStepNumber + 1n;
    const client = createMainClient();
    const currentAssignment = assignment;
    if (currentAssignment === null) {
        throw new Error("Assignment not loaded");
    }
    const workspace = await fetchWorkspace(client, currentAssignment, problem.problemId, nextStepNumber);
    replaceProblemState(problem, workspace);
    resetVmForCurrentProblem();
    term.writeln(`moving to step ${problem.currentStepNumber.toString()}`);
}

async function doAction(action: string): Promise<void> {
    const problem = getCurrentProblemOrThrow();
    const currentAssignment = assignment;
    if (currentAssignment === null) {
        throw new Error("Assignment not loaded");
    }
    const client = createMainClient();

    if (action !== "") {
        term.clear();
    }

    const refreshedWorkspace = await fetchWorkspace(client, currentAssignment, problem.problemId, problem.currentStepNumber);
    applyWorkspaceRefresh(problem, refreshedWorkspace);
    renderFileTree();
    renderInstructionsPane();
    updateInstructionsTabVisibility();
    reloadOpenFileFromState();

    if (action === "") {
        const submittedRevision = problem.workspace.revision();
        const commit = buildCommit(problem, "", "exam interface: save");
        const saved = await client.saveWorkspaceCommit(SaveWorkspaceCommitRequest.create({ commit }), authOptions());
        problem.savedWorkspaceRevision = submittedRevision;
        updateSaveButton();
        writeSaveStatus(saved.response.saveStatus, "save");
        return;
    }

    const label = actionLabel(action);
    if (label !== "") {
        term.writeln(label);
        selectTerminalTab();
    }

    const submittedRevision = problem.workspace.revision();
    const ungradedCommit = buildCommit(problem, action, `exam interface: ${action}`);
    const ungraded = await client.saveUngradedCommit(
        SaveUngradedCommitRequest.create({
            commit: GradingCommit.create({
                hostname: "",
                userId,
                commit: ungradedCommit,
            }),
        }),
        authOptions(),
    );
    if (ungraded.response.bundle === undefined) {
        throw new Error("SaveUngradedCommit did not return a signed runtime bundle");
    }
    problem.savedWorkspaceRevision = submittedRevision;
    updateSaveButton();
    writeSaveStatus(ungraded.response.saveStatus, action === "grade" ? "grade" : "action");

    const finalBundle = await handleDaycare(ungraded.response.bundle, action);
    const runtime = RuntimeBundle.fromBinary(finalBundle.bundle);

    if (action !== "grade") {
        return;
    }

    const graded = await client.saveGradedCommit(
        SaveGradedCommitRequest.create({ bundle: finalBundle }),
        authOptions(),
    );
    const gradedCommit = runtime.commit;
    if (gradedCommit === undefined) {
        throw new Error("Daycare returned a runtime bundle without a commit");
    }

    const passed = gradedCommit.reportCard?.passed === true && gradedCommit.score === 1.0;
    if (passed) {
        if (graded.response.saveStatus === CommitSaveStatus.SAVED) {
            await advanceProblem(problem);
            renderMenuBar();
            renderFileTree();
            renderInstructionsPane();
            updateInstructionsTabVisibility();
            loadFirstEditableFileIntoEditor();
        } else {
            term.writeln(`step ${problem.currentStepNumber.toString()} passed`);
        }
    } else {
        term.writeln(`solution for step ${problem.currentStepNumber.toString()} failed`);
        for (const event of gradedCommit.transcript) {
            writeEvent(event);
        }
    }
    writeSaveStatus(graded.response.saveStatus, "grade");
}

function cancelAutosaveTimer(): void {
    if (autosaveTimer === undefined) {
        return;
    }
    window.clearTimeout(autosaveTimer);
    autosaveTimer = undefined;
}

async function saveIfNeeded(): Promise<void> {
    cancelAutosaveTimer();
    if (saveInFlight !== undefined) {
        await saveInFlight;
    }
    cancelAutosaveTimer();
    if (currentProblem === null
        || currentProblem.workspace.revision() === currentProblem.savedWorkspaceRevision) {
        return;
    }
    const save = doAction("");
    saveInFlight = save;
    try {
        await save;
    } finally {
        if (saveInFlight === save) {
            saveInFlight = undefined;
        }
    }
}

function requestAutomaticSave(): void {
    void saveIfNeeded().catch((error: unknown): void => {
        console.error("Automatic save failed", error);
        selectTerminalTab();
        term.writeln(`Automatic save failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function scheduleAutosave(): void {
    if (autosaveTimer !== undefined) {
        return;
    }
    autosaveTimer = window.setTimeout((): void => {
        autosaveTimer = undefined;
        requestAutomaticSave();
    }, AUTOSAVE_DELAY_MS);
}

function saveOnPageExit(): void {
    cancelAutosaveTimer();
    const problem = currentProblem;
    if (problem === null
        || assignment === null
        || sessionKey === ""
        || problem.workspace.revision() === problem.savedWorkspaceRevision) {
        return;
    }

    const submittedRevision = problem.workspace.revision();
    const commit = buildCommit(problem, "", "exam interface: save");
    const call = createPageExitClient().saveWorkspaceCommit(
        SaveWorkspaceCommitRequest.create({ commit }),
        authOptions(),
    );
    void call.then(({ response }): void => {
        problem.savedWorkspaceRevision = submittedRevision;
        if (currentProblem === problem) {
            updateSaveButton();
        }
        if (response.saveStatus !== CommitSaveStatus.SAVED) {
            console.warn("Page-exit save was not persisted", CommitSaveStatus[response.saveStatus]);
        }
    }).catch((error: unknown): void => {
        console.warn("Page-exit save failed", error);
    });
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
        const fileTreeElement = document.querySelector<HTMLLIElement>(`.file-tree li[data-path="${CSS.escape(filePath)}"]`);
        if (fileTreeElement !== null) {
            fileTreeElement.click();
            return;
        }
    }
}

function renderMenuBar(): void {
    const menuItems = document.getElementById("menu-items");
    if (menuItems === null || currentProblem === null) {
        return;
    }
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
            problemButton.addEventListener("click", async (): Promise<void> => {
                vmController.resetToReady();
                await saveIfNeeded();
                currentProblem = problem;
                currentlyOpenFilePath = null;
                resetVmForCurrentProblem();
                if (term !== undefined) {
                    term.clear();
                }
                renderMenuBar();
                renderFileTree();
                renderInstructionsPane();
                updateInstructionsTabVisibility();
                if (currentProblem.instructionsHtml !== "") {
                    selectInstructionsTab();
                } else {
                    selectTerminalTab();
                }
                resetEditorContents("", false, "");
                loadFirstEditableFileIntoEditor();
            });
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
    saveButton.disabled = currentProblem.workspace.revision() === currentProblem.savedWorkspaceRevision;
    saveButton.addEventListener("click", async (): Promise<void> => {
        await saveIfNeeded();
    });
    menuItems.appendChild(saveButton);

    for (const action of currentProblem.actions) {
        const actionButton = document.createElement("button");
        actionButton.id = `action-${action}-button`;
        actionButton.textContent = actionLabel(action);
        actionButton.disabled = currentProblem.isComplete && action === "grade";
        actionButton.addEventListener("click", async (): Promise<void> => {
            await saveIfNeeded();
            await doAction(action);
        });
        menuItems.appendChild(actionButton);
    }
}

function buildFileTree(filePaths: readonly string[]): Record<string, FileTreeNode> {
    const tree: Record<string, FileTreeNode> = {};

    for (const rawPath of filePaths) {
        if (rawPath.startsWith("doc/")) {
            continue;
        }
        const path = normalizeRelativePath(rawPath);
        const parts = path.split("/");
        let currentLevel = tree;
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index];
            const isFile = index === parts.length - 1;
            const existing = currentLevel[part];
            if (existing === undefined) {
                currentLevel[part] = {
                    isFile,
                    fullPath: path,
                    children: {},
                };
            }
            currentLevel = currentLevel[part].children;
        }
    }

    return tree;
}

function nodeContainsEditable(node: FileTreeNode, editablePaths: ReadonlySet<string>): boolean {
    if (node.isFile) {
        return editablePaths.has(node.fullPath);
    }
    return Object.values(node.children).some((child) => nodeContainsEditable(child, editablePaths));
}

function renderTree(
    node: Record<string, FileTreeNode>,
    parentElement: HTMLElement,
    workspace: ProblemWorkspace,
    editablePaths: ReadonlySet<string>,
    selectedPath: string | null,
    depth: number = 0,
): void {
    const sortedKeys = Object.keys(node).sort((left, right) => {
        const leftNode = node[left];
        const rightNode = node[right];
        const leftEditable = nodeContainsEditable(leftNode, editablePaths);
        const rightEditable = nodeContainsEditable(rightNode, editablePaths);
        if (leftEditable && !rightEditable) {
            return -1;
        }
        if (!leftEditable && rightEditable) {
            return 1;
        }
        if (leftNode.isFile === rightNode.isFile) {
            return left.localeCompare(right);
        }
        return leftNode.isFile ? 1 : -1;
    });

    for (const key of sortedKeys) {
        const item = node[key];
        const li = document.createElement("li");
        li.classList.add(item.isFile ? "file" : "folder");

        const wrapper = document.createElement("div");
        wrapper.classList.add("item-content-wrapper");
        wrapper.style.setProperty("--tree-depth", String(depth));

        const icon = document.createElement("span");
        icon.classList.add("icon");
        wrapper.appendChild(icon);

        const text = document.createElement("span");
        text.textContent = key;
        wrapper.appendChild(text);

        li.appendChild(wrapper);

        if (item.isFile) {
            li.dataset.path = item.fullPath;
            if (item.fullPath === selectedPath) {
                li.classList.add("selected");
            }
            li.addEventListener("click", async (event: MouseEvent): Promise<void> => {
                event.stopPropagation();
                if (!getRequiredButton("save-button").disabled) {
                    await saveIfNeeded();
                }
                const previouslySelected = document.querySelector(".file-tree li.selected");
                if (previouslySelected instanceof HTMLElement) {
                    previouslySelected.classList.remove("selected");
                }
                li.classList.add("selected");
                currentlyOpenFilePath = item.fullPath;
                const fileContent = workspace.readVisibleFile(item.fullPath);
                if (fileContent === undefined) {
                    return;
                }
                const editable = editablePaths.has(item.fullPath);
                if (isBinaryFile(fileContent)) {
                    resetEditorContents(
                        "This file appears to be a binary file and cannot be displayed in the editor.",
                        false,
                        item.fullPath,
                    );
                    return;
                }
                resetEditorContents(editorTextFromFile(fileContent), editable, item.fullPath);
            });
        }

        parentElement.appendChild(li);

        if (Object.keys(item.children).length > 0) {
            const childList = document.createElement("ul");
            li.appendChild(childList);
            renderTree(item.children, childList, workspace, editablePaths, selectedPath, depth + 1);
        }
    }
}

function renderFileTree(): void {
    const fileTreePane = document.getElementById("file-tree-pane");
    if (fileTreePane === null || currentProblem === null) {
        return;
    }
    fileTreePane.innerHTML = "";
    const visiblePaths = currentProblem.workspace.visiblePaths();
    const editablePaths = currentProblem.workspace.studentOwnedPaths();
    const tree = buildFileTree(visiblePaths);
    const root = document.createElement("ul");
    root.classList.add("file-tree");
    renderTree(tree, root, currentProblem.workspace, editablePaths, currentlyOpenFilePath);
    fileTreePane.appendChild(root);
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
    if (!visible) {
        selectTerminalTab();
    }
}

function resetVmForCurrentProblem(): void {
    const vmTabButton = getRequiredButton("vm-tab-button");
    const problem = currentProblem;
    const image = problem === null ? undefined : vmImageForProblemType(problem.problemType);
    vmTabButton.hidden = image === undefined;
    if (problem === null || image === undefined) {
        vmController.setTarget(undefined);
        if (vmTabButton.classList.contains("active")) {
            if (problem !== null && problem.instructionsHtml !== "") {
                selectInstructionsTab();
            } else {
                selectTerminalTab();
            }
        }
        return;
    }
    vmController.setTarget({
        filesystem: problem.workspace.filesystem,
        image,
        rebuildFilesystem: (): void => problem.workspace.rebuildFilesystem(),
    });
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
            }
        });
    }
}

function initializeTerminal(): void {
    term = new Terminal({
        convertEol: true,
        scrollback: 500,
        theme: {
            background: "#1e1e1e",
            foreground: "#d4d4d4",
        },
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: "underline",
    });
    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const terminalElement = document.getElementById("terminal");
    if (terminalElement instanceof HTMLElement) {
        term.open(terminalElement);
        fitAddon.fit();
    }
    window.addEventListener("resize", (): void => fitAddon.fit());
}

document.addEventListener("DOMContentLoaded", (): void => {
    window.addEventListener("pagehide", saveOnPageExit);
    Split(["#file-tree-pane", "#editor-pane", "#info-pane"], {
        sizes: [10, 45, 45],
        gutterSize: 8,
        cursor: "grabbing",
        onDrag: (): void => {
            if (fitAddon !== undefined) {
                fitAddon.fit();
            }
            if (vmController !== undefined) {
                vmController.fit();
            }
        },
    });

    initializeTabs();
    initializeTerminal();
    const vmBootButton = getRequiredButton("vm-boot-button");
    vmBootButton.addEventListener("click", selectVmTab);
    vmController = new VmController(
        getRequiredElement("vm-terminal"),
        vmBootButton,
    );

    const state = EditorState.create({
        extensions: [
            basicSetup,
            keymap.of([{ key: "Tab", run: softTab }, ...defaultKeymap]),
            language.of([]),
            editableCompartment.of(EditorView.editable.of(true)),
            EditorView.domEventHandlers({
                blur: (): void => requestAutomaticSave(),
            }),
            EditorView.updateListener.of((update: ViewUpdate): void => {
                if (!update.docChanged || isProgrammaticEditorUpdate || currentProblem === null || currentlyOpenFilePath === null) {
                    return;
                }
                if (!update.transactions.some((transaction) => transaction.isUserEvent)) {
                    return;
                }
                const newContent = fileContentFromEditor();
                if (!currentProblem.workspace.isStudentOwned(currentlyOpenFilePath)) {
                    return;
                }
                const syncError = currentProblem.workspace.writeStudentFile(currentlyOpenFilePath, newContent);
                if (syncError !== undefined) {
                    vmController.reportFilesystemSyncError(syncError);
                }
                updateSaveButton();
                scheduleAutosave();
            }),
        ],
    });

    editor = new EditorView({
        state,
        parent: getRequiredElement("editor-pane"),
    });

    loadAssignment().catch((error: unknown) => {
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
