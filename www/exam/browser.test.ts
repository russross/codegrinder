import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { languageFor } from "./editor-text";
import { installExamClipboard, registerClipboardTerminal } from "./clipboard";
import { clearTerminal, GradingTerminal } from "./grading-terminal";
import { TerminalView } from "./terminal";
import { ProblemWorkspace } from "./problem-workspace";
import { loadRuntime, VmController, vmImageForProblemType } from "./vm";
export { startExamAcceptance, examAcceptanceResult, examAcceptanceNeedsRebootClick } from "./exam-acceptance.test";

function check(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message: string, timeout = 45_000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(message);
        await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
}

function element(tag: string, parent: HTMLElement): HTMLElement {
    const result = document.createElement(tag);
    parent.appendChild(result);
    return result;
}

async function paint(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function run(): Promise<string[]> {
    const results: string[] = [];
    // Supported release ordering and directives differ from generic GAS syntax.
    const assembly = "amoadd.w.rl a0, a1, (sp)\n.4byte 0xff\n.word 1\n";
    const assemblyState = EditorState.create({ doc: assembly, extensions: [languageFor("sample.s") ?? []] });
    const assemblyTree = ensureSyntaxTree(assemblyState, assembly.length, 1000);
    check(assemblyTree !== null && assemblyTree.resolveInner(1, 1).name === "keyword",
        "Dialect atomic release instruction was not highlighted");
    check(assemblyTree !== null && assemblyTree.resolveInner(assembly.indexOf(".4byte") + 1, 1).name === "meta",
        "Dialect .4byte directive was not highlighted");
    check(assemblyTree !== null && assemblyTree.resolveInner(assembly.indexOf(".word") + 1, 1).name === "meta",
        "Supported .word directive was not highlighted");
    const clipboardWrites: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string): Promise<void> => { clipboardWrites.push(text); },
        readText: async (): Promise<string> => { throw new Error("System clipboard must never be read"); },
    } });
    const editor = new EditorView({ state: EditorState.create({ doc: "private editor text" }), parent: document.body });
    const host = element("div", document.body);
    host.style.cssText = "width:800px;height:250px;background:black";
    let input = "";
    const terminal = new TerminalView(host, { onData: text => { input += text; } });
    await terminal.ready;
    terminal.fit();
    registerClipboardTerminal(terminal);
    installExamClipboard(editor);
    check(window.devicePixelRatio === 1.203125, "fractional display scaling was not configured");
    terminal.write("\x1b[48;2;255;0;0m" + Array.from({ length: 50 }, (_, i) => `old line ${i}\r\n`).join(""));
    await paint();
    check((await terminal.readText()).includes("old line"), "old output missing");
    await terminal.selectAll();
    clearTerminal(terminal);
    terminal.write("fresh boot");
    await paint();
    const freshText = await terminal.readText();
    check(!freshText.includes("old line") && freshText.includes("fresh boot"), "reset retained old output or lost new output");
    check(terminal.selectWord(0, 1) && terminal.getSelection() === "fresh", "selection broken after reset");
    terminal.clearSelection();
    terminal.write(Array.from({ length: 50 }, (_, i) => `scrollback marker ${i}\r\n`).join(""));
    await paint();
    terminal.write("\x1b[H\x1b[2Jcleared screen");
    await paint();
    const liveRow = host.querySelector<HTMLElement>(".xterm-screen");
    if (liveRow === null) throw new Error("live terminal row missing after clear");
    const hostTop = host.getBoundingClientRect().top + parseFloat(getComputedStyle(host).paddingTop);
    check(Math.abs(liveRow.getBoundingClientRect().top - hostTop) <= 1 / devicePixelRatio,
        `clear exposed history above the live screen: ${liveRow.getBoundingClientRect().top - hostTop}px`);
    const scrollSurface = host.querySelector<HTMLElement>(".terminal-surface");
    if (scrollSurface === null) throw new Error("scrolling surface missing");
    check((await terminal.readText()).includes("scrollback marker"),
        "clearing made retained history inaccessible");
    await paint();
    check(Math.abs(liveRow.getBoundingClientRect().top - hostTop) <= 1 / devicePixelRatio,
        "returning from history misaligned the live screen");
    let mutations = 0;
    let idleFrames = 0;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
        idleFrames += 1;
        return requestFrame(callback);
    };
    const observer = new MutationObserver(changes => { mutations += changes.length; });
    const grid = host.querySelector(".xterm-screen");
    if (grid === null) throw new Error("terminal grid missing");
    observer.observe(grid, { subtree: true, attributes: true, childList: true, characterData: true });
    await new Promise<void>(resolve => window.setTimeout(resolve, 1000));
    observer.disconnect();
    window.requestAnimationFrame = requestFrame;
    check(mutations === 0, `idle output changed DOM ${mutations} times`);
    check(idleFrames === 0, `idle terminal scheduled ${idleFrames} animation frames`);
    clearTerminal(terminal);
    terminal.write("\x1b[?25l\x1b[48;2;0;255;0m" + " ".repeat(20)
        + "\x1b[0m\x1b[38;2;255;255;255m\r\n┌──────────────────┐\r\n│                  │\r\n└──────────────────┘");
    await paint();
    check(host.querySelector("canvas") !== null, "box drawing did not use WebGL rendering");
    host.id = "rendering-fixture";
    results.push("screen clearing, idle rendering, and geometric box drawing at fractional pixel ratio");
    clearTerminal(terminal);
    terminal.write("fresh boot");
    await paint();
    terminal.selectWord(0, 1);
    host.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    editor.dom.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(editor.state.doc.toString().endsWith("fresh"), "terminal-to-editor private paste failed");
    input = "";
    host.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(input === "fresh", "private paste did not reach terminal");
    terminal.write("\x1b[?2004h");
    await terminal.readText();
    input = "";
    terminal.paste("one\x1b[201~two");
    check(input === "\x1b[200~one[201~two\x1b[201~", "bracketed paste allowed an injected escape");
    input = "";
    terminal.clearSelection();
    terminal.focus();
    host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
    check(input === "\x03", "Ctrl+C did not remain a guest interrupt");
    const gradeHost = element("div", document.body);
    gradeHost.style.cssText = "width:800px;height:100px";
    let gradeInput = "";
    const gradeTerminal = new GradingTerminal(gradeHost);
    await gradeTerminal.ready;
    registerClipboardTerminal(gradeTerminal);
    gradeTerminal.write("oldest history marker\r\n" + "history row ".repeat(6).concat("\r\n").repeat(5000) + "newest history marker");
    await paint();
    const history = await gradeTerminal.readText();
    check(!history.includes("oldest history marker") && history.includes("newest history marker"), "history budget did not evict old output");
    clearTerminal(gradeTerminal);
    gradeTerminal.write("grade output\r");
    gradeTerminal.write("\nsecond line\nthird line");
    await paint();
    check((await gradeTerminal.readText()).startsWith("grade output\nsecond line\nthird line"), "grade line endings changed");
    gradeTerminal.selectWord(0, 1);
    gradeHost.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    editor.dom.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(editor.state.doc.toString().endsWith("grade"), "grade-output copy did not use private clipboard");
    gradeHost.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    const gradeTextarea = gradeHost.querySelector("textarea");
    check(gradeTextarea?.readOnly === true, "grade input is editable");
    gradeTextarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    check(gradeInput === "", "grade output accepted input");
    check(clipboardWrites.every(text => text === "[redacted]" || text === ""), "clipboard contained unredacted text");
    results.push("private clipboard, bracketed paste, read-only grade output, and guest Ctrl+C");

    const workspace = new ProblemWorkspace(
        new Map([["system.txt", new TextEncoder().encode("canonical system\n")]]),
        new Map([["src/main.s", new TextEncoder().encode("original\n")]]),
    );
    const vmHost = element("div", document.body);
    vmHost.style.cssText = "width:800px;height:350px;background:black";
    const button = document.createElement("button");
    document.body.appendChild(button);
    const image = vmImageForProblemType("riscv");
    if (image === undefined) throw new Error("VM image missing");
    const Riscbox = await loadRuntime(image);
    let guestOutput = "";
    const prepare = Riscbox.prepare.bind(Riscbox);
    Riscbox.prepare = options => prepare({
        ...options,
        consoleReset: () => { guestOutput = ""; options?.consoleReset?.(); },
        consoleWrite: text => { guestOutput += text; options?.consoleWrite?.(text); },
    });
    let pendingEditorText: string | undefined;
    const vm = new VmController(vmHost, {
        flushEditor: async () => {
            if (pendingEditorText === undefined) return;
            workspace.writeStudentFile("src/main.s", new TextEncoder().encode(pendingEditorText));
            pendingEditorText = undefined;
        },
        canInteract: () => true,
        beforeReplace: () => workspace.attach(undefined),
        afterSnapshot: async () => {},
        onFilesystemChange: change => {
            workspace.attach(vm.filesystem);
            workspace.handleFilesystemChange(change);
        },
        onStateChange: () => {},
        onError: error => { throw error; },
    });
    await vm.setTarget({ image, loadFiles: async () => workspace.currentFiles() }, { workspace: "files", poweroff: "force", discardDiskChanges: true, boot: true }, () => true);
    workspace.attach(vm.filesystem);
    await until(() => vm.state === "running", "VM never started");
    editor.focus();
    vm.bootIfInactive();
    check(vmHost.contains(document.activeElement), "selecting a running VM did not focus its terminal");
    const send = (text: string): void => {
        const input = vmHost.querySelector("textarea");
        if (input === null) throw new Error("VM terminal input missing");
        input.value = text;
        input.dispatchEvent(new InputEvent("input", { data: text, inputType: "insertText", bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    };
    const decoded = (): string => new TextDecoder().decode(workspace.readVisibleFile("src/main.s"));
    try {
        await until(() => guestOutput.includes("$ "), "guest shell never became ready");
        send("id; risclet --version; make --version | head -1; test -f /usr/share/zoneinfo/America/Denver && readlink /etc/localtime; mount | grep 'on / type ext4'; printf root-retained > /tmp/exam-root-marker; printf 'image-check-done\\n'");
        await until(() => guestOutput.includes("image-check-done\r\n"), "guest image checks did not finish");
        check(guestOutput.includes("uid=1000(student)") && guestOutput.includes("risclet 0.5.5")
            && guestOutput.includes("GNU Make") && guestOutput.includes("/usr/share/zoneinfo/America/Denver")
            && guestOutput.includes("type ext4 (rw"), "guest tools, account, timezone, or writable root changed");
        send("updater_output=$(update-grind risclet latest 2>&1); updater_status=$?; printf 'updater-status=%s;output=[%s]\\nupdater-check-done\\n' \"$updater_status\" \"$updater_output\"");
        await until(() => guestOutput.includes("updater-check-done\r\n"), "guest updater stub did not finish");
        check(guestOutput.includes("updater-status=0;output=[]\r\n"), "guest updater stub failed or produced output");
        send("seq 1 60; printf 'finished-output\\n'");
        await until(() => guestOutput.includes("finished-output"), "guest output did not fill the screen");
        send("clear; printf 'clear-screen-marker\\n'");
        await until(() => guestOutput.includes("clear-screen-marker\r\n"), "guest clear did not clear the live screen");
        check((await vm.terminal.readText(false)).startsWith("clear-screen-marker"), "guest clear retained old live output");
        const checkViewportTop = (): void => {
            const expected = vmHost.getBoundingClientRect().top + parseFloat(getComputedStyle(vmHost).paddingTop);
            check(Math.abs((vmHost.querySelector(".xterm-screen")?.getBoundingClientRect().top ?? 0) - expected) <= 1 / devicePixelRatio,
                "guest clear left scrollback visible above the live screen");
        };
        checkViewportTop();
        vmHost.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", {
            key: "l", code: "KeyL", keyCode: 76, ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await new Promise<void>(resolve => setTimeout(resolve, 250));
        check((await vm.terminal.readText(false)).split("\n")[0].trimEnd().endsWith("$"), "guest Ctrl+L did not redraw the prompt at the top");
        checkViewportTop();
        send("printf 'guest-one\\n' > src/main.s");
        await until(() => decoded() === "guest-one\n", "guest write did not reach official workspace");
    } catch (error: unknown) {
        throw new Error(`${String(error)}\nGuest output:\n${guestOutput}`);
    }
    pendingEditorText = "editor-new\n";
    send("cat src/main.s > src/copy; cat src/copy > src/main.s");
    await new Promise<void>(resolve => window.setTimeout(resolve, 500));
    check(decoded() === "editor-new\n", "terminal command ran before editor flush or guest read stale bytes");
    send("ln src/main.s alias; printf 'alias-edit\\n' > alias");
    await until(() => decoded() === "alias-edit\n", "guest alias write did not update official path");
    send("mkdir moved; printf 'renamed\\n' > moved/main.s; mv src src-old; mv moved src");
    await until(() => decoded() === "renamed\n", "directory rename into official path was missed");
    check(workspace.visiblePaths().length === 2, "guest artifacts became official files");
    send("printf 'changed-system\\n' > system.txt");
    check(new TextDecoder().decode(workspace.readVisibleFile("system.txt")) === "canonical system\n", "guest system edit changed canonical files");
    guestOutput = "";
    const rebootScreen = vmHost.querySelector(".xterm");
    await vm.reboot();
    await until(() => vm.state === "running", "in-place reboot failed");
    await until(() => guestOutput.includes("$ "), "rebooted guest shell never became ready");
    check(vmHost.querySelector(".xterm") !== rebootScreen, "orderly reboot retained the terminal parser");
    send("cat /tmp/exam-root-marker; printf '\\nroot-check-done\\n'");
    await until(() => guestOutput.includes("root-check-done\r\n"), "reboot root check did not finish");
    check(guestOutput.includes("root-retained"), "orderly reboot discarded root writes");
    send("[ -f src-old/main.s ] && printf 'after-reboot\\n' > src/main.s");
    await until(() => decoded() === "after-reboot\n", "in-place reboot lost the shared tree or input stopped working");

    // Rebuild a mounted share while the shell retains its root working directory.
    const liveScreen = vmHost.querySelector(".xterm");
    await vm.setTarget({ image, loadFiles: async () => workspace.currentFiles() },
        { workspace: "files", poweroff: "preserve", discardDiskChanges: false, boot: false }, () => true);
    workspace.attach(vm.filesystem);
    check(vm.state === "running" && vmHost.querySelector(".xterm") === liveScreen, "live switch rebooted the guest");
    send("test ! -e src-old && cat src/main.s; cat /tmp/exam-root-marker; printf 'live-switch-done\\n'");
    await until(() => guestOutput.includes("live-switch-done\r\n"), "live share replacement broke the shell");
    check(guestOutput.includes("after-reboot\r\n") && guestOutput.includes("root-retained"), "live switch lost workspace or disk state");
    const beforeRecovery = vm.filesystem.readFile("src/main.s");
    await vm.reset();
    check(vmHost.querySelector(".xterm") !== rebootScreen, "forced reset retained the terminal parser");
    check(vm.filesystem.readFile("src/main.s").every((byte, index) => byte === beforeRecovery[index]), "VM Reset changed workspace bytes");
    check(!vm.filesystem.listFiles().includes("src-old/main.s"), "VM Reset retained guest files");
    check(decoded() === "after-reboot\n", "VM Reset changed official work");
    guestOutput = "";
    await until(() => guestOutput.includes("$ "), "reset guest shell never became ready");
    send("test ! -e /tmp/exam-root-marker && printf 'root-reset-confirmed\\n'");
    await until(() => guestOutput.includes("root-reset-confirmed\r\n"), "forced reset retained root writes");
    results.push("guest writes, editor flush, hard links, directory renames, ownership, orderly reboot, and workspace-preserving VM Reset");

    // Exercise the C image with the canonical problem-type compiler rules.
    const cImage = vmImageForProblemType("cinout");
    if (cImage === undefined) throw new Error("C VM image missing");
    check(cImage.configUrl !== image.configUrl && cImage.runtimeUrl === image.runtimeUrl,
        "C image must use its own disk and the shared runtime");
    check(vmImageForProblemType("cunittest") === undefined, "cunittest unexpectedly enabled");
    const makefile = await (await fetch("/cinout-Makefile")).text();
    const files = new Map([
        ["Makefile", new TextEncoder().encode(makefile)],
        ["main.c", new TextEncoder().encode('#include <stdio.h>\nint main(void) { puts("c-program-ok"); return 0; }\n')],
    ]);
    guestOutput = "";
    Riscbox.prepare = options => prepare({ ...options,
        consoleWrite: text => { guestOutput += text; options?.consoleWrite?.(text); },
    });
    try {
        await vm.setTarget({ image: cImage, loadFiles: async () => files },
            { workspace: "files", poweroff: "force", discardDiskChanges: true, boot: true }, () => true);
        await until(() => guestOutput.includes("$ "), "C guest shell never became ready");
        send("make a.out opt.out && ./opt.out && tcc main.c -o tiny.out && ./tiny.out && ./a.out && test ! -e /usr/local/bin/update-grind; status=$?; printf 'c-tools-status=%s\\nc-tools-done\\n' \"$status\"");
        await until(() => guestOutput.includes("c-tools-done\r\n"), "C compiler checks failed", 120_000);
        check(guestOutput.includes("c-tools-status=0\r\n"), "C compiler or executable failed");
        check(guestOutput.split("c-program-ok\r\n").length === 4, "C compiled programs failed");
        // Deliberately invalid code tests the runtime independently of tidy's rejection.
        send("printf '%s\\n' '#include <stdio.h>' 'int main(void) { int z; if (scanf(\"%d\", &z) != 1) return 1; return 1 / z; }' > sanitizer.c; clang -std=c18 -O0 -g -fsanitize=address,undefined -fno-omit-frame-pointer sanitizer.c -o sanitizer.out && printf '0\\n' | ./sanitizer.out; printf 'c-ubsan-done\\n'");
        await until(() => guestOutput.includes("c-ubsan-done\r\n"), "C sanitizer check did not finish", 120_000);
        const diagnostics = guestOutput.replace(/\x1b\[[0-9;]*m/g, "");
        check(diagnostics.includes("runtime error: division by zero"), "UBSan did not diagnose undefined behavior");
    } catch (error: unknown) {
        throw new Error(`${String(error)}\nC guest output:\n${guestOutput}`);
    } finally {
        await vm.destroy();
        Riscbox.prepare = prepare;
    }
    results.push("cinout image, canonical checked/optimized builds, TCC, and UBSan");
    terminal.destroy();
    gradeTerminal.destroy();
    editor.destroy();
    return results;
}
