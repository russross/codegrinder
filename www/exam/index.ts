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

interface ProblemData {
    problemId: string;
    note: string;
    currentStepNumber: bigint;
    firstStepNumber: bigint;
    lastStepNumber: bigint;
    problemType: string;
    actions: string[];
    systemFiles: Map<string, Uint8Array>;
    studentFiles: Map<string, Uint8Array>;
    mergedFiles: Map<string, Uint8Array>;
    mergedFileList: string[];
    editablePaths: Set<string>;
    instructionsHtml: string;
    isComplete: boolean;
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
let currentlyOpenFilePath: string | null = null;
let hasUserMadeChanges = false;
let isProgrammaticEditorUpdate = false;

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

function createDaycareClient(hostname: string): CodeGrinderServiceClient {
    return new CodeGrinderServiceClient(
        new GrpcWebFetchTransport({
            baseUrl: `${window.location.protocol}//${hostname}`,
            fetchInit: { credentials: "omit" },
        }),
    );
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
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

function getSessionKeyFromUrl(): string {
    const raw = new URLSearchParams(window.location.search).get("session");
    return raw === null ? "" : raw;
}

function setCookieFromHello(cookie: string): void {
    if (cookie === "") {
        return;
    }
    document.cookie = `${cookie}; path=/`;
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

function mergedWorkspaceFiles(
    systemFiles: Map<string, Uint8Array>,
    studentFiles: Map<string, Uint8Array>,
): Map<string, Uint8Array> {
    const merged = new Map<string, Uint8Array>();
    for (const [path, content] of systemFiles) {
        merged.set(path, content);
    }
    for (const [path, content] of studentFiles) {
        merged.set(path, content);
    }
    return merged;
}

function renderInstructionsMarkdown(file: Uint8Array | undefined): string {
    if (file === undefined) {
        return "";
    }
    const source = textDecoder.decode(file);
    return markdownRenderer.render(markdownParser.parse(source));
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
    const mergedFiles = mergedWorkspaceFiles(systemFiles, studentFiles);
    return {
        problemId: summary.problemId,
        note: summary.problemNote,
        currentStepNumber: BigInt(workspace.stepNumber),
        firstStepNumber: BigInt(workspace.firstStepNumber),
        lastStepNumber: BigInt(workspace.lastStepNumber),
        problemType: workspace.problemType,
        actions: [...workspace.actions].sort((left, right) => left.localeCompare(right)),
        systemFiles,
        studentFiles,
        mergedFiles,
        mergedFileList: [...mergedFiles.keys()],
        editablePaths: new Set(studentFiles.keys()),
        instructionsHtml: renderInstructionsMarkdown(mergedFiles.get(DOC_PATH)),
        isComplete: false,
    };
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

function updateProblemFiles(problem: ProblemData): void {
    problem.mergedFiles = mergedWorkspaceFiles(problem.systemFiles, problem.studentFiles);
    problem.mergedFileList = [...problem.mergedFiles.keys()];
    problem.instructionsHtml = renderInstructionsMarkdown(problem.mergedFiles.get(DOC_PATH));
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
    const previousStudentFiles = new Map(problem.studentFiles);
    problem.systemFiles = assignmentStepFileMap(workspace.systemOwnedFiles);
    problem.studentFiles = assignmentStepFileMap(workspace.studentOwnedFiles);
    for (const path of problem.studentFiles.keys()) {
        const local = previousStudentFiles.get(path);
        if (local !== undefined) {
            problem.studentFiles.set(path, local);
        }
    }
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    problem.editablePaths = new Set(problem.studentFiles.keys());
    updateProblemFiles(problem);
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
    problem.systemFiles = assignmentStepFileMap(workspace.systemOwnedFiles);
    problem.studentFiles = assignmentStepFileMap(workspace.studentOwnedFiles);
    problem.currentStepNumber = BigInt(workspace.stepNumber);
    problem.firstStepNumber = BigInt(workspace.firstStepNumber);
    problem.lastStepNumber = BigInt(workspace.lastStepNumber);
    problem.problemType = workspace.problemType;
    problem.actions = [...workspace.actions].sort((left, right) => left.localeCompare(right));
    problem.editablePaths = new Set(problem.studentFiles.keys());
    updateProblemFiles(problem);
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

function reloadOpenFileFromState(): void {
    if (currentlyOpenFilePath === null || currentProblem === null) {
        return;
    }
    const content = currentProblem.mergedFiles.get(currentlyOpenFilePath);
    if (content === undefined) {
        return;
    }
    const editable = currentProblem.editablePaths.has(currentlyOpenFilePath);
    if (isBinaryFile(content)) {
        resetEditorContents(
            "This file appears to be a binary file and cannot be displayed in the editor.",
            false,
            currentlyOpenFilePath,
        );
        return;
    }
    resetEditorContents(textDecoder.decode(content), editable, currentlyOpenFilePath);
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
        files: Object.fromEntries(problem.studentFiles),
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
        {},
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
    const sessionKey = getSessionKeyFromUrl();
    const helloCall = await client.hello(HelloRequest.create({ key: sessionKey }), {});
    setCookieFromHello(helloCall.response.cookie);
    if (helloCall.response.userId === "") {
        throw new Error("User not returned from hello");
    }
    userId = helloCall.response.userId;

    assignment = parseAssignmentKeyFromUrl();
    const assignmentCall = await client.getAssignment(GetAssignmentRequest.create({ assignment }), {});
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
            for (const [path, content] of Object.entries(event.files)) {
                if (!problem.editablePaths.has(path)) {
                    continue;
                }
                problem.studentFiles.set(path, content);
                problem.mergedFiles.set(path, content);
                term.writeln(`downloading file ${path}`);
            }
            problem.mergedFileList = [...problem.mergedFiles.keys()];
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
        const commit = buildCommit(problem, "", "exam interface: save");
        const saved = await client.saveWorkspaceCommit(SaveWorkspaceCommitRequest.create({ commit }), {});
        hasUserMadeChanges = false;
        getRequiredElement<HTMLButtonElement>("save-button").disabled = true;
        writeSaveStatus(saved.response.saveStatus, "save");
        return;
    }

    const label = actionLabel(action);
    if (label !== "") {
        term.writeln(label);
        selectTerminalTab();
    }

    const ungradedCommit = buildCommit(problem, action, `exam interface: ${action}`);
    const ungraded = await client.saveUngradedCommit(
        SaveUngradedCommitRequest.create({
            commit: GradingCommit.create({
                hostname: "",
                userId,
                commit: ungradedCommit,
            }),
        }),
        {},
    );
    if (ungraded.response.bundle === undefined) {
        throw new Error("SaveUngradedCommit did not return a signed runtime bundle");
    }
    getRequiredElement<HTMLButtonElement>("save-button").disabled = true;
    hasUserMadeChanges = false;
    writeSaveStatus(ungraded.response.saveStatus, action === "grade" ? "grade" : "action");

    const finalBundle = await handleDaycare(ungraded.response.bundle, action);
    const runtime = RuntimeBundle.fromBinary(finalBundle.bundle);

    if (action !== "grade") {
        return;
    }

    const graded = await client.saveGradedCommit(
        SaveGradedCommitRequest.create({ bundle: finalBundle }),
        {},
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

async function saveIfNeeded(): Promise<void> {
    if (!hasUserMadeChanges) {
        return;
    }
    await doAction("");
}

function loadFirstEditableFileIntoEditor(): void {
    if (currentProblem === null) {
        return;
    }
    for (const filePath of currentProblem.mergedFileList) {
        if (!currentProblem.editablePaths.has(filePath)) {
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
    const menuBar = document.getElementById("menu-bar");
    if (menuBar === null || currentProblem === null) {
        return;
    }
    menuBar.innerHTML = "";

    const problemLabel = document.createElement("span");
    problemLabel.textContent = window.problemSet.length > 1 ? "Problems:" : "Problem:";
    problemLabel.classList.add("menu-label");
    menuBar.appendChild(problemLabel);

    for (const problem of window.problemSet) {
        const problemButton = document.createElement("button");
        problemButton.textContent = problem.note;
        problemButton.classList.add("problem-button");
        if (problem.problemId === currentProblem.problemId) {
            problemButton.disabled = true;
            problemButton.classList.add("active-problem");
        } else {
            problemButton.addEventListener("click", async (): Promise<void> => {
                await saveIfNeeded();
                currentProblem = problem;
                currentlyOpenFilePath = null;
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
        menuBar.appendChild(problemButton);
    }

    const actionsLabel = document.createElement("span");
    actionsLabel.textContent = "Actions:";
    actionsLabel.classList.add("menu-label", "actions-label");
    menuBar.appendChild(actionsLabel);

    const saveButton = document.createElement("button");
    saveButton.id = "save-button";
    saveButton.textContent = "Save";
    saveButton.disabled = !hasUserMadeChanges;
    saveButton.addEventListener("click", async (): Promise<void> => {
        await saveIfNeeded();
    });
    menuBar.appendChild(saveButton);

    for (const action of currentProblem.actions) {
        const actionButton = document.createElement("button");
        actionButton.id = `action-${action}-button`;
        actionButton.textContent = actionLabel(action);
        actionButton.addEventListener("click", async (): Promise<void> => {
            await saveIfNeeded();
            await doAction(action);
        });
        menuBar.appendChild(actionButton);
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

function nodeContainsEditable(node: FileTreeNode, editablePaths: Set<string>): boolean {
    if (node.isFile) {
        return editablePaths.has(node.fullPath);
    }
    return Object.values(node.children).some((child) => nodeContainsEditable(child, editablePaths));
}

function renderTree(
    node: Record<string, FileTreeNode>,
    parentElement: HTMLElement,
    mergedFiles: Map<string, Uint8Array>,
    editablePaths: Set<string>,
    selectedPath: string | null,
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
                if (!(getRequiredElement<HTMLButtonElement>("save-button").disabled)) {
                    await saveIfNeeded();
                }
                const previouslySelected = document.querySelector(".file-tree li.selected");
                if (previouslySelected instanceof HTMLElement) {
                    previouslySelected.classList.remove("selected");
                }
                li.classList.add("selected");
                currentlyOpenFilePath = item.fullPath;
                const fileContent = mergedFiles.get(item.fullPath);
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
                resetEditorContents(textDecoder.decode(fileContent), editable, item.fullPath);
            });
        }

        parentElement.appendChild(li);

        if (Object.keys(item.children).length > 0) {
            const childList = document.createElement("ul");
            li.appendChild(childList);
            renderTree(item.children, childList, mergedFiles, editablePaths, selectedPath);
        }
    }
}

function renderFileTree(): void {
    const fileTreePane = document.getElementById("file-tree-pane");
    if (fileTreePane === null || currentProblem === null) {
        return;
    }
    fileTreePane.innerHTML = "";
    const tree = buildFileTree(currentProblem.mergedFileList);
    const root = document.createElement("ul");
    root.classList.add("file-tree");
    renderTree(tree, root, currentProblem.mergedFiles, currentProblem.editablePaths, currentlyOpenFilePath);
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
    Split(["#file-tree-pane", "#editor-pane", "#info-pane"], {
        sizes: [10, 45, 45],
        gutterSize: 8,
        cursor: "col-resize",
        onDrag: (): void => {
            if (fitAddon !== undefined) {
                fitAddon.fit();
            }
        },
    });

    initializeTabs();
    initializeTerminal();

    const state = EditorState.create({
        extensions: [
            basicSetup,
            keymap.of([{ key: "Tab", run: softTab }, ...defaultKeymap]),
            language.of([]),
            editableCompartment.of(EditorView.editable.of(true)),
            EditorView.updateListener.of((update: ViewUpdate): void => {
                if (!update.docChanged || isProgrammaticEditorUpdate || currentProblem === null || currentlyOpenFilePath === null) {
                    return;
                }
                if (!update.transactions.some((transaction) => transaction.isUserEvent)) {
                    return;
                }
                const newContent = textEncoder.encode(editor.state.doc.toString());
                currentProblem.mergedFiles.set(currentlyOpenFilePath, newContent);
                if (currentProblem.editablePaths.has(currentlyOpenFilePath)) {
                    currentProblem.studentFiles.set(currentlyOpenFilePath, newContent);
                }
                hasUserMadeChanges = true;
                const saveButton = document.getElementById("save-button");
                if (saveButton instanceof HTMLButtonElement) {
                    saveButton.disabled = false;
                }
            }),
        ],
    });

    editor = new EditorView({
        state,
        parent: getRequiredElement("editor-pane"),
    });

    loadAssignment().catch((error: unknown) => {
        console.error("Error loading exam client:", error);
        const menuBar = document.getElementById("menu-bar");
        if (menuBar instanceof HTMLElement) {
            menuBar.innerHTML = "<p style=\"color: red;\">Error loading data. Please try again later.</p>";
        }
    });
});
