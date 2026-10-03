import { TerminalView } from "../terminal";

function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function paint(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

// Pixel sampling covers seams that DOM geometry alone cannot reveal.
async function screenshotPixels(): Promise<ImageData> {
    const response = await fetch("/screenshot");
    const screenshot: unknown = await response.json();
    if (!response.ok) throw new Error(`Screenshot failed: ${String(screenshot)}`);
    if (typeof screenshot !== "string") throw new Error("Invalid screenshot response");
    const image = new Image();
    image.src = `data:image/png;base64,${screenshot}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Screenshot canvas is unavailable");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height);
}

export async function run(): Promise<void> {
    await paint();
    check(Math.abs(devicePixelRatio - 1.203125) < 0.001, `fractional display scaling missing: ${devicePixelRatio}`);
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:250px";
    document.body.appendChild(host);
    let input = "";
    let resized = 0;
    const terminal = new TerminalView(host, {
        onData: text => { input += text; }, onBinary: () => {}, onResize: () => { resized += 1; },
    });
    await terminal.ready;

    // Clearing retains accessible history but pins the live screen to the top.
    for (const height of [250, 250.375, 267.875]) {
        host.style.height = `${height}px`;
        terminal.fit();
        terminal.clear();
        terminal.write("\x1b[41;31m" + "old history marker\r\n".repeat(60));
        await paint();
        await terminal.selectAll();
        terminal.write("\x1b[0m\x1b[H\x1b[2J\x1b[?25lcleared screen");
        await paint();
        const live = host.querySelector<HTMLElement>(".term-row:not(.term-scrollback-row)");
        const surface = host.querySelector<HTMLElement>(".terminal-surface");
        if (live === null || surface === null) throw new Error("Terminal viewport is missing");
        const top = host.getBoundingClientRect().top + parseFloat(getComputedStyle(host).paddingTop);
        check(Math.abs(live.getBoundingClientRect().top - top) <= 1 / devicePixelRatio,
            `clear exposed history above live screen: height=${height} live=${live.getBoundingClientRect().top} host=${top} scroll=${surface.scrollTop} row=${surface.style.getPropertyValue("--term-row-height")}`);
        const captured = await screenshotPixels();
        const rect = host.getBoundingClientRect();
        for (let y = Math.ceil(rect.top * devicePixelRatio); y < (rect.top + 30) * devicePixelRatio; y++) {
            for (let x = Math.ceil(rect.left * devicePixelRatio); x < rect.right * devicePixelRatio; x++) {
                const offset = (y * captured.width + x) * 4;
                const red = captured.data[offset];
                check(!(red > 20 && red > captured.data[offset + 1] * 2 && red > captured.data[offset + 2] * 2), "old history bled into cleared screen");
            }
        }
        surface.scrollTop = 0;
        await paint();
        check(host.querySelector(".term-scrollback-row")?.textContent?.includes("old history") === true, "history became inaccessible");
        surface.scrollTop = surface.scrollHeight;
        await paint();
        check(Math.abs(live.getBoundingClientRect().top - top) <= 1 / devicePixelRatio, "returning from history displaced live screen");
    }

    // Reset removes selection and history while accepting fresh output.
    await terminal.selectAll();
    terminal.clear(); terminal.write("fresh boot");
    await paint();
    check((await terminal.readText()).includes("fresh boot") && !(await terminal.readText()).includes("old history"), "reset retained history");
    check(terminal.selectWord(0, 1) && terminal.getSelection() === "fresh", "selection failed after reset");
    terminal.clear();
    terminal.write("\x1b[?2004h");
    const textarea = host.querySelector("textarea");
    if (textarea === null) throw new Error("Terminal input is missing");
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "one\x1b[201~two");
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    check(input === "\x1b[200~one[201~two\x1b[201~", "bracketed paste did not sanitize escape characters");
    input = "";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", ctrlKey: true, bubbles: true, cancelable: true }));
    check(input === "\x03", "Ctrl+C failed to reach guest");

    // Fractional pixel scaling must not break connected geometric borders.
    terminal.clear();
    terminal.write("\x1b[?25l\x1b[48;2;0;255;0m" + " ".repeat(20)
        + "\x1b[0m\x1b[38;2;255;255;255m\r\n┌──────────────────┐\r\n│                  │\r\n└──────────────────┘\r\n├── branch");
    await paint();
    const rows = host.querySelectorAll<HTMLElement>(".term-row");
    const surface = host.querySelector<HTMLElement>(".terminal-surface");
    if (rows.length < 5 || surface === null) throw new Error("Box fixture is missing");
    check(host.querySelectorAll(".term-box").length >= 40, "box drawing did not use geometry");
    const captured = await screenshotPixels();
    const cell = parseFloat(surface.style.getPropertyValue("--term-cell-width"));
    const first = rows[0].getBoundingClientRect();
    const left = first.left * devicePixelRatio;
    const right = left + 20 * cell * devicePixelRatio;
    const greenY = Math.floor((first.top + first.height / 2) * devicePixelRatio);
    for (let x = Math.ceil(left); x < Math.floor(right); x++) {
        const offset = (greenY * captured.width + x) * 4;
        check(captured.data[offset] < 10 && captured.data[offset + 1] > 245 && captured.data[offset + 2] < 10, "background seam");
    }
    const white = (x: number, y: number): boolean => {
        const offset = (y * captured.width + x) * 4;
        return captured.data[offset] > 150 && captured.data[offset + 1] > 150 && captured.data[offset + 2] > 150;
    };
    const start = (first.left + cell / 2) * devicePixelRatio;
    const end = start + 19 * cell * devicePixelRatio;
    const top = rows[1].getBoundingClientRect();
    const bottom = rows[3].getBoundingClientRect();
    const topY = (top.top + top.height / 2) * devicePixelRatio;
    const bottomY = (bottom.top + bottom.height / 2) * devicePixelRatio;
    for (const centerY of [topY, bottomY]) {
        for (let x = Math.ceil(start); x < Math.floor(end); x++) {
            let connected = false;
            for (let y = Math.floor(centerY) - 2; y <= Math.ceil(centerY) + 2; y++) connected ||= white(x, y);
            check(connected, "horizontal box border gap");
        }
    }
    for (const centerX of [start, end]) {
        for (let y = Math.ceil(topY); y < Math.floor(bottomY); y++) {
            let connected = false;
            for (let x = Math.floor(centerX) - 2; x <= Math.ceil(centerX) + 2; x++) connected ||= white(x, y);
            check(connected, "vertical box border gap");
        }
    }
    const corner = rows[1].querySelector<HTMLElement>(".term-box");
    if (corner === null) throw new Error("Corner geometry is missing");
    const stroke = parseFloat(getComputedStyle(corner, "::after").width) * devicePixelRatio;
    for (const [x, y] of [
        [Math.round(start), Math.floor(topY - stroke / 2) - 1],
        [Math.round(start), Math.ceil(bottomY + stroke / 2) + 1],
        [Math.floor(start - stroke / 2) - 1, Math.round(topY)],
        [Math.ceil(end + stroke / 2) + 1, Math.round(topY)],
    ]) check(!white(x, y), "corner stroke overshot its junction");

    // Static output schedules no paints; resize still updates guest dimensions.
    let frames = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { frames++; return original(callback); };
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    window.requestAnimationFrame = original;
    check(frames === 0, "idle terminal scheduled animation frames");
    const before = resized;
    host.style.width = "600px";
    await paint();
    check(resized > before, "container resize did not update dimensions");
    terminal.destroy();

    // Read-only output shares selection/rendering but never forwards guest input.
    const outputHost = document.createElement("div");
    outputHost.style.cssText = "width:600px;height:180px";
    document.body.append(outputHost);
    let outputInput = "";
    const output = new TerminalView(outputHost, { onData: text => { outputInput += text; } },
        { readOnly: true, label: "Grading output" });
    await output.ready;
    output.write("grade result\r\n");
    await paint();
    check((await output.readText()).includes("grade result"), "read-only output did not render");
    check(outputHost.querySelector("textarea")?.readOnly === true, "read-only output exposes an editable input");
    output.paste("forbidden");
    check(outputInput === "", "read-only output forwarded paste input");
    await output.selectAll();
    check(output.hasSelection(), "read-only output cannot be selected");
    output.clear();
    await paint();
    check(!output.hasSelection() && !(await output.readText()).includes("grade result"), "output reset retained selection or text");
    output.destroy();
}
