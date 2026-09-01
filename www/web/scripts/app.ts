import { Tabs } from "./editorTabs.js";
import {
    extension,
    FileSystem,
    FileSystemUI,
    isDirectoryNode,
    parseDirectoryNode,
} from "./directoryTree.js";
import type { DirectoryNodeData } from "./directoryTree.js";
import { CodeGrinder, CodeGrinderUI, CommitSaveStatus } from "./codeGrinder.js";
import type { LoadedAssignment, TextFiles, WorkspaceProblem } from "./codeGrinder.js";
import {
    createEmbedHtml,
    legacyWebProblemType,
    problemTypeFromFilePaths,
    standaloneProblemType,
} from './embed.js';
import { LocalRuntimeController, loadLocalRuntimeConfig, withTimeout } from "./localRuntime.js";
import { createChoicePrompt } from "./prompt.js";
import { waitForVersionedController } from "./serviceWorker.js";
import { versionedAssetUrl, webVersion } from "./version.js";
import { WorkspaceRevisionState } from "./workspaceRevision.js";
import type MarkdownIt from "markdown-it";

type Operation = () => void | Promise<void>;

interface InstructionEnvironment {
    imageFiles: Readonly<Record<string, Uint8Array>>;
    documentUrl: URL;
}

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
    const source = new TextDecoder("utf-8", { fatal: true }).decode(markdown);
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
    const fout = fileSystem.touch(path);
    fout.content = content;
    workspaceRevision.markChanged();
    fileSystemUI.refreshUI();
});
let editablePaths: ReadonlySet<string> | null = null;
let activeLocalProblemType: string | null = null;
let activeInstructionsHtml = "";

const urlParams = new URLSearchParams(window.location.search);

function workspaceFiles(directory: DirectoryNodeData, path = "", files: TextFiles = {}): TextFiles {
    for (const [name, node] of Object.entries(directory.children)) {
        if (isDirectoryNode(node)) {
            workspaceFiles(node, `${path}${name}/`, files);
            continue;
        }
        files[`${path}${name}`] = node.content;
    }
    return files;
}

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
fileSystemUI.fileClick = (fileNode, path) => {
    filesList.style.display = "none";
    const relativePath = path.replace(/^\//, "");
    const readOnly = editablePaths !== null && !editablePaths.has(relativePath);
    tabs.addSwitchTab(path, fileNode.content, readOnly);
    if (extension(path) === "md") {
        mdElement.innerHTML = relativePath === "doc/doc.md" && activeInstructionsHtml !== ""
            ? activeInstructionsHtml
            : md.render(fileNode.content);
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
    const files = workspaceFiles(fileSystem.rootNode);
    const inferredProblemType = problemTypeFromFilePaths(Object.keys(files), localRuntimeConfig);
    const problemType = inferredProblemType ?? await createChoicePrompt(
        "Choose a problem type",
        [...localRuntimeConfig.keys()],
        activeLocalProblemType ?? legacyWebProblemType,
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
    const html = createEmbedHtml(location, fileSystem.rootNode, problemType);
    await navigator.clipboard.writeText(html);
    console.log(html);
})
const urlFiles = urlParams.get("files");
if (urlFiles) {
    fileSystem.rootNode = parseDirectoryNode(JSON.parse(urlFiles));
    fileSystemUI.refreshUI();
    tabs.closeAll();
    for (const [file, node] of Object.entries(fileSystem.rootNode.children)) {
        if (!isDirectoryNode(node)) {
            tabs.addSwitchTab(`/${file}`, node.content);
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

async function activateLocalRuntime(problemType: string, files: TextFiles): Promise<void> {
    const operation = ++localRuntimeOperation;
    activeLocalProblemType = null;
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
        const runtimeName = await localRuntime.select(problemType, "replace");
        if (operation !== localRuntimeOperation) {
            return;
        }
        if (runtimeName === null) {
            tabs.setDefaultMode("ace/mode/text");
            run.innerText = "Run unavailable";
            run.title = `No local runtime is configured for ${problemType}`;
            return;
        }
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
        activeLocalProblemType = problemType;
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
    const currentPath = tabs.tabs[tabs.currentTab]?.path ?? "";
    await executeLocally(() => localRuntime.runLine(fileSystem, value, currentPath));
})

run.addEventListener("click", async () => {
    if (localRuntimeRunning) {
        await stopLocalRuntime();
        return;
    }
    const currentTab = tabs.tabs[tabs.currentTab];
    if (!currentTab) {
        return;
    }
    writeTerminal(`Running ${currentTab.path}\n`, "orange");
    await executeLocally(() => localRuntime.runFile(fileSystem, currentTab.path));
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
    const codeGrinder = new CodeGrinder(savedSessionKey, window.location.origin, renderInstructions);
    let currentAssignment: LoadedAssignment | null = null;
    let currentProblem: WorkspaceProblem | null = null;
    let syncPromise: Promise<void> = Promise.resolve();
    let syncRunning = false;
    let serverOperationRunning = false;

    function reportError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        writeTerminal(`Error: ${message}\n`, "red");
        console.error(error);
    }

    const codeGrinderUI = new CodeGrinderUI(
        navBar,
        codeGrinder,
        storeSessionKey,
        assignment => switchAssignment(assignment),
        reportError,
    );

    async function loadProblem(problem: WorkspaceProblem): Promise<void> {
        currentProblem = problem;
        editablePaths = problem.studentPaths;
        fileSystem.clear();
        tabs.closeAll();
        for (const [path, content] of Object.entries(problem.files)) {
            fileSystem.touch(`/${path}`).content = content;
            if (problem.studentPaths.has(path)) {
                tabs.addSwitchTab(`/${path}`, content, false);
            }
        }
        activeInstructionsHtml = problem.internalFiles["doc.html"];
        mdElement.innerHTML = activeInstructionsHtml;
        fileSystemUI.refreshUI();
        codeGrinderUI.buttonGrade.innerText = problem.completed ? "Finished" : "Grade";
        codeGrinderUI.buttonGrade.disabled = problem.completed;
        codeGrinderUI.setActions(problem.actions);
        workspaceRevision.markLoaded();
        await activateLocalRuntime(problem.problemType, problem.files);
    }

    async function loadAssignment(
        assignment: LoadedAssignment,
        preferredProblemId: string | null = null,
    ): Promise<void> {
        currentAssignment = assignment;
        tabs.autoSave = true;
        tabs.setPathChangesAllowed(false);
        newTab.hidden = true;
        embed.hidden = true;
        codeGrinderUI.problemsList.innerText = "";
        const problems = [...assignment.problems].sort((left, right) => left.problemId.localeCompare(right.problemId));
        for (const problem of problems) {
            const li = document.createElement("li");
            const button = document.createElement("button");
            li.appendChild(button);
            codeGrinderUI.problemsList.appendChild(li);
            button.innerText = `${problem.completed ? "✓ " : ""}${problem.problemId}`;
            button.addEventListener("click", () => {
                void switchProblem(problem).catch(reportError);
            });
        }
        const preferred = problems.find(problem => problem.problemId === preferredProblemId && !problem.completed);
        await loadProblem(preferred ?? problems.find(problem => !problem.completed) ?? problems[0]);
    }

    function queueSync(showStatus: boolean): Promise<void> {
        const problem = currentProblem;
        if (!problem) {
            return Promise.resolve();
        }
        tabs.saveAllTabs();
        const files = workspaceFiles(fileSystem.rootNode);
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
                    if (currentProblem === problem) {
                        workspaceRevision.markSaved(revision);
                    }
                    if (showStatus) {
                        if (currentProblem === problem) {
                            await loadProblem(problem);
                        }
                        writeTerminal(`Problem ${problem.problemId} step ${problem.stepNumber} synced\n`, "green");
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
        if (!currentProblem || !workspaceRevision.dirty) {
            return;
        }
        await queueSync(false);
        if (workspaceRevision.dirty) {
            throw new Error("Current work could not be saved; staying in this workspace");
        }
    }

    async function runServerOperation<Result>(
        operation: () => Promise<Result>,
        saveCurrentWorkspace = false,
    ): Promise<Result | undefined> {
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
            return await operation();
        } finally {
            serverOperationRunning = false;
            tabs.setInteractionDisabled(syncRunning);
        }
    }

    async function switchProblem(problem: WorkspaceProblem): Promise<void> {
        await runServerOperation(() => loadProblem(problem), true);
    }

    async function switchAssignment(assignment: LoadedAssignment): Promise<void> {
        await runServerOperation(() => loadAssignment(assignment), true);
    }

    codeGrinderUI.buttonSync.addEventListener("click", () => {
        void queueSync(true).catch(reportError);
    });
    codeGrinderUI.buttonReset.addEventListener("click", async () => {
        if (!currentProblem || !window.confirm("Restore all student files to the beginning of this step?")) {
            return;
        }
        const problem = currentProblem;
        await runServerOperation(async () => {
            try {
                await codeGrinder.reset(problem);
                await loadProblem(problem);
            } catch (error) {
                reportError(error);
            }
        });
    });
    codeGrinderUI.buttonGrade.addEventListener("click", async () => {
        if (!currentProblem || !currentAssignment) {
            return;
        }
        codeGrinderUI.buttonGrade.disabled = true;
        tabs.saveAllTabs();
        const problem = currentProblem;
        const assignment = currentAssignment;
        const problemId = problem.problemId;
        const files = workspaceFiles(fileSystem.rootNode);
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
                        result.problem.completed
                            ? `Completed ${problemId}\n`
                            : `Moving to step ${result.problem.stepNumber}\n`,
                        "green",
                    );
                }
                if (result.message !== "") {
                    writeTerminal(`${result.message}\n`, "red");
                }
                if (currentAssignment?.lockedForLms) {
                    writeTerminal("Grade was not posted to the LMS because the assignment is locked\n", "red");
                }
                await loadAssignment(assignment, problemId);
            } catch (error) {
                reportError(error);
            } finally {
                codeGrinderUI.buttonGrade.disabled = currentProblem?.completed ?? true;
            }
        });
    });
    async function runAction(action: string): Promise<void> {
        if (!currentProblem) {
            return;
        }
        const problem = currentProblem;
        tabs.saveAllTabs();
        const files = workspaceFiles(fileSystem.rootNode);
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
            await loadProblem(problem);
        });
    }

    codeGrinderUI.actionHandler = runAction;
    codeGrinderUI.testHandler = async () => {
        if (!currentProblem) {
            return;
        }
        codeGrinderUI.buttonTest.disabled = true;
        try {
            tabs.saveAllTabs();
            if (localRuntime.supportsLocalTests) {
                writeTerminal("Running tests\n", "orange");
                await executeLocally(() => localRuntime.runTests(fileSystem));
                return;
            }
            await runAction("test");
        } finally {
            codeGrinderUI.buttonTest.disabled = !codeGrinder.getMe()
                || !currentProblem?.actions.includes("test");
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
            if (assignmentKey && !codeGrinder.getMe()) {
                throw new Error("Log in again from the course site to load this assignment");
            }
            if (assignmentKey && codeGrinder.getMe()) {
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
        if (!currentProblem || syncRunning || serverOperationRunning || !workspaceRevision.dirty) {
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
        if (Object.keys(fileSystem.rootNode.children).length === 0) {
            requireClassElement("tabs-container").style.display = "none";
            const mainPath = localRuntimeConfig.get(problemType) === "python" ? "/main.py" : "/main.js";
            tabs.addSwitchTab(mainPath, "");
        }
        await activateLocalRuntime(problemType, workspaceFiles(fileSystem.rootNode));
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
            await activateLocalRuntime(problemType, workspaceFiles(fileSystem.rootNode));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            run.disabled = true;
            run.innerText = "Run unavailable";
            writeTerminal(`${message}\n`, "red");
        }
    }
}
