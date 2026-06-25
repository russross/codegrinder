import { Tabs } from './editorTabs.js';
import { FileSystem, FileSystemUI, extension } from './directoryTree.js';
import { JavaScriptRunner } from './jsHandler.js'
import { CodeGrinder, CodeGrinderUI } from './codeGrinder.js';
import { decodeBase64ToUTF8, encodeUTF8OrLatin1AsBase64 } from './encodingHelpers.js';
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
    tabs.addSwitchTab(path, fileNode.content);
    if (extension(path) === "md") {
        mdElement.innerHTML = md.render(fileNode.content);
    } else if (extension(path) === "html") {
        console.warn("Running potentially untrusted html");
        mdElement.innerHTML = fileNode.content;
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
let serverRunning = false;
window.iframeSharedArrayBufferWorkaroundServiceWorkerLoss = function () {
    javaScriptRunner.stopJavaScript();
}
let serverStdin;
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
        if (serverRunning) {
            serverStdin(value)
            return;
        }
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
javaScriptRunner.setToMainThreadCallback(data => {
    // Hook for future extensions (e.g., displaying images or other data)
    console.log('Message from worker:', data);
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
    const path = tabs.tabs[tabs.currentTab].path
    runJavaScript(path);
})

function setupCodegrinder() {
    const codegrinderCookie = "codegrinderCookie";
    const codeGrinder = new CodeGrinder(window.localStorage.getItem(codegrinderCookie));
    const codeGrinderUI = new CodeGrinderUI(navBar, codeGrinder, cookie => window.localStorage.setItem(codegrinderCookie, cookie));

    let currentProblemsFiles;
    let currentDotFile;
    let currentProblemUnique;
    let currentProblemsWhitelist;
    function switchProblem(unique) {
        currentProblemUnique = unique;
        fileSystem.clear();
        tabs.closeAll();
        for (let filename in currentProblemsFiles[unique]) {
            let content = currentProblemsFiles[unique][filename];
            fileSystem.touch("/" + filename).content = content;
            if (currentProblemsWhitelist[unique][filename]) {
                tabs.addSwitchTab("/" + filename, content);
            }
        }
        // Create a basic test runner file for JavaScript
        fileSystem.touch("/.run_all_tests.js").content = `
// Basic test runner - run all test files in tests/ directory
console.log("Test runner not yet implemented for JavaScript version");
`;
        mdElement.innerHTML = fileSystem.touch("/doc/index.html").content;
        fileSystemUI.refreshUI();
        const finished = currentDotFile.completed.has(unique);
        codeGrinderUI.buttonGrade.innerText = finished ? "Finished" : "Grade";
        codeGrinderUI.buttonGrade.disabled = finished;
        if (fileSystem.rootNode.children?.bin.children?.["setup.js"]) {
            runJavaScript("/bin/setup.js", true);
        }

    }
    function problemSetHandler({ problemsFiles, dotFile, problemsWhitelist }, current) {
        currentProblemsFiles = problemsFiles;
        currentDotFile = dotFile;
        currentProblemsWhitelist = problemsWhitelist;
        let firstUnfinished = null;
        codeGrinderUI.problemsList.innerText = "";
        const keys = [];
        for (let key in currentDotFile.problems) {
            keys.push(key);
        }
        keys.sort()
        for (let problem of keys) {
            const li = document.createElement("li");
            const button = document.createElement("button");
            li.appendChild(button);
            codeGrinderUI.problemsList.appendChild(li);
            if (currentDotFile.completed.has(problem)) {
                button.innerText = "✓ " + problem;
            } else {
                button.innerText = problem;
                if (!firstUnfinished) {
                    firstUnfinished = problem;
                }
            }
            button.addEventListener("click", async () => {
                switchProblem(problem);
            })
        }
        if (current && !currentDotFile.completed.has(current)) {
            switchProblem(current)
        } else {
            switchProblem(firstUnfinished || keys[0]);
        }
    }
    codeGrinderUI.buttonRunTests.addEventListener("click", () => {
        runJavaScript("/.run_all_tests.js", true);
    })
    function toFiles(directory, path = "/", files = {}) {
        for (let name in directory.children) {
            const node = directory.children[name];
            // If is directory
            if (node.children) {
                toFiles(node, path + name + "/", files);
            } else {
                files[path + name] = encodeUTF8OrLatin1AsBase64(node.content);
            }
        }
        return files;
    }
    codeGrinderUI.buttonSync.addEventListener("click", async () => {
        const files = toFiles(fileSystem.rootNode, "");
        await codeGrinder.commandSync((await codeGrinderUI.me), files, currentDotFile, currentProblemUnique);
    })
    codeGrinderUI.buttonReset.addEventListener("click", async () => {
        currentProblemsFiles[currentProblemUnique] = await codeGrinder.commandReset(currentDotFile, currentProblemUnique);
        switchProblem(currentProblemUnique);
    })
    codeGrinderUI.buttonGrade.addEventListener("click", async () => {
        const files = toFiles(fileSystem.rootNode, "");
        await codeGrinder.commandGrade((await codeGrinderUI.me), files, currentDotFile, currentProblemUnique, stdoutStr => {
            writeTerminal(stdoutStr, "green");
        }, stderrStr => {
            writeTerminal(stderrStr, "darkgreen");
        });
        await codeGrinder.commandGet(currentDotFile.assignmentID).then(res => problemSetHandler(res, currentProblemUnique));
    })
    codeGrinder.actionHandler = async (action) => {
        const files = toFiles(fileSystem.rootNode, "");
        await codeGrinder.commandAction((await codeGrinderUI.me), files, currentDotFile, currentProblemUnique,
            () => {
                writeTerminal(stdoutStr, "purple");
            }, stdoutStr => {
                writeTerminal(stdoutStr, "purple");
            }, stderrStr => {
                writeTerminal(stderrStr, "darkpurple");
            });
    }
    codeGrinderUI.problemSetHandler = problemSetHandler;
    const urlSession = urlParams.get("session");
    let codeGrinderReadyPromise = new Promise((resolve) => resolve());
    if (urlSession) {
        codeGrinderReadyPromise = codeGrinder.login(urlSession);
        codeGrinderReadyPromise.then(() => { codeGrinderUI.me = codeGrinder.getMe(); codeGrinderUI.updateAuthenticationStatus() });
        codeGrinderUI.buttonAuthenticator.style.display = "none";
    }
    const urlAssignment = urlParams.get('assignment');
    if (urlAssignment) {
        // Simplify interface if assignment is known
        newTab.style.display = "none";
        saveCurrent.style.display = "none";
        saveAll.style.display = "none";
        codeGrinderUI.buttonAssignments.style.display = "none";
        codeGrinderUI.buttonSync.style.display = "none";
        embed.style.display = "none";
        tabs.autoSave = true;
        codeGrinderReadyPromise.then(() => codeGrinder.commandGet(urlAssignment)).then(res => problemSetHandler(res));
        let lastSyncedChange = mostRecentChange;
        setInterval(async () => {
            const currentFiles = toFiles(fileSystem.rootNode, "");
            for (let filename in currentProblemsFiles[currentProblemUnique]) {
                const content = currentProblemsFiles[currentProblemUnique][filename];
                if (decodeBase64ToUTF8(currentFiles[filename]) !== content) {
                    if (mostRecentChange > lastSyncedChange) {
                        lastSyncedChange = mostRecentChange;
                        console.log("Auto Sync")
                        await codeGrinder.commandSync((await codeGrinderUI.me), currentFiles, currentDotFile, currentProblemUnique);
                        break;
                    }
                }
            }
        }, 5000);
    }
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