import { EditorSession } from "../editor-session.ts";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { VmSession } from "../vm-session.ts";
import { renderFileTree } from "../workspace-view.ts";
import { language } from "@codemirror/language";
import { riscletLanguage } from "../risclet.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
function check(condition, message) { if (!condition) throw new Error(message); }
async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }
async function wait(condition, message) {
    for (let i = 0; i < 100; i++) { if (condition()) return; await tick(); }
    throw new Error(message);
}

// This boundary model controls halt completion and injected failures explicitly.
function filesystem(started = () => false) {
    const files = new Map();
    const subscribers = new Set();
    return {
        files, failWrite: false,
        readFile(path) { if (!files.has(path)) throw new Error("Missing file"); return files.get(path).slice(); },
        writeFile(path, bytes, origin = 0n) {
            if (this.failWrite) throw new Error("write failed");
            files.set(path, typeof bytes === "string" ? encoder.encode(bytes) : bytes.slice());
            this.notify({ kind: "write", path, aliases: [], source: "host", origin });
        },
        notify(change) { for (const callback of subscribers) callback(change); },
        subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
        listFiles() { return [...files.keys()]; },
        reset() { check(!started(), "namespace reset requires halt"); files.clear(); },
        clear() { files.clear(); },
        stat(path) {
            return { kind: path === "" ? "directory" : "file", inode: BigInt(path === "" ? 1 : [...files.keys()].indexOf(path) + 2),
                mode: 0o644, uid: 0, gid: 0, atime: { seconds: 0n, nanoseconds: 0 }, mtime: { seconds: 0n, nanoseconds: 0 } };
        },
        listDirectory() { return [...files.keys()].map(name => ({ name })); },
        setAttributes() {},
    };
}

async function editorTests() {
    const host = document.createElement("div");
    document.body.append(host);
    const fs = filesystem();
    fs.writeFile("a.s", "original\n");
    let prompts = 0;
    let discard = false;
    const synced = [];
    const errors = [];
    const session = new EditorSession(host, { canEdit: path => path !== "system.s", onChange: () => {},
        onSynced: trigger => synced.push(trigger), onError: error => errors.push(error),
        confirmDiscard: () => { prompts++; return discard; } });
    fs.subscribe(change => session.handleChange(change));
    fs.writeFile("indent.c", "int main() {");
    session.open(fs, "indent.c");
    session.view.dispatch({ selection: { anchor: session.view.state.doc.length } });
    insertNewlineAndIndent(session.view);
    check(session.view.state.doc.toString() === "int main() {\n    ", "C autoindent must insert four spaces");
    await session.flush();
    session.open(fs, "a.s");
    check(session.view.state.facet(language) === riscletLanguage, "assembly files use the teaching dialect by default");
    const edit = text => session.view.dispatch({ changes: { from: 0, to: session.view.state.doc.length, insert: text } });
    edit("buffered");
    check(decoder.decode(fs.readFile("a.s")) === "original\n", "edits remain buffered");
    fs.failWrite = true;
    await session.flush().then(() => { throw new Error("write should fail"); }, () => {});
    check(session.dirty && session.view.state.doc.toString() === "buffered", "failed write preserves dirty text");
    fs.failWrite = false;
    await session.flush();
    check(!session.dirty && decoder.decode(fs.readFile("a.s")) === "buffered\n", "retry acknowledges only a successful write");

    edit("keep");
    fs.writeFile("a.s", "external\n");
    fs.writeFile("a.s", "external again\n");
    check(prompts === 1 && session.dirty, "retained conflict prompts once");
    await session.flush();
    edit("discard");
    discard = true;
    fs.writeFile("a.s", "accepted\n");
    check(!session.dirty && session.view.state.doc.toString() === "accepted", "accepted conflict replaces dirty buffer");
    edit("renamed buffer");
    fs.files.set("renamed.s", fs.files.get("a.s"));
    fs.files.delete("a.s");
    fs.notify({ kind: "rename", oldPath: "a.s", path: "renamed.s", aliases: [], source: "guest", origin: 0n });
    await session.flush();
    check(session.path === "renamed.s" && decoder.decode(fs.readFile("renamed.s")) === "renamed buffer\n", "dirty rename follows the new path");

    fs.writeFile("system.s", "protected\n");
    session.open(fs, "system.s");
    check(session.readOnly, "application access policy controls editability");
    fs.writeFile("binary", Uint8Array.of(0));
    session.open(fs, "binary");
    check(session.readOnly, "binary files remain read-only");
    session.open(fs, "renamed.s");
    edit("blurred");
    session.view.contentDOM.dispatchEvent(new FocusEvent("blur"));
    await wait(() => !session.dirty, "blur did not flush");
    check(synced.includes("blur"), "blur notifies application persistence");

    // Recovery can restore access before a blur's queued write gets its turn.
    edit("recovery buffer");
    session.setReadOnly(true);
    const recoveryBlur = session.flush("blur");
    session.setReadOnly(false);
    await recoveryBlur;
    check(session.dirty && decoder.decode(fs.readFile("renamed.s")) === "blurred\n",
        "read-only blur cannot flush after recovery restores editability");
    await session.flush();

    const tree = document.createElement("div");
    renderFileTree(tree, ["system/z.s", "student/a.s"], { selectedPath: "student/a.s",
        priority: path => path.startsWith("student/") ? 0 : 1, onSelect: () => {} });
    check(tree.querySelector("li.file").dataset.path === "student/a.s", "editable subtree priority propagates");
    check(tree.querySelector("button") !== null, "file selection has native keyboard controls");

    // Ownership takes precedence, then files precede alphabetically ordered folders at every level.
    const paths = ["system/z.s", "student/nested/a.s", "student/z.s", "student/a.txt", "z.s", "a.txt", "system/a.s"];
    renderFileTree(tree, paths, { selectedPath: "student/z.s",
        priority: path => path.startsWith("student/") ? 0 : 1, onSelect: () => {} });
    const displayed = [...tree.querySelectorAll("li.file")].map(item => item.dataset.path);
    check(JSON.stringify(displayed) === JSON.stringify([
        "student/a.txt", "student/z.s", "student/nested/a.s", "a.txt", "z.s", "system/a.s", "system/z.s",
    ]), "tree preserves ownership priority and sorts files before folders at root and nested levels");
    check(tree.querySelector("li.selected").dataset.path === "student/z.s", "tree preserves selected file");
    session.destroy();
    host.remove();
    check(errors.length === 0, "unexpected editor error");
}

async function vmTests() {
    const host = document.createElement("div");
    host.style.cssText = "width:600px;height:200px";
    document.body.append(host);
    const machines = [];
    const saves = [];
    const errors = [];
    let rejectSave = false;
    let releaseFlush;
    let delayedFlush = false;
    let failPreparation = false;
    const constructor = {
        async prepare(callbacks) {
            if (failPreparation) throw new Error("WASM request failed with status 503");
            const machine = { started: false, boots: 0, shutdowns: 0, halted: 0, destroyed: false, discards: 0, coldResets: 0, input: [], callbacks,
                filesystem() { return this.fs; },
                block() { return { reset: () => { this.discards++; } }; },
                async boot() { this.started = true; this.boots++; callbacks.onVmStarted(); },
                async halt() { this.started = false; this.halted++; callbacks.onVmHalted("forced"); },
                async requestShutdown() { this.shutdowns++; }, async requestReboot() {},
                async coldReset() { this.coldResets++; }, async destroy() { this.destroyed = true; },
                consoleResize() { check(this.started, "console resize requires a running VM"); },
                consoleInput(bytes) { this.input.push(...bytes); return bytes.length; },
            };
            machine.fs = filesystem(() => machine.started);
            machines.push(machine);
            return machine;
        },
    };
    const image = { configUrl: "https://image.invalid/a.cfg", runtimeUrl: "https://image.invalid/riscbox.js",
        wasmUrl: "data:application/wasm;base64,AA==", memoryMiB: 64, shareName: "default" };
    const target = name => ({ image, loadFiles: async () => new Map([["file", encoder.encode(name)]]) });
    const retained = { workspace: "snapshot", poweroff: "orderly", discardDiskChanges: false, boot: true };
    const clean = { workspace: "files", poweroff: "force", discardDiskChanges: true, boot: true };
    const first = target("first");
    const second = target("second");
    const session = new VmSession(host, { loadRuntime: async () => constructor,
        flushEditor: () => delayedFlush ? new Promise(resolve => { releaseFlush = resolve; }) : Promise.resolve(),
        canInteract: () => true, beforeReplace: () => {}, onFilesystemChange: () => {}, onStateChange: () => {},
        afterSnapshot: async (target, snapshot) => {
            saves.push([target, decoder.decode(snapshot.entries.find(entry => entry.path === "file").bytes)]);
            if (rejectSave) throw new Error("save failed");
        }, onError: error => errors.push(error),
    });
    await session.setTarget(first, retained, () => true);
    const machine = machines[0];
    delayedFlush = true;
    session.terminal.paste("obsolete");
    await wait(() => releaseFlush !== undefined, "input did not wait for editor flush");
    const switching = session.setTarget(second, retained, () => true);
    await wait(() => machine.shutdowns === 1, "same-image switch did not request shutdown");
    check(machine.boots === 1 && first.snapshot === undefined, "shutdown request alone cannot snapshot or boot");
    machine.fs.writeFile("file", "shutdown tail");
    machine.started = false;
    machine.callbacks.onVmHalted("shutdown");
    await switching;
    releaseFlush();
    delayedFlush = false;
    await tick();
    check(machine.input.length === 0, "retired editor flush cannot inject input into new workspace");
    check(saves[0][1] === "shutdown tail" && machine.discards === 0, "final guest writes save before namespace replacement and disks retain state");

    rejectSave = true;
    const failed = session.setTarget(first, retained, () => true);
    await wait(() => machine.shutdowns === 2, "second shutdown missing");
    machine.started = false;
    machine.callbacks.onVmHalted("shutdown");
    await failed.then(() => { throw new Error("save failure must reject switch"); }, () => {});
    check(session.target === second && decoder.decode(machine.fs.readFile("file")) === "second", "failed server save retains outgoing namespace");
    rejectSave = false;
    await session.setTarget(first, clean, () => true);
    check(first.snapshot === undefined && machine.discards === 1 && machine.coldResets === 1,
        "Reset discards snapshot and disk changes");

    // Live replacement keeps power, disk writes, and terminal state intact.
    const liveScreen = host.querySelector(".xterm");
    const liveHalts = machine.halted;
    machine.fs.writeFile("extra", "guest-only");
    await session.setTarget(second, { workspace: "files", poweroff: "preserve", discardDiskChanges: false, boot: false }, () => true);
    check(machine.started && session.state === "running" && machine.discards === 1 && machine.coldResets === 1
        && machine.halted === liveHalts && host.querySelector(".xterm") === liveScreen,
        "live replacement changed power, disk, or terminal state");
    check(!machine.fs.files.has("extra") && decoder.decode(machine.fs.readFile("file")) === "second",
        "live replacement did not rebuild files");

    const other = { ...target("other"), image: { ...image, configUrl: "https://image.invalid/b.cfg" } };
    await session.setTarget(other, retained, () => true);
    check(machine.destroyed && machines.length === 2 && machine.shutdowns === 2,
        "different-image switch forces halt and creates a complete new VM");
    check(second.snapshot !== undefined && decoder.decode(session.filesystem.readFile("file")) === "other",
        "snapshots outlive old VM handles");
    machine.callbacks.onVmStarted();
    check(session.runtime === machines[1], "retired runtime callbacks cannot replace new VM");
    const current = machines[1];
    const lazy = { ...clean, boot: false };
    const cleanTarget = { ...target("clean"), image: other.image };
    await session.setTarget(cleanTarget, lazy, () => true);
    check(session.runtime === current && !current.started && current.boots === 1,
        "same-image preparation reuses a halted VM without booting");
    check(current.discards === 1 && current.coldResets === 1 && session.state === "ready",
        "lazy preparation clears disk overlays and leaves the session bootable");
    current.fs.writeFile("extra", "discard me");
    cleanTarget.loadFiles = async () => new Map([["file", encoder.encode("current work")]]);
    await session.reset();
    check(current.started && current.boots === 2 && current.discards === 2 && !current.fs.files.has("extra"),
        "reset boots with a clean disk and namespace");
    check(decoder.decode(current.fs.readFile("file")) === "current work", "reset loads current host files");
    await session.reboot();
    check(session.state === "stopping", "reboot waits visibly for the runtime callback");
    session.terminal.paste("blocked");
    await tick();
    check(current.input.length === 0, "reboot wait blocks terminal input");
    const screen = host.querySelector(".xterm");
    session.terminal.write("history retained across reboot");
    await session.terminal.readText();
    current.callbacks.consoleReset();
    current.callbacks.onVmReset("guest-reboot");
    check(session.state === "running", "restart notification releases the reboot wait");
    check(host.querySelector(".xterm") !== screen && !(await session.terminal.readText()).includes("history retained"),
        "orderly reboot retained old output");
    await session.reset();
    check(host.querySelector(".xterm") !== screen && !(await session.terminal.readText()).includes("history retained"),
        "forced reset retained the parser or old output");
    await session.destroy();

    // A transient preparation failure leaves a complete target available for Boot retry.
    const retry = new VmSession(host, { loadRuntime: async () => constructor,
        flushEditor: async () => {}, canInteract: () => true, beforeReplace: () => {},
        afterSnapshot: async () => {}, onFilesystemChange: () => {}, onStateChange: () => {},
        onError: error => errors.push(error) });
    failPreparation = true;
    await retry.setTarget(first, lazy, () => true).then(() => {
        throw new Error("preparation should fail");
    }, () => {});
    check(retry.state === "failed" && retry.runtime === undefined, "failed preparation retained a partial VM");
    failPreparation = false;
    await retry.boot();
    check(retry.state === "running" && decoder.decode(retry.filesystem.readFile("file")) === "first",
        "Boot retry lost the target workspace");
    await retry.destroy();
    host.remove();
    check(errors.length === 2 && errors[0].message === "save failed" && errors[1].message.includes("503"), "unexpected VM error");
}

export async function run() { await editorTests(); await vmTests(); }
