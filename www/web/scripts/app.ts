import type MarkdownIt from "markdown-it";
import type { AssignmentProblemProgress } from "../generated/codegrinder.js";
import { Tabs } from "./editorTabs.js";
import {
    extension,
    FileSystem,
    FileSystemUI,
} from "./directoryTree.js";
import { CodeGrinder, CodeGrinderUI, CommitSaveStatus } from "./codeGrinder.js";
import type { LoadedAssignment, WorkspaceFiles, WorkspaceProblem } from "./codeGrinder.js";
import {
    createEmbedHtml,
    legacyWebProblemType,
    parseSerializedDirectory,
    problemTypeFromFilePaths,
    standaloneProblemType,
} from './embed.js';
import { LocalRuntimeController, loadLocalRuntimeConfig, withTimeout } from "./localRuntime.js";
import { createChoicePrompt } from "./prompt.js";
import { waitForVersionedController } from "./serviceWorker.js";
import { versionedAssetUrl, webVersion } from "./version.js";
import { WorkspaceRevisionState } from "./workspaceRevision.js";

type Operation = () => void | Promise<void>;
type EditPolicy =
    | { readonly kind: "all" }
    | { readonly kind: "selected"; readonly paths: ReadonlySet<string> };
type RuntimeProblemState =
    | { readonly kind: "active"; readonly problemType: string }
    | { readonly kind: "inactive" };

interface InstructionEnvironment {
    imageFiles: Readonly<Record<string, Uint8Array>>;
    documentUrl: URL;
}

type ServerWorkspaceState =
    | { readonly kind: "assignment"; readonly assignment: LoadedAssignment; readonly problem: WorkspaceProblem }
    | { readonly kind: "empty" };

function requireElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (element === null) {
        throw new Error(`Required page element #${id} is missing`);
    }
    return element;
}

function requireButton(id: string): HTMLButtonElement {
    const element = requireElement(id);
    if (!(element instanceof HTMLButtonElement)) {
        throw new Error(`Required page element #${id} is not a button`);
    }
    return element;
}

function requireTextArea(parent: ParentNode, selector: string): HTMLTextAreaElement {
    const element = parent.querySelector(selector);
    if (!(element instanceof HTMLTextAreaElement)) {
        throw new Error(`Required page element ${selector} is not a textarea`);
    }
    return element;
}

function requireDescendant(parent: ParentNode, selector: string): HTMLElement {
    const element = parent.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Required page element ${selector} is missing`);
    }
    return element;
}

function requireClassElement(className: string): HTMLElement {
    const element = document.getElementsByClassName(className).item(0);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Required page element .${className} is missing`);
    }
    return element;
}

function isInstructionEnvironment(value: unknown): value is InstructionEnvironment {
    return typeof value === "object"
        && value !== null
        && "documentUrl" in value
        && value.documentUrl instanceof URL
        && "imageFiles" in value
        && typeof value.imageFiles === "object"
        && value.imageFiles !== null;
}

async function prepareRuntimeServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        console.warn("CodeGrinder: this browser does not support service workers");
        return;
    }
    const workerUrl = versionedAssetUrl(new URL(/* webpackIgnore: true */ "../sw.js", import.meta.url));
    console.info(`CodeGrinder: registering runtime service worker ${webVersion}`);
    await withTimeout(
        navigator.serviceWorker.register(workerUrl, { updateViaCache: "none" }),
        10000,
        "registering the runtime service worker",
    );
    console.info("CodeGrinder: waiting for the runtime service worker to control the page");
    await waitForVersionedController(navigator.serviceWorker, workerUrl);
    console.info("CodeGrinder: runtime service worker is ready");
}

await prepareRuntimeServiceWorker().catch((error: unknown) => {
    console.warn("CodeGrinder: runtime service worker is unavailable; continuing without it", error);
});

const output_terminal_label = requireElement("output_terminal");
const output_terminal = requireDescendant(output_terminal_label, "pre");
const terminalContainer = output_terminal_label.parentElement ?? output_terminal_label;
const input_terminal = requireTextArea(output_terminal_label, "textarea");
const filesButton = requireButton("files_button");
const filesList = requireElement("files_list");
const run = requireButton("run");
const newTab = requireButton("new_tab");
const saveCurrent = requireButton("save_current");
const saveAll = requireButton("save_all");
const embed = requireButton("embed");
const mdElement = requireElement("instructions");
const navBar = requireElement("nav_bar");
run.dataset.loadingStage = "runtime-config";
console.info("CodeGrinder: loading local runtime configuration");
let localRuntimeConfig;
try {
    localRuntimeConfig = await withTimeout(
        loadLocalRuntimeConfig(new URL(/* webpackIgnore: true */ "../local-runtimes.json", import.meta.url)),
        10000,
        "loading local runtime configuration",
    );
} catch (error) {
    console.error("CodeGrinder: local runtime configuration failed", error);
    run.classList.remove("loading-spinner");
    run.removeAttribute("aria-label");
    run.innerText = "Run unavailable";
    run.title = error instanceof Error ? error.message : String(error);
    throw error;
}
console.info(`CodeGrinder: loaded ${localRuntimeConfig.size} local runtime choices`);
const md = window.markdownit();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

function bytesToBase64(content: Uint8Array): string {
    const chunks: string[] = [];
    for (let offset = 0; offset < content.length; offset += 32768) {
        chunks.push(String.fromCharCode(...content.subarray(offset, offset + 32768)));
    }
    return btoa(chunks.join(""));
}

function imageMimeType(path: string): string | null {
    const extension = path.split(".").at(-1)?.toLowerCase();
    switch (extension) {
        case "gif": return "image/gif";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "png": return "image/png";
        case "svg": return "image/svg+xml";
        default: return null;
    }
}

function renderInstructions(files: Readonly<Record<string, Uint8Array>>): string {
    const markdown = files["doc/doc.md"];
    if (markdown === undefined) {
        return "";
    }
    const source = textDecoder.decode(markdown);
    const documentUrl = new URL("doc/doc.md", "https://workspace.invalid/");
    const environment: InstructionEnvironment = { imageFiles: files, documentUrl };
    return md.render(source, environment);
}

const defaultImageRenderer: MarkdownIt.Renderer.RenderRule = md.renderer.rules.image
    ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));
md.renderer.rules.image = (tokens, index, options, environment: unknown, renderer) => {
    if (!isInstructionEnvironment(environment)) {
        return defaultImageRenderer(tokens, index, options, environment, renderer);
    }
    const token = tokens[index];
    if (token === undefined) {
        return defaultImageRenderer(tokens, index, options, environment, renderer);
    }
    const sourceIndex = token.attrIndex("src");
    const sourceAttribute = sourceIndex >= 0 ? token.attrs?.[sourceIndex] : undefined;
    if (sourceAttribute !== undefined) {
        const source = sourceAttribute[1];
        const url = new URL(source, environment.documentUrl);
        if (url.origin === environment.documentUrl.origin) {
            const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
            const content = environment.imageFiles[path];
            const mimeType = imageMimeType(path);
            if (content === undefined) {
                throw new Error(`Instruction image not found: ${path}`);
            }
            if (mimeType === null) {
                throw new Error(`Instruction image has an unsupported type: ${path}`);
            }
            sourceAttribute[1] = `data:${mimeType};base64,${bytesToBase64(content)}`;
        }
    }
    return defaultImageRenderer(tokens, index, options, environment, renderer);
};
const fileSystem = new FileSystem();
const fileSystemUI = new FileSystemUI(fileSystem, requireElement("directory_tree"));
const workspaceRevision = new WorkspaceRevisionState();
const tabs = new Tabs(requireElement("tabs"), (path, content) => {
    fileSystem.writeFile(path, textEncoder.encode(content));
    workspaceRevision.markChanged();
    fileSystemUI.refreshUI();
});
let editPolicy: EditPolicy = { kind: "all" };
let runtimeProblem: RuntimeProblemState = { kind: "inactive" };
let activeInstructionsHtml = "";

const urlParams = new URLSearchParams(window.location.search);

// Set up files dropdown
filesButton.addEventListener("click", () => {
    filesList.style.display = "block";
});
// Click away from dropdowns to close
document.addEventListener("click", event => {
    if (event.target !== filesButton) {
        filesList.style.display = "none";
    }
})

// Set up tabs
fileSystemUI.fileClick = (content, path) => {
    filesList.style.display = "none";
    const relativePath = path.replace(/^\//, "");
    const editable = editPolicy.kind === "all" || editPolicy.paths.has(relativePath);
    let source: string;
    try {
        source = textDecoder.decode(content);
    } catch {
        tabs.addSwitchTab(path, "This file contains binary data and cannot be displayed", true);
        return;
    }
    tabs.addSwitchTab(path, source, !editable);
    if (extension(path) === "md") {
        mdElement.innerHTML = relativePath === "doc/doc.md" && activeInstructionsHtml !== ""
            ? activeInstructionsHtml
            : md.render(source);
    }
};
newTab.addEventListener("click", () => {
    tabs.addNewTab();
})
saveCurrent.addEventListener("click", () => {
    tabs.saveCurrentTab();
})
saveAll.addEventListener("click", () => {
    tabs.saveAllTabs();
})
embed.addEventListener("click", async () => {
    const files = fileSystem.files;
    const inferredProblemType = problemTypeFromFilePaths(Object.keys(files), localRuntimeConfig);
    const problemType = inferredProblemType ?? await createChoicePrompt(
        "Choose a problem type",
        [...localRuntimeConfig.keys()],
        runtimeProblem.kind === "active" ? runtimeProblem.problemType : legacyWebProblemType,
    );
    if (problemType === null) {
        console.info("CodeGrinder: embed problem type selection was cancelled");
        return;
    }
    console.info(
        inferredProblemType === null
            ? `CodeGrinder: embed problem type chosen as ${problemType}`
            : `CodeGrinder: inferred embed problem type ${problemType} from file extensions`,
    );
    await activateLocalRuntime(problemType, files);
    const html = createEmbedHtml(location, files, problemType);
    await navigator.clipboard.writeText(html);
    console.log(html);
})
const urlFiles = urlParams.get("files");
if (urlFiles) {
    fileSystem.load(parseSerializedDirectory(JSON.parse(urlFiles)));
    fileSystemUI.refreshUI();
    tabs.closeAll();
    for (const [path, content] of Object.entries(fileSystem.files)) {
        if (!path.includes("/")) {
            tabs.addSwitchTab(`/${path}`, textDecoder.decode(content));
        }
    }
}

// Set up terminal
let previousSpan = document.createElement("span");
function writeTerminal(str: string, color: string): void {
    if (previousSpan.style.color !== color) {
        const resetFocus = document.activeElement === input_terminal;
        previousSpan = document.createElement("span");
        previousSpan.style.color = color;
        output_terminal.appendChild(previousSpan);
        output_terminal.appendChild(input_terminal);
        if (resetFocus) {
            input_terminal.focus();
        }
    }
    setTimeout(() => {
        terminalContainer.scrollTop = terminalContainer.scrollHeight;
    }, 100);
    previousSpan.innerText += str;
}

// Set up local execution. Runtime modules are imported only after a supported
// problem type is selected.
const display = requireElement("turtle");
const localRuntime = new LocalRuntimeController(localRuntimeConfig, {
    displayImage: image => {
        const element = new Image();
        element.src = `data:image/png;base64,${image}`;
        display.replaceChildren(element);
    },
    loadingStatus: status => setLocalRuntimeLoading("runtime-worker", status),
    stderr: value => writeTerminal(value, "red"),
    stdout: value => writeTerminal(value, "black"),
});
window.addEventListener("pagehide", () => localRuntime.destroy(), { once: true });
let localRuntimeAvailable = false;
let localRuntimeOperation = 0;
let localRuntimeRunning = false;
input_terminal.disabled = true;

function setLocalRuntimeReady(): void {
    localRuntimeAvailable = true;
    input_terminal.disabled = false;
    run.classList.remove("loading-spinner");
    delete run.dataset.loadingStage;
    run.removeAttribute("aria-label");
    run.disabled = false;
    run.innerText = "Run";
    run.title = "";
}

function setLocalRuntimeLoading(stage: string, status: string): void {
    console.info(`CodeGrinder: ${status}`);
    run.classList.add("loading-spinner");
    run.dataset.loadingStage = stage;
    run.disabled = true;
    run.innerText = "";
    run.setAttribute("aria-label", status);
}

async function activateLocalRuntime(problemType: string, files: WorkspaceFiles): Promise<void> {
    const operation = ++localRuntimeOperation;
    runtimeProblem = { kind: "inactive" };
    if (localRuntimeRunning) {
        localRuntimeRunning = false;
        await localRuntime.stop();
    }
    localRuntimeAvailable = false;
    input_terminal.disabled = true;
    setLocalRuntimeLoading("runtime-module", `loading runtime for ${problemType}`);
    run.title = "";
    display.replaceChildren();
    try {
        if (!navigator.serviceWorker?.controller) {
            throw new Error("The local runtime service worker is unavailable; reload the page to try again");
        }
        const selection = await localRuntime.select(problemType, "replace");
        if (operation !== localRuntimeOperation) {
            return;
        }
        if (selection.kind === "unavailable") {
            tabs.setDefaultMode("ace/mode/text");
            run.innerText = "Run unavailable";
            run.title = `No local runtime is configured for ${problemType}`;
            return;
        }
        const runtimeName = selection.runtimeName;
        tabs.setDefaultMode(runtimeName === "python" ? "ace/mode/python" : "ace/mode/javascript");
        setLocalRuntimeLoading("dependencies", `configuring dependencies for ${problemType}`);
        await withTimeout(
            localRuntime.configure(files),
            120000,
            `configuring dependencies for ${problemType}`,
        );
        if (operation !== localRuntimeOperation) {
            return;
        }
        runtimeProblem = { kind: "active", problemType };
        setLocalRuntimeReady();
        writeTerminal(">> ", "orange");
    } catch (error) {
        if (operation === localRuntimeOperation) {
            localRuntime.destroy();
            run.classList.remove("loading-spinner");
            delete run.dataset.loadingStage;
            run.removeAttribute("aria-label");
            run.innerText = "Run unavailable";
            run.title = `The local runtime for ${problemType} could not start`;
        }
        throw error;
    }
}

async function executeLocally(operation: Operation): Promise<void> {
    if (!localRuntimeAvailable || localRuntimeRunning) {
        return;
    }
    const operationNumber = ++localRuntimeOperation;
    localRuntimeRunning = true;
    run.disabled = false;
    run.innerText = "Stop";
    try {
        await operation();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeTerminal(`${message}\n`, "red");
    } finally {
        if (operationNumber === localRuntimeOperation) {
            localRuntimeRunning = false;
            setLocalRuntimeReady();
            setTimeout(() => writeTerminal(">> ", "orange"), 1000);
        }
    }
}

async function stopLocalRuntime(): Promise<void> {
    if (!localRuntimeRunning) {
        return;
    }
    const operation = ++localRuntimeOperation;
    localRuntimeRunning = false;
    localRuntimeAvailable = false;
    input_terminal.disabled = true;
    setLocalRuntimeLoading("runtime-worker", "restarting local runtime");
    try {
        await withTimeout(localRuntime.stop(), 90000, "restarting the local runtime");
    } catch (error) {
        localRuntime.destroy();
        run.classList.remove("loading-spinner");
        delete run.dataset.loadingStage;
        run.removeAttribute("aria-label");
        run.innerText = "Run unavailable";
        const message = error instanceof Error ? error.message : String(error);
        run.title = message;
        writeTerminal(`${message}\n`, "red");
        console.error("CodeGrinder: local runtime restart failed", error);
        return;
    }
    if (operation === localRuntimeOperation) {
        setLocalRuntimeReady();
        writeTerminal(">> ", "orange");
    }
}

run.disabled = true;
input_terminal.addEventListener("keydown", async event => {
    input_terminal.style.color = localRuntimeRunning ? "grey" : "blue";
    if (event.key !== "Enter") {
        return;
    }
    const value = `${input_terminal.value.replace(/\n+$/, "")}\n`;
    input_terminal.value = "";
    input_terminal.focus();
    event.preventDefault();
    if (localRuntimeRunning) {
        writeTerminal(value, "grey");
        await localRuntime.writeStdin(value);
        return;
    }
    if (!localRuntimeAvailable) {
        return;
    }
    writeTerminal(value, "blue");
    const currentPath = tabs.selectedTab.kind === "selected" ? tabs.selectedTab.tab.path : "";
    await executeLocally(() => localRuntime.runLine(fileSystem.files, value, currentPath));
})

run.addEventListener("click", async () => {
    if (localRuntimeRunning) {
        await stopLocalRuntime();
        return;
    }
    const selection = tabs.selectedTab;
    if (selection.kind === "empty") {
        return;
    }
    const currentTab = selection.tab;
    writeTerminal(`Running ${currentTab.path}\n`, "orange");
    await executeLocally(() => localRuntime.runFile(fileSystem.files, currentTab.path));
})

function setupCodegrinder(): void {
    const sessionStorageKey = "codegrinderSessionKey";

    function readSessionKey(): string {
        try {
            return window.localStorage.getItem(sessionStorageKey) ?? "";
        } catch (error) {
            console.warn("CodeGrinder: persistent session storage is unavailable", error);
            return "";
        }
    }

    function storeSessionKey(sessionKey: string): void {
        try {
            if (sessionKey === "") {
                window.localStorage.removeItem(sessionStorageKey);
            } else {
                window.localStorage.setItem(sessionStorageKey, sessionKey);
            }
        } catch (error) {
            console.warn("CodeGrinder: could not update persistent session storage", error);
        }
    }

    const savedSessionKey = readSessionKey();
    const codeGrinder = new CodeGrinder(savedSessionKey, window.location.origin);
    let serverWorkspace: ServerWorkspaceState = { kind: "empty" };
    let syncPromise: Promise<void> = Promise.resolve();
    let syncRunning = false;
    let serverOperationRunning = false;

    function reportError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        writeTerminal(`Error: ${message}\n`, "red");
        console.error(error);
    }

    function currentProblemSupportsTest(): boolean {
        return serverWorkspace.kind === "assignment"
            && serverWorkspace.problem.workspace.actions.includes("test");
    }

    const codeGrinderUI = new CodeGrinderUI(
        navBar,
        codeGrinder,
        storeSessionKey,
        assignment => switchAssignment(assignment),
        reportError,
    );

    async function showProblem(assignment: LoadedAssignment, problem: WorkspaceProblem): Promise<void> {
        serverWorkspace = { assignment, kind: "assignment", problem };
        const workspace = problem.workspace;
        editPolicy = { kind: "selected", paths: new Set(Object.keys(workspace.studentOwnedFiles)) };
        const files: WorkspaceFiles = {
            ...workspace.systemOwnedFiles,
            ...workspace.studentOwnedFiles,
        };
        fileSystem.load(files);
        tabs.closeAll();
        for (const [path, content] of Object.entries(workspace.studentOwnedFiles)) {
            try {
                tabs.addSwitchTab(`/${path}`, textDecoder.decode(content), false);
            } catch {
                continue;
            }
        }
        activeInstructionsHtml = renderInstructions(files);
        mdElement.innerHTML = activeInstructionsHtml;
        fileSystemUI.refreshUI();
        codeGrinderUI.buttonGrade.innerText = problem.progress.completed ? "Finished" : "Grade";
        codeGrinderUI.buttonGrade.disabled = problem.progress.completed;
        codeGrinderUI.setActions([...workspace.actions].sort((left, right) => left.localeCompare(right)));
        workspaceRevision.markLoaded();
        await activateLocalRuntime(workspace.problemType, files);
    }

    async function loadAssignment(
        assignment: LoadedAssignment,
        preferredProblemId: string | null = null,
    ): Promise<void> {
        tabs.autoSave = true;
        tabs.setPathChangesAllowed(false);
        newTab.hidden = true;
        embed.hidden = true;
        codeGrinderUI.problemsList.innerText = "";
        const problems = [...assignment.response.problems]
            .sort((left, right) => left.problemId.localeCompare(right.problemId));
        for (const problem of problems) {
            const li = document.createElement("li");
            const button = document.createElement("button");
            li.appendChild(button);
            codeGrinderUI.problemsList.appendChild(li);
            button.innerText = `${problem.completed ? "✓ " : ""}${problem.problemId}`;
            button.addEventListener("click", () => {
                void switchProblem(assignment, problem).catch(reportError);
            });
        }
        const preferred = problems.find(problem => problem.problemId === preferredProblemId && !problem.completed);
        const progress = preferred ?? problems.find(problem => !problem.completed) ?? problems[0];
        await showProblem(assignment, await codeGrinder.loadProblem(assignment, progress));
    }

    function queueSync(showStatus: boolean): Promise<void> {
        if (serverWorkspace.kind === "empty") {
            return Promise.resolve();
        }
        const { assignment, problem } = serverWorkspace;
        tabs.saveAllTabs();
        const files = fileSystem.files;
        const revision = workspaceRevision.capture();
        syncPromise = syncPromise
            .catch(() => {})
            .then(async () => {
                syncRunning = true;
                tabs.setInteractionDisabled(true);
                try {
                    const result = await codeGrinder.sync(problem, files);
                    if (result.message !== "") {
                        writeTerminal(`${result.message}\n`, "red");
                    }
                    if (result.saveStatus !== CommitSaveStatus.SAVED) {
                        return;
                    }
                    if (serverWorkspace.kind === "assignment" && serverWorkspace.problem === problem) {
                        workspaceRevision.markSaved(revision);
                    }
                    if (showStatus) {
                        if (serverWorkspace.kind === "assignment" && serverWorkspace.problem === problem) {
                            await showProblem(assignment, problem);
                        }
                        writeTerminal(
                            `Problem ${problem.workspace.problemId} step ${problem.workspace.stepNumber} synced\n`,
                            "green",
                        );
                    }
                } finally {
                    syncRunning = false;
                    tabs.setInteractionDisabled(serverOperationRunning);
                }
            });
        return syncPromise;
    }

    async function saveBeforeTransition(): Promise<void> {
        tabs.saveAllTabs();
        if (serverWorkspace.kind === "empty" || !workspaceRevision.dirty) {
            return;
        }
        await queueSync(false);
        if (workspaceRevision.dirty) {
            throw new Error("Current work could not be saved; staying in this workspace");
        }
    }

    async function runServerOperation(
        operation: () => Promise<void>,
        saveCurrentWorkspace = false,
    ): Promise<void> {
        if (serverOperationRunning) {
            return;
        }
        serverOperationRunning = true;
        tabs.setInteractionDisabled(true);
        try {
            await syncPromise.catch(() => {});
            if (saveCurrentWorkspace) {
                await saveBeforeTransition();
            }
            await operation();
        } finally {
            serverOperationRunning = false;
            tabs.setInteractionDisabled(syncRunning);
        }
    }

    async function switchProblem(
        assignment: LoadedAssignment,
        progress: AssignmentProblemProgress,
    ): Promise<void> {
        await runServerOperation(async () => {
            await showProblem(assignment, await codeGrinder.loadProblem(assignment, progress));
        }, true);
    }

    async function switchAssignment(assignment: LoadedAssignment): Promise<void> {
        await runServerOperation(() => loadAssignment(assignment), true);
    }

    codeGrinderUI.buttonSync.addEventListener("click", () => {
        void queueSync(true).catch(reportError);
    });
    codeGrinderUI.buttonReset.addEventListener("click", async () => {
        if (serverWorkspace.kind === "empty"
            || !window.confirm("Restore all student files to the beginning of this step?")) {
            return;
        }
        const { assignment, problem } = serverWorkspace;
        await runServerOperation(async () => {
            try {
                await codeGrinder.reset(problem);
                await showProblem(assignment, problem);
            } catch (error) {
                reportError(error);
            }
        });
    });
    codeGrinderUI.buttonGrade.addEventListener("click", async () => {
        if (serverWorkspace.kind === "empty") {
            return;
        }
        codeGrinderUI.buttonGrade.disabled = true;
        tabs.saveAllTabs();
        const { assignment, problem } = serverWorkspace;
        const problemId = problem.workspace.problemId;
        const files = fileSystem.files;
        await runServerOperation(async () => {
            try {
                const result = await codeGrinder.grade(
                    problem,
                    files,
                    output => writeTerminal(output, "green"),
                    output => writeTerminal(output, "darkgreen"),
                );
                const note = result.commit.reportCard?.note;
                if (note) {
                    writeTerminal(`${note}\n`, result.passed ? "green" : "red");
                }
                if (result.passed) {
                    writeTerminal(
                        result.completed
                            ? `Completed ${problemId}\n`
                            : `Moving to step ${result.problem.workspace.stepNumber}\n`,
                        "green",
                    );
                }
                if (result.message !== "") {
                    writeTerminal(`${result.message}\n`, "red");
                }
                if (assignment.lockedForLms) {
                    writeTerminal("Grade was not posted to the LMS because the assignment is locked\n", "red");
                }
                const refreshedAssignment = await codeGrinder.loadAssignment(assignment.response.assignment);
                await loadAssignment(refreshedAssignment, problemId);
            } catch (error) {
                reportError(error);
            } finally {
                codeGrinderUI.buttonGrade.disabled = serverWorkspace.kind === "empty"
                    || serverWorkspace.problem.progress.completed;
            }
        });
    });
    async function runAction(action: string): Promise<void> {
        if (serverWorkspace.kind === "empty") {
            return;
        }
        const { assignment, problem } = serverWorkspace;
        tabs.saveAllTabs();
        const files = fileSystem.files;
        await runServerOperation(async () => {
            const result = await codeGrinder.action(
                problem,
                files,
                action,
                output => writeTerminal(output, "purple"),
                output => writeTerminal(output, "darkpurple"),
            );
            if (result.message !== "") {
                writeTerminal(`${result.message}\n`, "red");
            }
            await showProblem(assignment, problem);
        });
    }

    codeGrinderUI.actionHandler = runAction;
    codeGrinderUI.testHandler = async () => {
        if (serverWorkspace.kind === "empty") {
            return;
        }
        codeGrinderUI.buttonTest.disabled = true;
        try {
            tabs.saveAllTabs();
            if (localRuntime.supportsLocalTests) {
                await stopLocalRuntime();
                if (!localRuntimeAvailable) {
                    return;
                }
                writeTerminal("Running tests\n", "orange");
                await executeLocally(() => localRuntime.runTests(fileSystem.files));
                return;
            }
            await runAction("test");
        } finally {
            codeGrinderUI.buttonTest.disabled = !codeGrinder.authenticated
                || !currentProblemSupportsTest();
        }
    };

    async function initialize(): Promise<void> {
        const loginToken = urlParams.get("token") ?? "";
        const assignmentKey = urlParams.get("assignment");
        if (assignmentKey) {
            setLocalRuntimeLoading("server", "loading assignment session");
        }
        try {
            if (loginToken !== "") {
                console.info("CodeGrinder: exchanging login token for a session");
                await withTimeout(codeGrinder.login(loginToken), 30000, "logging in to CodeGrinder");
                storeSessionKey(codeGrinder.sessionKey);
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete("token");
                window.history.replaceState(null, "", cleanUrl);
            } else if (savedSessionKey !== "") {
                console.info("CodeGrinder: restoring the saved session");
                await withTimeout(codeGrinder.restoreSession(), 30000, "restoring the CodeGrinder session");
            }
            codeGrinderUI.updateAuthenticationStatus();
            if (assignmentKey && !codeGrinder.authenticated) {
                throw new Error("Log in again from the course site to load this assignment");
            }
            if (assignmentKey && codeGrinder.authenticated) {
                console.info(`CodeGrinder: loading assignment ${assignmentKey}`);
                const assignment = await withTimeout(
                    codeGrinder.loadAssignment(assignmentKey),
                    30000,
                    "loading the assignment",
                );
                await loadAssignment(assignment);
                saveCurrent.hidden = true;
                saveAll.hidden = true;
                codeGrinderUI.buttonAssignments.hidden = true;
                codeGrinderUI.buttonSync.hidden = true;
                codeGrinderUI.buttonAuthenticator.hidden = true;
            }
        } catch (error) {
            storeSessionKey("");
            codeGrinder.logout();
            codeGrinderUI.updateAuthenticationStatus();
            reportError(error);
            if (assignmentKey) {
                run.classList.remove("loading-spinner");
                delete run.dataset.loadingStage;
                run.removeAttribute("aria-label");
                run.innerText = "Run unavailable";
                run.title = error instanceof Error ? error.message : String(error);
            }
        }
    }

    initialize();

    setInterval(() => {
        if (serverWorkspace.kind === "empty"
            || syncRunning
            || serverOperationRunning
            || !workspaceRevision.dirty) {
            return;
        }
        void queueSync(false).catch(reportError);
    }, 5000);
}
const urlDummy = urlParams.get("dummy");
if (urlDummy) {
    newTab.style.display = "none";
    saveCurrent.style.display = "none";
    saveAll.style.display = "none";
    filesButton.style.display = "none";
    embed.style.display = "none";
    requireElement("instructions_container").style.display = "none";
    requireClassElement("path-input").style.display = "none";
    run.style.position = "absolute";
    run.style.right = "0";
    run.style.top = "0";
    run.style.zIndex = "1";
    run.style.borderRadius = "100%";
    run.style.backgroundColor = "green";
    run.style.margin = "20px";
    tabs.autoSave = true;
    try {
        const problemType = standaloneProblemType(urlParams, localRuntimeConfig);
        if (Object.keys(fileSystem.files).length === 0) {
            requireClassElement("tabs-container").style.display = "none";
            const mainPath = localRuntimeConfig.get(problemType) === "python" ? "/main.py" : "/main.js";
            tabs.addSwitchTab(mainPath, "");
        }
        await activateLocalRuntime(problemType, fileSystem.files);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        run.disabled = true;
        run.innerText = "Run unavailable";
        writeTerminal(`${message}\n`, "red");
    }
} else {
    setupCodegrinder();
    if (!urlParams.has("assignment")) {
        try {
            const problemType = standaloneProblemType(urlParams, localRuntimeConfig);
            await activateLocalRuntime(problemType, fileSystem.files);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            run.disabled = true;
            run.innerText = "Run unavailable";
            writeTerminal(`${message}\n`, "red");
        }
    }
}
