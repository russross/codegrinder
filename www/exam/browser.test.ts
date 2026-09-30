import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { installExamClipboard, registerClipboardTerminal } from "./clipboard";
import { clearTerminal, TerminalKind, TerminalView } from "./terminal";
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

async function paint(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export async function run(): Promise<string[]> {
    const results: string[] = [];
    const clipboardWrites: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (text: string): Promise<void> => { clipboardWrites.push(text); },
        readText: async (): Promise<string> => { throw new Error("System clipboard must never be read"); },
    } });
    const editor = new EditorView({ state: EditorState.create({ doc: "private editor text" }), parent: document.body });
    const host = element("div", document.body);
    host.style.cssText = "width:800px;height:250px;background:black";
    let input = "";
    const terminal = new TerminalView(host, TerminalKind.Vm, { onData: text => { input += text; } });
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
    const liveRow = host.querySelector<HTMLElement>(".term-row:not(.term-scrollback-row)");
    if (liveRow === null) throw new Error("live terminal row missing after clear");
    const hostTop = host.getBoundingClientRect().top + parseFloat(getComputedStyle(host).paddingTop);
    check(Math.abs(liveRow.getBoundingClientRect().top - hostTop) < 0.05,
        `clear exposed history above the live screen: ${liveRow.getBoundingClientRect().top - hostTop}px`);
    const scrollSurface = host.querySelector<HTMLElement>(".terminal-surface");
    if (scrollSurface === null) throw new Error("scrolling surface missing");
    scrollSurface.scrollTop = 0;
    await paint();
    check(host.querySelector(".term-scrollback-row")?.textContent?.includes("scrollback marker") === true,
        "clearing made retained history inaccessible");
    scrollSurface.scrollTop = scrollSurface.scrollHeight;
    await paint();
    check(Math.abs(liveRow.getBoundingClientRect().top - hostTop) < 0.05,
        "returning from history misaligned the live screen");
    let mutations = 0;
    let idleFrames = 0;
    const requestFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
        idleFrames += 1;
        return requestFrame(callback);
    };
    const observer = new MutationObserver(changes => { mutations += changes.length; });
    const grid = host.querySelector(".term-grid");
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
    check(host.querySelectorAll(".term-box").length >= 40, "box drawing did not use geometric rendering");
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
    input = "";
    terminal.paste("one\x1b[201~two");
    check(input === "\x1b[200~one[201~two\x1b[201~", "bracketed paste allowed an injected escape");
    input = "";
    terminal.clearSelection();
    host.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true }));
    check(input === "\x03", "Ctrl+C did not remain a guest interrupt");
    const gradeHost = element("div", document.body);
    gradeHost.style.cssText = "width:800px;height:100px";
    let gradeInput = "";
    const gradeTerminal = new TerminalView(gradeHost, TerminalKind.Grade, { onData: text => { gradeInput += text; } });
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
    gradeTextarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
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
        input.value = text;
        input.dispatchEvent(new InputEvent("input", { data: text, inputType: "insertText", bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    };
    const decoded = (): string => new TextDecoder().decode(workspace.readVisibleFile("src/main.s"));
    try {
        await until(() => guestOutput.includes("$ "), "guest shell never became ready");
        send("seq 1 60; printf 'finished-output\\n'");
        const liveRows = (): HTMLElement[] => Array.from(vmHost.querySelectorAll<HTMLElement>(".term-row:not(.term-scrollback-row)"));
        await until(() => liveRows().some(row => row.textContent?.trim() === "finished-output"), "guest output did not fill the screen");
        send("clear; printf 'clear-screen-marker\\n'");
        await until(() => liveRows()[0]?.textContent?.trim() === "clear-screen-marker", "guest clear did not clear the live screen");
        const checkViewportTop = (): void => {
            const expected = vmHost.getBoundingClientRect().top + parseFloat(getComputedStyle(vmHost).paddingTop);
            check(Math.abs((liveRows()[0]?.getBoundingClientRect().top ?? 0) - expected) < 0.05,
                "guest clear left scrollback visible above the live screen");
        };
        checkViewportTop();
        vmHost.querySelector("textarea")?.dispatchEvent(new KeyboardEvent("keydown", {
            key: "l", code: "KeyL", ctrlKey: true, bubbles: true, cancelable: true,
        }));
        await until(() => liveRows()[0]?.textContent?.trim().endsWith("$") === true, "guest Ctrl+L did not redraw the prompt at the top");
        checkViewportTop();
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
    terminal.destroy();
    gradeTerminal.destroy();
    editor.destroy();
    return results;
}

export async function renderFixture(): Promise<void> {
    document.body.replaceChildren();
    const host = element("div", document.body);
    host.id = "pixel-fixture";
    host.style.cssText = "width:800px;height:250px";
    const terminal = new TerminalView(host, TerminalKind.Vm);
    await terminal.ready;
    terminal.write("\x1b[?25l\x1b[48;2;0;255;0m" + " ".repeat(20)
        + "\x1b[0m\x1b[38;2;255;255;255m\r\n┌──────────────────┐\r\n│                  │\r\n└──────────────────┘\r\n├── branch\r\n│\r\n└── leaf");
    await paint();
}

async function screenshotPixels(screenshot: string): Promise<ImageData> {
    const image = new Image();
    image.src = `data:image/png;base64,${screenshot}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("screenshot context missing");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
}

export async function verifyPixels(screenshot: string): Promise<void> {
    const captured = await screenshotPixels(screenshot);
    const pixels = captured.data;
    const host = document.getElementById("pixel-fixture");
    const rows = host?.querySelectorAll<HTMLElement>(".term-row");
    if (rows === undefined || rows.length < 4) throw new Error("fixture rows missing");
    const first = rows[0].getBoundingClientRect();
    const surface = host?.querySelector<HTMLElement>(".terminal-surface");
    if (surface === null || surface === undefined) throw new Error("terminal surface missing");
    const cellWidth = parseFloat(surface.style.getPropertyValue("--term-cell-width"));
    check(Number.isFinite(cellWidth) && cellWidth > 0, "cell width missing");
    const ratio = window.devicePixelRatio;
    const left = first.left * ratio;
    const right = left + 20 * cellWidth * ratio;
    const greenY = Math.floor((first.top + first.height / 2) * ratio);
    for (let x = Math.ceil(left); x < Math.floor(right); x += 1) {
        const offset = (greenY * captured.width + x) * 4;
        check(pixels[offset] < 10 && pixels[offset + 1] > 245 && pixels[offset + 2] < 10,
            `background seam at physical column ${x}`);
    }
    const white = (x: number, y: number): boolean => {
        const offset = (y * captured.width + x) * 4;
        return pixels[offset] > 150 && pixels[offset + 1] > 150 && pixels[offset + 2] > 150;
    };
    const firstCenterX = (first.left + cellWidth / 2) * ratio;
    const lastCenterX = firstCenterX + 19 * cellWidth * ratio;
    const top = rows[1].getBoundingClientRect();
    const bottom = rows[3].getBoundingClientRect();
    const topY = (top.top + top.height / 2) * ratio;
    const bottomY = (bottom.top + bottom.height / 2) * ratio;
    for (const centerY of [topY, bottomY]) {
        for (let x = Math.ceil(firstCenterX); x < Math.floor(lastCenterX); x += 1) {
            let connected = false;
            for (let y = Math.floor(centerY) - 2; y <= Math.ceil(centerY) + 2; y += 1) connected ||= white(x, y);
            check(connected, `horizontal border gap at ${x}, ${centerY}`);
        }
    }
    for (const centerX of [firstCenterX, lastCenterX]) {
        for (let y = Math.ceil(topY); y < Math.floor(bottomY); y += 1) {
            let connected = false;
            for (let x = Math.floor(centerX) - 2; x <= Math.ceil(centerX) + 2; x += 1) connected ||= white(x, y);
            check(connected, `vertical border gap at ${centerX}, ${y}`);
        }
    }
    const corner = rows[1].querySelector<HTMLElement>(".term-box");
    if (corner === null) throw new Error("corner geometry missing");
    const stroke = parseFloat(getComputedStyle(corner, "::after").width) * ratio;
    for (const [x, y] of [
        [Math.round(firstCenterX), Math.floor(topY - stroke / 2) - 1],
        [Math.round(firstCenterX), Math.ceil(bottomY + stroke / 2) + 1],
        [Math.floor(firstCenterX - stroke / 2) - 1, Math.round(topY)],
        [Math.ceil(lastCenterX + stroke / 2) + 1, Math.round(topY)],
    ]) check(!white(x, y), `corner stroke overshot its junction at ${x}, ${y}`);
    const treeEnd = rows[6].getBoundingClientRect();
    const treeCenterY = (treeEnd.top + treeEnd.height / 2) * ratio;
    check(!white(Math.round(firstCenterX), Math.ceil(treeCenterY + stroke / 2) + 1), "tree leaf overshot its horizontal stroke");
}

export async function renderClearFixture(height: number): Promise<void> {
    document.body.replaceChildren();
    const host = element("div", document.body);
    host.id = "clear-fixture";
    host.style.cssText = `width:800px;height:${height}px`;
    const terminal = new TerminalView(host, TerminalKind.Vm);
    await terminal.ready;
    terminal.write("\x1b[41;31m" + "gggg old output\r\n".repeat(60));
    await paint();
    terminal.write("\x1b[0m\x1b[H\x1b[2J\x1b[?25lcleared screen");
    await paint();
}

export async function verifyClearPixels(screenshot: string): Promise<void> {
    const captured = await screenshotPixels(screenshot);
    const host = document.getElementById("clear-fixture");
    if (host === null) throw new Error("clear fixture missing");
    const rect = host.getBoundingClientRect();
    const ratio = window.devicePixelRatio;
    for (let y = Math.ceil(rect.top * ratio); y < Math.floor((rect.top + 30) * ratio); y += 1) {
        for (let x = Math.ceil(rect.left * ratio); x < Math.floor(rect.right * ratio); x += 1) {
            const offset = (y * captured.width + x) * 4;
            const red = captured.data[offset];
            check(!(red > 20 && red > captured.data[offset + 1] * 2 && red > captured.data[offset + 2] * 2),
                `old output remained visible at ${x}, ${y} after clear`);
        }
    }
}
