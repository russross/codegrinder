import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { FitAddon, init, Terminal } from "ghostty-web";
import { installExamClipboard, registerClipboardTerminal } from "./clipboard";
import { clearTerminal } from "./terminal";
import { ProblemWorkspace } from "./workspace";
import { VmController, vmImageForProblemType } from "./vm";

function check(condition: boolean, message: string): void {
    if (!condition) throw new Error(message);
}

async function until(predicate: () => boolean, message: string): Promise<void> {
    const deadline = Date.now() + 45_000;
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

function terminalText(terminal: Terminal): string {
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i += 1) lines.push(buffer.getLine(i)?.translateToString() ?? "");
    return lines.join("\n");
}

export async function run(): Promise<string[]> {
    await init();
    const results: string[] = [];
    const clipboardWrites: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string): Promise<void> => { clipboardWrites.push(text); },
        readText: async (): Promise<string> => { throw new Error("System clipboard must never be read"); },
    } });
    const editor = new EditorView({ state: EditorState.create({ doc: "private editor text" }), parent: document.body });
    const host = element("div", document.body);
    host.style.cssText = "width:800px;height:250px;background:black";
    const terminal = new Terminal({ cursorBlink: false, scrollback: 1000, fontSize: 18 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();
    registerClipboardTerminal(terminal);
    installExamClipboard(editor);

    const canvas = host.querySelector("canvas");
    if (canvas === null) throw new Error("terminal canvas missing");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("terminal canvas context missing");
    check(window.devicePixelRatio === 1.203125, "fractional display scaling was not configured");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let backingSizeChanges = 0;
    let textPaints = 0;
    const fontBoxCharacters: string[] = [];
    const observer = new MutationObserver((changes: MutationRecord[]): void => {
        backingSizeChanges += changes.length;
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
    const fillText = context.fillText.bind(context);
    context.fillText = (text: string, x: number, y: number, maxWidth?: number): void => {
        textPaints += 1;
        if ("┌─┐│└┘".includes(text)) fontBoxCharacters.push(text);
        if (maxWidth === undefined) fillText(text, x, y);
        else fillText(text, x, y, maxWidth);
    };
    await new Promise<void>(resolve => window.setTimeout(resolve, 1000));
    observer.disconnect();
    check(backingSizeChanges === 0, `idle terminal resized its canvas ${backingSizeChanges} times`);
    check(textPaints === 0, `idle terminal repainted text ${textPaints} times`);
    const redPixels = (): number => {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 0) count += 1;
        }
        return count;
    };
    terminal.write("\x1b[48;2;255;0;0m" + Array.from({ length: 50 }, (_, i) => `old line ${i}\r\n`).join(""));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    check(redPixels() > 100, "old output was not painted for the clearing check");
    check(textPaints > 0, "terminal did not repaint after new output");
    terminal.selectAll();
    clearTerminal(terminal);
    terminal.write("fresh boot");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    check(redPixels() === 0, "old output remained painted after reboot clearing");
    check(!terminalText(terminal).includes("old line"), "reboot retained old screen or scrollback");
    check(terminalText(terminal).includes("fresh boot"), "fresh boot output missing");
    backingSizeChanges = 0;
    textPaints = 0;
    observer.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
    await new Promise<void>(resolve => window.setTimeout(resolve, 1000));
    observer.disconnect();
    check(backingSizeChanges === 0 && textPaints === 0, "idle terminal with visible output kept resizing or repainting text");
    clearTerminal(terminal);
    terminal.write("\x1b[?25l\x1b[48;2;0;255;0m" + " ".repeat(20)
        + "\x1b[0m\x1b[38;2;255;255;255m\r\n┌──────────────────┐\r\n│                  │\r\n└──────────────────┘");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    check(fontBoxCharacters.length === 0, `box characters fell back to fonts: ${fontBoxCharacters.join("")}`);
    const cellWidth = canvas.width / terminal.cols;
    const cellHeight = canvas.height / terminal.rows;
    check(Number.isInteger(cellWidth) && Number.isInteger(cellHeight), "cell edges do not align to physical pixels");
    const isColor = (x: number, y: number, red: number, green: number, blue: number): boolean => {
        const offset = (y * canvas.width + x) * 4;
        return pixels[offset] === red && pixels[offset + 1] === green && pixels[offset + 2] === blue;
    };
    for (let x = 0; x < 20 * cellWidth; x += 1) {
        check(isColor(x, Math.floor(cellHeight / 2), 0, 255, 0), `highlight seam at physical column ${x}`);
    }
    const thickness = Math.max(1, Math.round(window.devicePixelRatio));
    const centerX = Math.floor((cellWidth - thickness) / 2);
    const centerY = Math.floor((cellHeight - thickness) / 2);
    for (let x = centerX; x <= 19 * cellWidth + centerX; x += 1) {
        const offset = ((cellHeight + centerY) * canvas.width + x) * 4;
        check(isColor(x, cellHeight + centerY, 255, 255, 255), `horizontal box seam at physical column ${x}: ${pixels.slice(offset, offset + 4)}, cell ${cellWidth}x${cellHeight}`);
        check(isColor(x, 3 * cellHeight + centerY, 255, 255, 255), `bottom box seam at physical column ${x}`);
    }
    for (let y = cellHeight + centerY; y <= 3 * cellHeight + centerY; y += 1) {
        check(isColor(centerX, y, 255, 255, 255), `vertical box seam at physical row ${y}`);
        check(isColor(19 * cellWidth + centerX, y, 255, 255, 255), `right box seam at physical row ${y}`);
    }
    clearTerminal(terminal);
    terminal.write("fresh boot");
    terminal.select(0, terminal.buffer.active.baseY, 5);
    check(terminal.getSelection() === "fresh", "selection broken after reset");
    results.push("screen, scrollback, and selection survive terminal reset");

    canvas.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 12, clientY: host.getBoundingClientRect().top + 8 }));
    await Promise.resolve();
    check(clipboardWrites.every(text => text === "[redacted]" || text === ""), "terminal selection leaked to system clipboard");
    // Select known content and exercise native Copy through the document policy.
    terminal.select(0, terminal.buffer.active.baseY, 5);
    host.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    editor.dom.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(editor.state.doc.toString().endsWith("fresh"), "terminal-to-editor private paste failed");
    let input = "";
    terminal.onData(text => { input += text; });
    host.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(input === "fresh", "private paste did not reach terminal");
    input = "";
    terminal.clearSelection();
    host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true }));
    check(input === "\x03", "Ctrl+C did not remain a guest interrupt");
    const gradeHost = element("div", document.body);
    gradeHost.style.cssText = "width:800px;height:100px;background:white";
    const gradeTerminal = new Terminal({ disableStdin: true, cursorBlink: false, theme: { background: "#ffffff", foreground: "#454545" } });
    gradeTerminal.open(gradeHost);
    registerClipboardTerminal(gradeTerminal);
    gradeTerminal.write("grade output");
    gradeTerminal.select(0, 0, 5);
    gradeHost.dispatchEvent(new ClipboardEvent("copy", { bubbles: true, cancelable: true }));
    editor.dom.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(editor.state.doc.toString().endsWith("grade"), "grade-output copy did not use private clipboard");
    let gradeInput = "";
    gradeTerminal.onData(text => { gradeInput += text; });
    gradeHost.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true }));
    check(gradeInput === "", "grade output accepted pasted input");
    check(clipboardWrites.every(text => text === "[redacted]" || text === ""), "clipboard contained unredacted text");
    results.push("private clipboard, selection copying, paste, and guest Ctrl+C");

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
    const script = document.createElement("script");
    script.src = image.runtimeUrl.href;
    await new Promise<void>((resolve, reject): void => {
        script.onload = (): void => resolve();
        script.onerror = (): void => reject(new Error("VM runtime script failed"));
        document.body.appendChild(script);
    });
    const Riscbox = window.Riscbox;
    if (Riscbox === undefined) throw new Error("Riscbox unavailable");
    let guestOutput = "";
    window.Riscbox = {
        loadResolvedConfig: Riscbox.loadResolvedConfig.bind(Riscbox),
        instantiate: (bytes, options) => Riscbox.instantiate(bytes, {
            ...options,
            consoleReset: (): void => {
                guestOutput = "";
                options.consoleReset();
            },
            consoleWrite: (text): void => {
                guestOutput += typeof text === "string" ? text : new TextDecoder().decode(text);
                options.consoleWrite(text);
            },
        }),
    };
    let pendingEditorText: string | undefined;
    const vm = new VmController(vmHost, button, (): void => {
        if (pendingEditorText === undefined) return;
        workspace.writeStudentFile("src/main.s", new TextEncoder().encode(pendingEditorText));
        pendingEditorText = undefined;
    });
    vm.setTarget({ workspace, image });
    vm.bootIfInactive();
    await until(() => button.textContent === "Reboot VM" && !button.disabled, "VM never started");
    editor.focus();
    vm.bootIfInactive();
    check(vmHost.contains(document.activeElement), "selecting a running VM did not focus its terminal");
    const send = (text: string): void => {
        const input = vmHost.querySelector("textarea");
        if (input === null) throw new Error("VM terminal input missing");
        for (const key of text) {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        }
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    };
    const decoded = (): string => new TextDecoder().decode(workspace.readVisibleFile("src/main.s"));
    try {
        await until(() => guestOutput.includes("$ "), "guest shell never became ready");
        send("printf 'guest-one\\n' > src/main.s");
        await until(() => decoded() === "guest-one\n", "guest write did not reach official workspace");
    } catch (error: unknown) {
        throw new Error(`${String(error)}\nGuest output:\n${guestOutput}`);
    }
    pendingEditorText = "editor-new\n";
    send("cat src/main.s > src/copy; cat src/copy > src/main.s");
    await workspace.settle();
    await new Promise<void>(resolve => window.setTimeout(resolve, 500));
    check(decoded() === "editor-new\n", "terminal command ran before editor flush or guest read stale bytes");
    send("ln src/main.s alias; printf 'alias-edit\\n' > alias");
    await until(() => decoded() === "alias-edit\n", "guest alias write did not update official path");
    send("mkdir moved; printf 'renamed\\n' > moved/main.s; mv src src-old; mv moved src");
    await until(() => decoded() === "renamed\n", "directory rename into official path was missed");
    check(workspace.visiblePaths().length === 2, "guest artifacts became official files");
    send("printf 'changed-system\\n' > system.txt");
    check(new TextDecoder().decode(workspace.readVisibleFile("system.txt")) === "canonical system\n", "guest system edit changed canonical files");
    button.click();
    await until(() => button.textContent === "Reboot VM" && !button.disabled, "in-place reboot failed");
    await until(() => guestOutput.includes("$ "), "rebooted guest shell never became ready");
    send("[ -f src-old/main.s ] && printf 'after-reboot\\n' > src/main.s");
    await until(() => decoded() === "after-reboot\n", "in-place reboot lost the shared tree or input stopped working");
    vm.resetToReady();
    await vm.settle();
    await workspace.settle();
    check(decoded() === "after-reboot\n", "teardown lost student work");
    vm.bootIfInactive();
    await until(() => button.textContent === "Reboot VM" && !button.disabled, "second boot failed");
    vm.resetToReady();
    await vm.settle();
    results.push("guest writes, editor flush, hard links, directory renames, ownership, and repeated boot");
    terminal.dispose();
    gradeTerminal.dispose();
    editor.destroy();
    return results;
}
