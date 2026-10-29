import { EditorView } from "@codemirror/view";
import { language } from "@codemirror/language";
import { riscletLanguage } from "./risclet";
import { TerminalView } from "./terminal";
import type { Riscbox } from "@riscbox/runtime";
import {
    Commit, CommitSaveStatus, EventMessage, GetAssignmentResponse, GetWorkspaceRequest, GetWorkspaceResponse,
    HelloResponse, RunAssignmentActionRequest, RunAssignmentActionResponse,
    SaveWorkspaceCommitRequest, SaveWorkspaceCommitResponse,
} from "./codegrinder";
import { loadRuntime, vmImageForProblemType } from "./vm";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function until(predicate: () => boolean | Promise<boolean>, message: string): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!await predicate()) {
        if (Date.now() > deadline) throw new Error(message);
        await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
}
function button(id: string): HTMLButtonElement {
    const node = document.getElementById(id);
    if (!(node instanceof HTMLButtonElement)) throw new Error(`Missing button: ${id}`);
    return node;
}
function editor(): EditorView {
    const host = document.querySelector<HTMLElement>(".cm-editor");
    const view = host === null ? undefined : EditorView.findFromDOM(host);
    if (view === undefined || view === null) throw new Error("Editor is unavailable");
    return view;
}
function edit(text: string): void {
    const view = editor();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
function frame(bytes: Uint8Array, kind = 0): Uint8Array {
    const framed = new Uint8Array(bytes.length + 5);
    framed[0] = kind;
    new DataView(framed.buffer).setUint32(1, bytes.length);
    framed.set(bytes, 5);
    return framed;
}
function reply(bytes: Uint8Array, status = 0, following: Uint8Array[] = []): Response {
    const body = new Uint8Array([...frame(bytes), ...following.flatMap(message => [...frame(message)]),
        ...frame(encoder.encode(`grpc-status: ${status}\r\n`), 128)]);
    return new Response(body, { headers: { "content-type": "application/grpc-web+proto" } });
}

let acceptance: { results?: string[]; error?: string } | null = null;
let rebootClickNeeded = false;
export function examAcceptanceNeedsRebootClick(): boolean { return rebootClickNeeded; }
async function clickRebootRecovery(): Promise<void> {
    await new Promise<void>(resolve => {
        rebootClickNeeded = true;
        button("vm-boot-button").addEventListener("click", () => { rebootClickNeeded = false; resolve(); }, { once: true });
    });
}
export function startExamAcceptance(): void {
    acceptance = null;
    void runExamAcceptance().then(results => { acceptance = { results }; }, error => {
        acceptance = { error: error instanceof Error ? error.stack ?? error.message : String(error) };
    });
}
export function examAcceptanceResult(): { results?: string[]; error?: string } | null { return acceptance; }

// Exercise the actual page and transport against a deterministic protobuf RPC peer.
export async function runExamAcceptance(): Promise<string[]> {
    const nativeFetch = window.fetch.bind(window);
    const markup = await (await nativeFetch("index.html")).text();
    const page = new DOMParser().parseFromString(markup, "text/html");
    document.body.replaceChildren(...page.body.childNodes);
    const key = { userId: "student", courseId: "course", problemSetId: "quiz" };
    history.replaceState(null, "", "?assignment=student:course:quiz&token=test");
    const saved = new Map<string, string>();
    let currentStep = "1";
    let gradePassed = true;
    let lockedForLms = false;
    let actionSaveStatus = CommitSaveStatus.SAVED;
    let actionFailure: "none" | "missing" | "transport" | "missingGrade" = "none";
    let holdAction = false;
    let finishAction: (() => void) | undefined;
    const calls: string[] = [];
    const confirmations: string[] = [];
    const nativeConfirm = window.confirm;
    window.confirm = message => { confirmations.push(message ?? ""); return false; };
    let failSave = false;
    let blockSave = false;
    let release: (() => void) | undefined;
    const releasePendingSave = (): void => { release?.(); release = undefined; };
    let machine: Riscbox | undefined;
    let guestOutput = "";
    // Observe the actual output parser; WebGL text is not represented by DOM text nodes.
    let gradingOutput: TerminalView | undefined;
    const terminalWrite = TerminalView.prototype.write;
    TerminalView.prototype.write = function (text) {
        if (this.element.id === "terminal") gradingOutput = this;
        terminalWrite.call(this, text);
    };
    const image = vmImageForProblemType("riscv");
    if (image === undefined) throw new Error("Missing VM image");
    const constructor = await loadRuntime(image);
    const prepare = constructor.prepare.bind(constructor);
    constructor.prepare = async options => {
        machine = await prepare({
            ...options,
            consoleReset: () => { guestOutput = ""; options?.consoleReset?.(); },
            consoleWrite: text => { guestOutput += text; options?.consoleWrite?.(text); },
        });
        return machine;
    };
    window.fetch = async (input, init) => {
        const request = new Request(input, init);
        const method = new URL(request.url).pathname.split("/").pop() ?? "";
        if (!new URL(request.url).pathname.includes("codegrinder.CodeGrinderService")) return nativeFetch(input, init);
        calls.push(method);
        if (method !== "Hello") check(request.headers.get("authorization") === "Bearer fixture-session", "RPC lost raw session metadata");
        const body = request.headers.get("content-type")?.includes("grpc-web-text")
            ? Uint8Array.from(atob(await request.text()), character => character.charCodeAt(0))
            : new Uint8Array(await request.arrayBuffer());
        const payload = body.subarray(5);
        switch (method) {
            case "Hello": return reply(HelloResponse.toBinary(HelloResponse.create({ userId: "student", sessionKey: "fixture-session" })));
            case "GetAssignment": return reply(GetAssignmentResponse.toBinary(GetAssignmentResponse.create({ assignment: key,
                problems: ["first", "second", "plain"].map(problemId => ({ problemId, problemNote: problemId,
                    firstStepNumber: "1", lastStepNumber: problemId === "first" ? "2" : "1", currentStepNumber: "1" })) })));
            case "GetWorkspace": {
                const request = GetWorkspaceRequest.fromBinary(payload);
                return reply(GetWorkspaceResponse.toBinary(GetWorkspaceResponse.create({ assignment: key,
                    problemId: request.problemId, problemType: request.problemId === "plain" ? "python" : "riscv",
                    stepNumber: request.problemId === "first" ? (request.stepNumber === "0" ? currentStep : request.stepNumber) : "1",
                    firstStepNumber: "1", lastStepNumber: request.problemId === "first" ? "2" : "1", actions: ["grade", "write"],
                    systemOwnedFiles: request.problemId === "second" ? { "system.txt": encoder.encode("system\n") }
                        : { "system.txt": encoder.encode("system\n"), "doc/doc.md": encoder.encode("# Instructions\n") },
                    studentOwnedFiles: { "main.s": encoder.encode(request.problemId === "first" && request.stepNumber === "2"
                        ? "step two\n" : saved.get(request.problemId) ?? `${request.problemId}\n`) },
                })));
            }
            case "SaveWorkspaceCommit": {
                const commit = SaveWorkspaceCommitRequest.fromBinary(payload).commit;
                check(commit !== undefined && Object.keys(commit.files).join() === "main.s", "Save included unofficial files");
                if (commit === undefined) throw new Error("Missing commit");
                if (blockSave) { blockSave = false; await new Promise<void>(resolve => { release = resolve; }); }
                if (failSave) { failSave = false; return reply(new Uint8Array(), 14); }
                saved.set(commit.problemId, decoder.decode(commit.files["main.s"]));
                return reply(SaveWorkspaceCommitResponse.toBinary(SaveWorkspaceCommitResponse.create({ saveStatus: CommitSaveStatus.SAVED })));
            }
            case "RunAssignmentAction": {
                const action = RunAssignmentActionRequest.fromBinary(payload);
                check(Object.keys(action.files).join() === "main.s", "Action included unofficial files");
                check(action.assignment?.userId === key.userId && action.problemId === "first"
                    && action.note === `exam interface: ${action.action}`, "Action lost assignment context or note");
                check(request.headers.get("grpc-timeout") === "120000m", "Action lost its execution deadline");
                if (actionSaveStatus === CommitSaveStatus.SAVED) saved.set(action.problemId, decoder.decode(action.files["main.s"]));
                const commit = Commit.create({ ...action, score: gradePassed ? 1 : 0,
                    reportCard: { passed: gradePassed },
                    transcript: [EventMessage.create({ event: "stdout", streamData: encoder.encode("grade diagnostics\n") })],
                    files: { "main.s": encoder.encode("graded output\n"), "unofficial": encoder.encode("excluded") },
                });
                const event = RunAssignmentActionResponse.create({ response: { oneofKind: "event", event:
                    action.action === "grade"
                        ? EventMessage.create({ event: "stdout", streamData: encoder.encode("live grade output\n") })
                        : EventMessage.create({ event: "files", files: { "main.s": encoder.encode("action output\n"), "unofficial": encoder.encode("excluded") } }),
                } });
                if (actionFailure === "missing" || actionFailure === "transport") {
                    return reply(RunAssignmentActionResponse.toBinary(event), actionFailure === "transport" ? 14 : 0);
                }
                if (gradePassed && action.action === "grade" && actionSaveStatus === CommitSaveStatus.SAVED
                    && actionFailure !== "missingGrade") currentStep = "2";
                const result = RunAssignmentActionResponse.create({ response: { oneofKind: "result", result: {
                    saveStatus: actionSaveStatus, lockedForLms,
                    grade: action.action === "grade" && actionFailure !== "missingGrade" ? commit : undefined,
                } } });
                if (holdAction) {
                    holdAction = false;
                    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
                        const output = RunAssignmentActionResponse.create({ response: { oneofKind: "event",
                            event: EventMessage.create({ event: "stdout", streamData: encoder.encode("streamed action output\n") }),
                        } });
                        controller.enqueue(frame(RunAssignmentActionResponse.toBinary(output)));
                        controller.enqueue(frame(RunAssignmentActionResponse.toBinary(event)));
                        finishAction = () => {
                            controller.enqueue(frame(RunAssignmentActionResponse.toBinary(result)));
                            controller.enqueue(frame(encoder.encode("grpc-status: 0\r\n"), 128));
                            controller.close();
                        };
                    } }), { headers: { "content-type": "application/grpc-web+proto" } });
                }
                return reply(RunAssignmentActionResponse.toBinary(event), 0, [RunAssignmentActionResponse.toBinary(result)]);
            }
            default: throw new Error(`Unexpected RPC: ${method}`);
        }
    };
    try {
        await import("./index");
        document.dispatchEvent(new Event("DOMContentLoaded"));
        await until(() => document.querySelector(".file-tree button") !== null, "Exam never displayed its workspace");
        check(editor().state.doc.toString() === "first", "Initial selection opened the wrong file");
        // Pane content cannot displace assigned widths on narrow or wide screens.
        const main = document.getElementById("main-content");
        if (main === null) throw new Error("Main layout is unavailable");
        const panes = [
            { id: "file-tree-pane", expected: 10, gutter: 4 },
            { id: "editor-pane", expected: 45, gutter: 8 },
            { id: "info-pane", expected: 45, gutter: 4 },
        ];
        for (const width of [2100, 1250, 900]) {
            main.style.width = `${width}px`;
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            for (const { id, expected, gutter } of panes) {
                const pane = document.getElementById(id);
                if (pane === null) throw new Error(`Missing pane: ${id}`);
                const percentage = 100 * (pane.getBoundingClientRect().width + gutter) / main.clientWidth;
                check(Math.abs(percentage - expected) < 0.1, `${id} proportion at ${width}: ${percentage}`);
            }
        }
        main.style.width = "";
        check(editor().state.facet(language) === riscletLanguage, "Exam .s files did not select the dialect highlighter");
        check(document.getElementById("instructions-tab-content")?.textContent?.includes("Instructions") === true, "Instructions did not render");
        check(button("instructions-tab-button").classList.contains("active") && machine?.started === false,
            "Initial load must select instructions and leave the VM unbooted");
        edit("explicit save");
        button("save-button").click();
        await until(() => saved.get("first") === "explicit save\n" && button("save-button").disabled, "Save did not flush and acknowledge editor bytes");
        blockSave = true;
        edit("in flight");
        button("save-button").click();
        await until(() => release !== undefined, "Save never reached RPC peer");
        edit("newer edit");
        release?.();
        await until(() => saved.get("first") === "in flight\n", "Blocked save did not finish");
        check(!button("save-button").disabled, "Older acknowledgement cleared newer editor edits");
        failSave = true;
        button("save-button").click();
        await until(async () => (await gradingOutput?.readText())?.includes("Save failed") === true, "RPC failure was not reported");
        check(!button("save-button").disabled, "RPC failure cleared pending work");
        button("save-button").click();
        await until(() => saved.get("first") === "newer edit\n", "Retry did not save retained bytes");
        const active = machine;
        if (active === undefined) throw new Error("VM was not prepared");
        check(!active.started, "Routine saves booted the VM");
        const bootWidth = button("vm-boot-button").getBoundingClientRect().width;
        button("vm-boot-button").click();
        await until(() => guestOutput.includes("$ "), "Initial exam guest did not reach its shell");
        check(button("vm-boot-button").getBoundingClientRect().width === bootWidth,
            "Reboot label changed the Boot VM button width");
        const filesystem = active.filesystem("workspace");
        filesystem.writeFile("doc/doc.md", "# Guest replacement");
        filesystem.writeFile("system.txt", "guest system");
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        check(decoder.decode(window.problemSet[0].workspace.readFile("system.txt")) === "system\n",
            "System views followed guest writes");
        check(document.getElementById("instructions-tab-content")?.textContent?.includes("Guest replacement") === false,
            "Instructions followed a guest system-file write");
        filesystem.mkdir("empty");
        filesystem.writeFile("extra", Uint8Array.of(0, 255, 42));
        filesystem.link("main.s", "alias");
        filesystem.symlink("broken", "absent");
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        await active.halt();
        check(button("vm-boot-button").textContent === "Boot VM", "Halt event did not restore normal boot behavior");
        const disk = active.block(0);
        const diskOriginal = (await disk.read(0n, 512)).slice();
        const diskChanged = diskOriginal.slice();
        diskChanged[0] ^= 255;
        disk.write(0n, diskChanged);
        const boot = active.boot.bind(active);
        await boot();
        const initialRequestReboot = active.requestReboot.bind(active);
        let initialRebootRequested = false;
        active.requestReboot = async () => { initialRebootRequested = true; };
        button("vm-boot-button").click();
        await until(() => initialRebootRequested, "First reboot click did not request orderly reboot");
        let checkedResetDisk = false;
        active.boot = async () => {
            check((await disk.read(0n, 512)).every((byte, index) => byte === diskOriginal[index]), "VM Reset retained disk changes");
            checkedResetDisk = true;
            await boot();
        };
        edit("buffer before reset");
        editor().focus();
        const beforeCalls = calls.filter(method => method === "SaveWorkspaceCommit").length;
        await clickRebootRecovery();
        await until(() => button("vm-boot-button").textContent === "Reboot VM" && !button("vm-boot-button").disabled, "VM recovery did not reboot");
        check(editor().state.doc.toString() === "buffer before reset", "VM Reset discarded editor text");
        check(decoder.decode(filesystem.readFile("main.s")) === "newer edit\n", "VM Reset flushed or replaced workspace bytes");
        check(!filesystem.listDirectory("").some(entry => ["empty", "extra", "alias", "broken"].includes(entry.name)),
            "VM Reset retained guest-only namespace entries");
        check(checkedResetDisk, "VM Reset did not inspect the cleared disk before boot");
        active.boot = boot;
        active.requestReboot = initialRequestReboot;
        check(decoder.decode(filesystem.readFile("doc/doc.md")) === "# Instructions\n", "VM Reset did not restore canonical system files");
        check(calls.filter(method => method === "SaveWorkspaceCommit").length === beforeCalls, "VM Reset sent a save RPC");
        await until(() => guestOutput.includes("$ "), "Recovered exam guest did not reach its shell");
        const select = (name: string): void => {
            const target = [...document.querySelectorAll<HTMLButtonElement>(".problem-button")].find(node => node.textContent === name);
            if (target === undefined) throw new Error(`Missing problem: ${name}`);
            target.click();
        };
        select("second");
        await until(() => editor().state.doc.toString() === "second", "Problem switch did not complete");
        await until(() => guestOutput.includes("$ "), "Second problem guest did not reach its shell");
        check(button("vm-tab-button").classList.contains("active") && machine === active,
            "Missing instructions must boot the default VM tab using the same image");
        check(saved.get("first") === "buffer before reset\n", "Switch lost final outgoing editor work");
        check(!active.filesystem("workspace").listFiles().includes("extra"), "Second problem received first problem namespace");
        select("first");
        await until(() => editor().state.doc.toString() === "buffer before reset", "Returning to first problem failed");
        check(active.started && button("instructions-tab-button").classList.contains("active"),
            "Returning to a same-type problem stopped the running VM or changed the selected tab");
        const restored = active.filesystem("workspace");
        check(!restored.listFiles().includes("extra") && !restored.listFiles().includes("alias"),
            "Returning to a problem restored guest-only files");
        check(!document.querySelector('.file-tree [data-path="extra"]'), "Guest extra became visible in exam file tree");
        select("plain");
        await until(() => editor().state.doc.toString() === "plain", "Non-VM problem did not open");
        check(button("vm-tab-button").hidden, "Non-VM problem exposed VM controls");
        edit("plain edit");
        button("save-button").click();
        await until(() => saved.get("plain") === "plain edit\n", "Non-VM workspace did not save");
        select("first");
        await until(() => editor().state.doc.toString() === "buffer before reset", "VM problem did not return after non-VM selection");
        const latest = machine;
        if (latest === undefined) throw new Error("VM disappeared after non-VM selection");
        check(!latest.started, "Non-VM return booted an instructed problem");
        holdAction = true;
        button("action-write-button").click();
        await until(async () => finishAction !== undefined && editor().state.doc.toString() === "action output"
            && (await gradingOutput?.readText())?.includes("streamed action output") === true,
            "Action did not stream output and files before completion");
        check(editor().state.readOnly && button("action-write-button").disabled && button("vm-tab-button").disabled,
            "Action unlocked editing or VM input before completion");
        blockSave = true;
        release = undefined;
        const beforeGuestEdit = window.problemSet[0].workspace.revision();
        latest.filesystem("workspace").writeFile("main.s", "guest edit during action\n");
        await until(() => window.problemSet[0].workspace.revision() > beforeGuestEdit,
            "Guest edit did not reach the official workspace revision");
        check(window.problemSet[0].saving.isDirty(window.problemSet[0].workspace.revision()),
            "Guest edit became clean before action completion");
        const completeAction = finishAction;
        if (completeAction === undefined) throw new Error("Action stream was not held");
        completeAction();
        await until(() => editor().state.doc.toString() === "guest edit during action" && !button("action-write-button").disabled,
            "Returned action files did not update the current editor");
        check(window.problemSet[0].saving.isDirty(window.problemSet[0].workspace.revision()),
            "Action completion acknowledged a newer guest revision");
        blockSave = false;
        releasePendingSave();
        button("save-button").click();
        await until(() => saved.get("first") === "guest edit during action\n", "Newer guest revision could not be saved");
        check(!window.problemSet[0].workspace.isStudentOwned("unofficial"), "Action widened the official student whitelist");
        check(!latest.started, "Action booted an unbooted VM");

        // Missing completion, transport failure, and malformed grade results
        // must release the action lock without acknowledging or advancing work.
        for (const failure of ["missing", "transport", "missingGrade"] as const) {
            actionFailure = failure;
            blockSave = true;
            release = undefined;
            const before = calls.filter(method => method === "RunAssignmentAction").length;
            button(failure === "missing" ? "action-write-button" : "action-grade-button").click();
            await until(() => calls.filter(method => method === "RunAssignmentAction").length > before
                && !button("action-grade-button").disabled, "Failed stream retained the action lock");
            const output = await gradingOutput?.readText() ?? "";
            check(output.includes("failed:"), "Action stream failure was not reported");
            if (failure === "missing") {
                check(output.includes("without a completion result"), "Missing completion was treated as success");
                check(window.problemSet[0].saving.isDirty(window.problemSet[0].workspace.revision()),
                    "Incomplete action acknowledged its returned file revision");
            }
            check(window.problemSet[0].currentStepNumber === 1n && !window.problemSet[0].isComplete,
                "Failed stream advanced the problem");
            blockSave = false;
            releasePendingSave();
            button("save-button").click();
            await until(() => !window.problemSet[0].saving.isDirty(window.problemSet[0].workspace.revision()),
                "Failed action's dirty work could not be retried");
        }
        actionFailure = "none";
        actionSaveStatus = CommitSaveStatus.NOT_SAVED_NOT_OWNER;
        const beforeInspection = calls.filter(method => method === "RunAssignmentAction").length;
        button("action-grade-button").click();
        await until(() => calls.filter(method => method === "RunAssignmentAction").length > beforeInspection
            && !button("action-grade-button").disabled, "Non-saved grade did not finish");
        check(window.problemSet[0].currentStepNumber === 1n
            && (await gradingOutput?.readText())?.includes("do not own this assignment") === true,
            "Non-saved passing grade advanced the problem or hid its save status");
        actionSaveStatus = CommitSaveStatus.SAVED;
        button("vm-tab-button").click();
        await until(() => guestOutput.includes("$ "), "VM tab did not boot");
        const bootsBeforeGrade = guestOutput;
        gradePassed = false;
        lockedForLms = true;
        const beforeFailedGrade = calls.filter(method => method === "RunAssignmentAction").length;
        button("action-grade-button").click();
        await until(() => calls.filter(method => method === "RunAssignmentAction").length > beforeFailedGrade && !button("action-grade-button").disabled,
            "Failed grade did not finish");
        check(latest.started && guestOutput.startsWith(bootsBeforeGrade) && editor().state.doc.toString() === "graded output",
            "Failed grade restarted the VM or advanced the step");
        const failureOutput = await gradingOutput?.readText() ?? "";
        check(failureOutput.includes("grade diagnostics"), `Grading lost its failure transcript: ${JSON.stringify(failureOutput)}`);
        check(!failureOutput.includes("live grade output"), "Grading displayed intermediate output");
        check(failureOutput.replace(/\s/g, "").endsWith("GradewasnotpostedtotheLMSbecausetheassignmentislocked"),
            `Grading lost its final server-lock notice: ${JSON.stringify(failureOutput)}`);
        const actionsBeforeWrite = calls.filter(method => method === "RunAssignmentAction").length;
        button("action-write-button").click();
        await until(() => calls.filter(method => method === "RunAssignmentAction").length > actionsBeforeWrite
            && !button("action-write-button").disabled, "Running action did not finish");
        check(latest.started && guestOutput.startsWith(bootsBeforeGrade), "Action restarted the running VM");
        gradePassed = true;
        button("action-grade-button").click();
        await until(() => editor().state.doc.toString() === "step two" && !button("action-grade-button").disabled,
            "Passing grade did not replace the step workspace");
        check(!window.problemSet[0].workspace.listFiles().includes("extra"), "Step advance restored an old namespace snapshot");
        check(!calls.some(method => ["SaveUngradedCommit", "Daycare", "SaveGradedCommit", "ListAssignments"].includes(method)),
            "Exam used a legacy execution RPC or client-side lock lookup");
        check(latest.started && button("instructions-tab-button").classList.contains("active") && machine === latest
            && guestOutput.startsWith(bootsBeforeGrade),
            "Same-type step advancement must preserve the running VM and select instructions");
        const bootsBeforeFinalGrade = guestOutput;
        button("action-grade-button").click();
        await until(() => !button("action-grade-button").disabled && window.problemSet[0].isComplete,
            "Final passing grade did not complete");
        check(latest.started && guestOutput.startsWith(bootsBeforeFinalGrade), "Final grade restarted the VM");
        const requestReboot = latest.requestReboot.bind(latest);
        let rebootRequested = false;
        latest.requestReboot = async () => { rebootRequested = true; };
        const rebootWidth = button("vm-boot-button").getBoundingClientRect().width;
        button("vm-boot-button").click();
        await until(() => rebootRequested && !button("vm-boot-button").disabled, "Stalled reboot did not expose recovery");
        check(!button("vm-boot-button").disabled && button("vm-boot-button").textContent === "Reset VM"
            && !editor().state.readOnly, "Reboot wait must keep the same button and editor usable");
        check(button("vm-boot-button").getBoundingClientRect().width === rebootWidth,
            "Reset label changed the button width");
        check(rebootWidth === bootWidth, "Boot, Reboot, and Reset labels have different widths");
        edit("save during reboot");
        button("save-button").click();
        await until(() => saved.get("first") === "save during reboot\n", "Reboot wait blocked a save");
        const beforeStalledRecovery = calls.filter(method => method === "SaveWorkspaceCommit").length;
        await clickRebootRecovery();
        await until(() => !button("vm-boot-button").disabled, "Recovery did not release the selection queue");
        check(button("vm-boot-button").textContent === "Reboot VM"
            && button("vm-boot-button").getBoundingClientRect().width === rebootWidth,
            "Recovery did not restore the reboot label at the same width");
        latest.requestReboot = requestReboot;
        check(editor().state.doc.toString() === "save during reboot" && !editor().state.readOnly, "Stalled-reboot recovery lost the editable workspace");
        check(calls.filter(method => method === "SaveWorkspaceCommit").length === beforeStalledRecovery, "Stalled-switch recovery saved or reset files");
        await until(() => guestOutput.includes("$ "), "Second-click recovery did not reach its shell");
        latest.filesystem("workspace").writeFile("normal-reboot-retained", "keep");
        guestOutput = "";
        button("vm-boot-button").click();
        await until(() => guestOutput.includes("$ ") && !button("vm-boot-button").disabled,
            "Normal reboot did not resume after second-click recovery");
        check(latest.filesystem("workspace").listFiles().includes("normal-reboot-retained"),
            "A completed reboot did not revert the button to ordinary reboot behavior");
        check(document.getElementById("vm-reset-button") === null, "Separate Reset VM button remains visible");
        check(confirmations.length === 0, `Unexpected editor conflict: ${confirmations.join("; ")}`);
        return ["page RPC saves, revisions, failure/retry, clean VM Reset, lazy boot, canonical system views, same-image reuse, actions, grade advancement, and stalled-reboot recovery"];
    } finally {
        window.fetch = nativeFetch;
        window.confirm = nativeConfirm;
        constructor.prepare = prepare;
        TerminalView.prototype.write = terminalWrite;
        if (machine?.started) await machine.halt();
    }
}
