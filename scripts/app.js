import { Tabs } from './editorTabs.js';
import { FileSystem, FileSystemUI, extension } from './directoryTree.js';
import { JavaScriptRunner } from './jsHandler.js'
import { CodeGrinder, CodeGrinderUI } from './codeGrinderApi.js';

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

const javaScriptRunner = new JavaScriptRunner();
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
embed.addEventListener("click", () => {
    const files = encodeURIComponent(JSON.stringify(fileSystem.rootNode));
    const string = `<div style="position: relative; padding-bottom: 56.25%; padding-top: 0px; height: 0; overflow: hidden;"><iframe style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;" src="${location.origin + location.pathname}?dummy=true&files=${files}"></iframe></div>`;
    navigator.clipboard.writeText(string);
    console.log(string);
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

// Set up JavaScript execution
let javaScriptRunning = false;
window.iframeSharedArrayBufferWorkaroundServiceWorkerLoss = function () {
    javaScriptRunner.stopJavaScript();
}
run.disabled = true;
javaScriptRunner.ready.then(() => {
    run.disabled = false;
    run.innerText = "Run";
    writeTerminal(">> ", "orange");
});
input_terminal.addEventListener("keydown", event => {
    input_terminal.style.color = javaScriptRunning ? "grey" : "blue";
    if (event.key === "Enter") {
        const withoutTrailingNewline = input_terminal.value.replace(/\n+$/, "")
        let value = withoutTrailingNewline + "\n";
        input_terminal.value = "";
        input_terminal.focus();
        event.preventDefault();
        if (javaScriptRunning) {
            writeTerminal(value, "grey");
            javaScriptRunner.writeStdin(value);
        } else {
            writeTerminal(value, "blue");
            run.innerText = "Stop"
            javaScriptRunning = true;
            javaScriptRunner.runJavaScript(fileSystem, value).then(async () => {
                await javaScriptRunner.ready;
                setTimeout(() => writeTerminal(">> ", "orange"), 1000);
                javaScriptRunning = false;
                run.innerText = "Run";
                run.disabled = false;
            });
        }
    }
})
javaScriptRunner.setStdoutCallback(str => {
    writeTerminal(str, "black");
})
javaScriptRunner.setStderrCallback(str => {
    writeTerminal(str, "red");
});
async function runJavaScript(path, clearFiles = false) {
    if (javaScriptRunning) {
        run.disabled = true;
        javaScriptRunning = false;
        javaScriptRunner.stopJavaScript();
        run.innerText = "Stopping";
    } else {
        run.innerText = "Stop"
        javaScriptRunning = true;
        writeTerminal("Running " + path + "\n", "orange");
        await javaScriptRunner.runJavaScript(fileSystem, `run_script(".${path}")`, clearFiles);
        await javaScriptRunner.ready;
        setTimeout(() => writeTerminal(">> ", "orange"), 1000);
        javaScriptRunning = false;
        run.innerText = "Run";
        run.disabled = false;
    }
}
run.addEventListener("click", async () => {
    const currentTab = tabs.tabs[tabs.currentTab];
    if (currentTab) {
        runJavaScript(currentTab.path);
    }
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

    function loadProblem(problem) {
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
    }

    function loadAssignment(assignment, preferredProblemId = null) {
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
            button.addEventListener("click", () => loadProblem(problem));
        }
        const preferred = problems.find(problem => problem.problemId === preferredProblemId && !problem.completed);
        loadProblem(preferred ?? problems.find(problem => !problem.completed) ?? problems[0]);
    }

    function toFiles(directory, path = "", files = {}) {
        for (const name in directory.children) {
            const node = directory.children[name];
            if (node.children) {
                toFiles(node, `${path}${name}/`, files);
            } else {
                files[`${path}${name}`] = node.content;
            }
        }
        return files;
    }

    function queueSync(showStatus) {
        const problem = currentProblem;
        if (!problem || syncRunning || serverOperationRunning) {
            return Promise.resolve();
        }
        tabs.saveAllTabs();
        const files = toFiles(fileSystem.rootNode);
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
                            loadProblem(problem);
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
                loadProblem(problem);
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
        const files = toFiles(fileSystem.rootNode);
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
                loadAssignment(currentAssignment, problemId);
            } catch (error) {
                reportError(error);
            } finally {
                codeGrinderUI.buttonGrade.disabled = currentProblem?.completed ?? true;
            }
        });
    });
    codeGrinderUI.actionHandler = async (action) => {
        if (!currentProblem) {
            return;
        }
        const problem = currentProblem;
        tabs.saveAllTabs();
        const files = toFiles(fileSystem.rootNode);
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
            loadProblem(problem);
        });
    };

    async function initialize() {
        const loginToken = urlParams.get("token") ?? "";
        const assignmentKey = urlParams.get("assignment");
        try {
            if (loginToken !== "") {
                await codeGrinder.login(loginToken);
                window.localStorage.setItem(sessionStorageKey, codeGrinder.sessionKey);
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete("token");
                window.history.replaceState(null, "", cleanUrl);
            } else if (savedSessionKey !== "") {
                await codeGrinder.restoreSession();
            }
            codeGrinderUI.updateAuthenticationStatus();
            if (assignmentKey && codeGrinder.getMe()) {
                await loadAssignment(await codeGrinder.loadAssignment(assignmentKey));
                codeGrinderUI.buttonAssignments.hidden = true;
            }
        } catch (error) {
            window.localStorage.removeItem(sessionStorageKey);
            codeGrinder.logout();
            codeGrinderUI.updateAuthenticationStatus();
            reportError(error);
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
    if (Object.keys(fileSystem.rootNode.children).length === 0) {
        document.getElementsByClassName("tabs-container")[0].style.display = "none";
        tabs.addSwitchTab("/main.js", "")
    }
    document.getElementsByClassName("path-input")[0].style.display = "none";
    run.style.position = "absolute";
    run.style.right = 0;
    run.style.top = 0;
    run.style.zIndex = 1;
    run.style.borderRadius = "100%";
    run.style.backgroundColor = "green";
    run.style.margin = "20px";
    tabs.autoSave = true;
} else {
    setupCodegrinder();
}
