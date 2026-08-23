import { Tabs } from './editorTabs.js';
import { FileSystem, FileSystemUI, extension } from './directoryTree.js';
import { CodeGrinder, CodeGrinderUI } from './codeGrinderApi.js';
import {
    createEmbedHtml,
    legacyWebProblemType,
    problemTypeFromFilePaths,
    standaloneProblemType,
} from './embed.js';
import { LocalRuntimeController, loadLocalRuntimeConfig, withTimeout } from './localRuntime.js';
import { createChoicePrompt } from './prompt.js';

await window.codeGrinderServiceWorkerReady;

const output_terminal_label = document.getElementById("output_terminal")
const output_terminal = output_terminal_label.getElementsByTagName("pre")[0];
const input_terminal = output_terminal_label.getElementsByTagName("textarea")[0];
const filesButton = document.getElementById("files_button");
const filesList = document.getElementById("files_list");
const run = document.getElementById("run");
const newTab = document.getElementById("new_tab");
const saveCurrent = document.getElementById("save_current");
const saveAll = document.getElementById("save_all");
const embed = document.getElementById("embed");
const mdElement = document.getElementById("instructions");
const navBar = document.getElementById("nav_bar");
run.dataset.loadingStage = "runtime-config";
console.info("CodeGrinder: loading local runtime configuration");
let localRuntimeConfig;
try {
    localRuntimeConfig = await withTimeout(
        loadLocalRuntimeConfig(new URL('../local-runtimes.json', import.meta.url)),
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
const fileSystem = new FileSystem();
const fileSystemUI = new FileSystemUI(fileSystem, document.getElementById("directory_tree"));
let mostRecentChange = new Date();
const tabs = new Tabs(document.getElementById("tabs"), (path, content) => {
    const fout = fileSystem.touch(path);
    fout.content = content;
    mostRecentChange = new Date();
    fileSystemUI.refreshUI();
});
let editablePaths = null;
let activeLocalProblemType = null;

const urlParams = new URLSearchParams(window.location.search);

function workspaceFiles(directory, path = "", files = {}) {
    for (const [name, node] of Object.entries(directory.children)) {
        if (node.children) {
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
        mdElement.innerHTML = md.render(fileNode.content);
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
    fileSystem.rootNode = JSON.parse(urlFiles);
    fileSystemUI.refreshUI();
    tabs.closeAll();
    for (let file in fileSystem.rootNode.children) {
        if (!fileSystem.rootNode.children[file].children) {
            tabs.addSwitchTab("/" + file, fileSystem.rootNode.children[file].content);
        }
    }
}

// Set up terminal
let previousSpan = document.createElement("span");
function writeTerminal(str, color) {
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
        output_terminal_label.parentElement.scrollTop = output_terminal_label.parentElement.scrollHeight;
    }, 100);
    previousSpan.innerText += str;
}

// Set up local execution. Runtime modules are imported only after a supported
// problem type is selected.
const display = document.getElementById("turtle");
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
let localRuntimeAvailable = false;
let localRuntimeOperation = 0;
let localRuntimeRunning = false;
input_terminal.disabled = true;

function setLocalRuntimeReady() {
    localRuntimeAvailable = true;
    input_terminal.disabled = false;
    run.classList.remove("loading-spinner");
    delete run.dataset.loadingStage;
    run.removeAttribute("aria-label");
    run.disabled = false;
    run.innerText = "Run";
    run.title = "";
}

function setLocalRuntimeLoading(stage, status) {
    console.info(`CodeGrinder: ${status}`);
    run.classList.add("loading-spinner");
    run.dataset.loadingStage = stage;
    run.disabled = true;
    run.innerText = "";
    run.setAttribute("aria-label", status);
}

async function activateLocalRuntime(problemType, files) {
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
        if (globalThis.codeGrinderSharedArrayBufferFallback && !navigator.serviceWorker?.controller) {
            throw new Error("The local runtime service worker is unavailable; reload the page to try again");
        }
        const runtimeName = await localRuntime.select(problemType);
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

async function executeLocally(operation) {
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

async function stopLocalRuntime() {
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

function setupCodegrinder() {
    const sessionStorageKey = "codegrinderSessionKey";
    const savedSessionKey = window.localStorage.getItem(sessionStorageKey) ?? "";
    const codeGrinder = new CodeGrinder(savedSessionKey);
    let currentAssignment = null;
    let currentProblem = null;
    let syncPromise = Promise.resolve();
    let syncRunning = false;
    let serverOperationRunning = false;

    function reportError(error) {
        const message = error instanceof Error ? error.message : String(error);
        writeTerminal(`Error: ${message}\n`, "red");
        console.error(error);
    }

    const codeGrinderUI = new CodeGrinderUI(
        navBar,
        codeGrinder,
        sessionKey => {
            if (sessionKey === "") {
                window.localStorage.removeItem(sessionStorageKey);
            } else {
                window.localStorage.setItem(sessionStorageKey, sessionKey);
            }
        },
        assignment => loadAssignment(assignment),
        reportError,
    );

    async function loadProblem(problem) {
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
        const instructions = problem.files["doc/doc.md"] ?? "";
        mdElement.innerHTML = md.render(instructions);
        fileSystemUI.refreshUI();
        codeGrinderUI.buttonGrade.innerText = problem.completed ? "Finished" : "Grade";
        codeGrinderUI.buttonGrade.disabled = problem.completed;
        codeGrinderUI.setActions(problem.actions);
        await activateLocalRuntime(problem.problemType, problem.files);
    }

    async function loadAssignment(assignment, preferredProblemId = null) {
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
            button.addEventListener("click", () => loadProblem(problem).catch(reportError));
        }
        const preferred = problems.find(problem => problem.problemId === preferredProblemId && !problem.completed);
        await loadProblem(preferred ?? problems.find(problem => !problem.completed) ?? problems[0]);
    }

    function queueSync(showStatus) {
        const problem = currentProblem;
        if (!problem || syncRunning || serverOperationRunning) {
            return Promise.resolve();
        }
        tabs.saveAllTabs();
        const files = workspaceFiles(fileSystem.rootNode);
        syncPromise = syncPromise
            .catch(() => {})
            .then(async () => {
                syncRunning = true;
                tabs.setInteractionDisabled(true);
                try {
                    const result = await codeGrinder.sync(problem, files);
                    if (result.message !== "") {
                        writeTerminal(`${result.message}\n`, "red");
                    } else if (showStatus) {
                        if (currentProblem === problem) {
                            await loadProblem(problem);
                        }
                        writeTerminal(`Problem ${problem.problemId} step ${problem.stepNumber} synced\n`, "green");
                    }
                } finally {
                    syncRunning = false;
                    tabs.setInteractionDisabled(serverOperationRunning);
                }
            })
            .catch(reportError);
        return syncPromise;
    }

    async function runServerOperation(operation) {
        if (serverOperationRunning) {
            return;
        }
        serverOperationRunning = true;
        tabs.setInteractionDisabled(true);
        try {
            await syncPromise;
            return await operation();
        } finally {
            serverOperationRunning = false;
            tabs.setInteractionDisabled(syncRunning);
        }
    }

    codeGrinderUI.buttonSync.addEventListener("click", () => queueSync(true));
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
        if (!currentProblem) {
            return;
        }
        codeGrinderUI.buttonGrade.disabled = true;
        tabs.saveAllTabs();
        const problem = currentProblem;
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
                await loadAssignment(currentAssignment, problemId);
            } catch (error) {
                reportError(error);
            } finally {
                codeGrinderUI.buttonGrade.disabled = currentProblem?.completed ?? true;
            }
        });
    });
    async function runAction(action) {
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

    async function initialize() {
        const loginToken = urlParams.get("token") ?? "";
        const assignmentKey = urlParams.get("assignment");
        if (assignmentKey) {
            setLocalRuntimeLoading("server", "loading assignment session");
        }
        try {
            if (loginToken !== "") {
                console.info("CodeGrinder: exchanging login token for a session");
                await withTimeout(codeGrinder.login(loginToken), 30000, "logging in to CodeGrinder");
                window.localStorage.setItem(sessionStorageKey, codeGrinder.sessionKey);
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
            window.localStorage.removeItem(sessionStorageKey);
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

    let lastSyncedChange = mostRecentChange;
    setInterval(() => {
        if (!currentProblem || syncRunning || serverOperationRunning || mostRecentChange <= lastSyncedChange) {
            return;
        }
        lastSyncedChange = mostRecentChange;
        queueSync(false);
    }, 5000);
}
const urlDummy = urlParams.get("dummy");
if (urlDummy) {
    newTab.style.display = "none";
    saveCurrent.style.display = "none";
    saveAll.style.display = "none";
    filesButton.style.display = "none";
    embed.style.display = "none";
    document.getElementById("instructions_container").style.display = "none";
    document.getElementsByClassName("path-input")[0].style.display = "none";
    run.style.position = "absolute";
    run.style.right = 0;
    run.style.top = 0;
    run.style.zIndex = 1;
    run.style.borderRadius = "100%";
    run.style.backgroundColor = "green";
    run.style.margin = "20px";
    tabs.autoSave = true;
    try {
        const problemType = standaloneProblemType(urlParams, localRuntimeConfig);
        if (Object.keys(fileSystem.rootNode.children).length === 0) {
            document.getElementsByClassName("tabs-container")[0].style.display = "none";
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
