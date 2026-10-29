import { TerminalView } from "../terminal";

function check(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
async function paint(): Promise<void> {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
async function settle(terminal: TerminalView): Promise<void> { await terminal.readText(); await paint(); }

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
function screenRect(host: HTMLElement): DOMRect {
    const screen = host.querySelector(".xterm-screen");
    if (screen === null) throw new Error("Terminal screen is missing");
    return screen.getBoundingClientRect();
}
function checkTop(host: HTMLElement): void {
    const top = host.getBoundingClientRect().top + parseFloat(getComputedStyle(host).paddingTop);
    check(Math.abs(screenRect(host).top - top) <= 1 / devicePixelRatio, "live screen is displaced from the top boundary");
}

export async function run(): Promise<void> {
    const errors: string[] = [];
    window.addEventListener("error", event => errors.push(event.message));
    window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
    await paint();
    const host = document.createElement("div");
    host.style.cssText = "width:800px;height:250px";
    document.body.appendChild(host);
    let input = "";
    let responses = "";
    let resized = 0;
    const terminal = new TerminalView(host, {
        onData: text => { input += text; }, onBinary: () => {}, onResize: () => { resized += 1; },
        onResponse: text => { responses += text; },
    });
    await terminal.ready;
    const startupCellHeight = screenRect(host).height / terminal.rows;
    check(getComputedStyle(host).backgroundColor === "rgb(0, 0, 0)", "terminal background changed");
    check(host.querySelector("canvas") !== null, "WebGL renderer is unavailable");

    // Guest queries produce protocol replies without becoming user input.
    terminal.write("\x1b[6n\x1b[14t\x1b[16t");
    await settle(terminal);
    check(input === "" && /\x1b\[\d+;\d+R/.test(responses), "cursor reply entered the user input path");
    check(responses.includes("\x1b[4;") && responses.includes("\x1b[6;"), "window size queries did not receive replies");

    // Clearing the live screen preserves history without exposing part of it above row one.
    for (const height of [250, 250.375, 267.875]) {
        host.style.height = `${height}px`;
        terminal.fit();
        terminal.clear();
        terminal.write("\x1b[41;31m" + "old history marker\r\n".repeat(60));
        await settle(terminal);
        await terminal.selectAll();
        terminal.write("\x1b[0m\x1b[H\x1b[2J\x1b[?25lcleared screen");
        await settle(terminal);
        checkTop(host);
        check((await terminal.readText()).includes("old history"), "screen clear removed scrollback");
        const captured = await screenshotPixels();
        const rect = host.getBoundingClientRect();
        for (let y = Math.ceil(rect.top * devicePixelRatio); y < (rect.top + 30) * devicePixelRatio; y++) {
            for (let x = Math.ceil(rect.left * devicePixelRatio); x < rect.right * devicePixelRatio; x++) {
                const offset = (y * captured.width + x) * 4;
                const red = captured.data[offset];
                check(!(red > 20 && red > captured.data[offset + 1] * 2 && red > captured.data[offset + 2] * 2),
                    `old history bled into cleared screen: height=${height} pixel=${x},${y}`);
            }
        }
        const surface = host.querySelector(".xterm-scrollable-element");
        if (surface === null) throw new Error("Terminal viewport is missing");
        terminal.clearSelection();
        await fetch(`/wheel?x=${rect.left + 100}&y=${rect.top + 100}&delta=-10000`);
        await paint();
        const historyPixels = await screenshotPixels();
        const screen = screenRect(host);
        const historyOffset = (Math.floor((screen.top + 2) * devicePixelRatio) * historyPixels.width
            + Math.floor((screen.left + 2) * devicePixelRatio)) * 4;
        check(historyPixels.data[historyOffset] > 200 && historyPixels.data[historyOffset + 1] < 20,
            "scrollback cannot be reached");
        await fetch(`/wheel?x=${rect.left + 100}&y=${rect.top + 100}&delta=10000`);
        await paint();
        checkTop(host);
    }

    // Reset retires unparsed text, replies, UTF-8 fragments, and terminal modes immediately.
    terminal.clear();
    document.documentElement.style.fontSize = "24px";
    terminal.fit();
    terminal.clear();
    check(Math.abs(screenRect(host).height / terminal.rows - startupCellHeight) < 1 / devicePixelRatio,
        "reset resampled the root font size");
    terminal.write("\x1b[?1049h\x1b[?2004h\x1b[41mSTALE\x1b[6n".repeat(2000));
    const previousReplies = responses;
    terminal.clear();
    await paint();
    const blank = await screenshotPixels();
    const blankRect = screenRect(host);
    for (let y = Math.ceil(blankRect.top * devicePixelRatio); y < Math.floor(blankRect.bottom * devicePixelRatio); y++) {
        for (let x = Math.ceil(blankRect.left * devicePixelRatio); x < Math.floor(blankRect.right * devicePixelRatio); x++) {
            const offset = (y * blank.width + x) * 4;
            check(blank.data[offset] === 0 && blank.data[offset + 1] === 0 && blank.data[offset + 2] === 0,
                "reset screen was not immediately pure black");
        }
    }
    terminal.write("fresh boot");
    await settle(terminal);
    check((await terminal.readText()) === "fresh boot", "reset replayed queued old output");
    check(responses === previousReplies, "retired parser forwarded stale protocol replies");
    check(!terminal.hasSelection(), "reset retained selection");
    checkTop(host);
    await terminal.selectAll();
    check(terminal.getSelection().trimEnd() === "fresh boot", `selection failed after reset: ${JSON.stringify(terminal.getSelection())}`);
    terminal.clear();
    terminal.write(Uint8Array.of(0xe2, 0x94));
    terminal.clear();
    terminal.write("clean bytes");
    check(await terminal.readText() === "clean bytes", "reset retained an incomplete UTF-8 character");
    terminal.paste("plain\ntext");
    check(input === "plain\rtext", "reset retained bracketed paste mode or lost paste normalization");
    input = "";

    // Native paste and keyboard events retain the console's input semantics.
    terminal.clear();
    terminal.write("\x1b[?2004h");
    await settle(terminal);
    const textarea = host.querySelector("textarea");
    if (textarea === null) throw new Error("Terminal input is missing");
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "one\x1b[201~two");
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
    check(input === "\x1b[200~one[201~two\x1b[201~", "bracketed paste did not sanitize escape characters");
    input = "";
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
    check(input === "\x03", "Ctrl+C failed to reach guest");
    input = "";
    terminal.write("\x1b[6n".repeat(400));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "c", code: "KeyC", keyCode: 67, ctrlKey: true, bubbles: true, cancelable: true }));
    await settle(terminal);
    check(input === "\x03", "queued protocol replies changed keyboard input routing");

    // Geometric borders stay connected at fractional display scaling.
    terminal.clear();
    terminal.write("\x1b[?25l\x1b[48;2;0;255;0m" + " ".repeat(20)
        + "\x1b[0m\x1b[38;2;255;255;255m\r\n┌──────────────────┐\r\n│                  │\r\n└──────────────────┘\r\n├── branch");
    await settle(terminal);
    const captured = await screenshotPixels();
    const rect = screenRect(host);
    const cell = rect.width / terminal.cols;
    const row = rect.height / terminal.rows;
    const left = rect.left * devicePixelRatio;
    const right = left + 20 * cell * devicePixelRatio;
    const greenY = Math.floor((rect.top + row / 2) * devicePixelRatio);
    for (let x = Math.ceil(left); x < Math.floor(right); x++) {
        const offset = (greenY * captured.width + x) * 4;
        check(captured.data[offset] < 10 && captured.data[offset + 1] > 245 && captured.data[offset + 2] < 10, "background seam");
    }
    const white = (x: number, y: number): boolean => {
        const offset = (y * captured.width + x) * 4;
        return captured.data[offset] > 150 && captured.data[offset + 1] > 150 && captured.data[offset + 2] > 150;
    };
    const start = (rect.left + cell / 2) * devicePixelRatio;
    const end = start + 19 * cell * devicePixelRatio;
    const topY = (rect.top + row * 1.5) * devicePixelRatio;
    const bottomY = (rect.top + row * 3.5) * devicePixelRatio;
    for (const centerY of [topY, bottomY]) {
        for (let x = Math.ceil(start); x < Math.floor(end); x++) {
            let connected = false;
            for (let y = Math.floor(centerY) - 2; y <= Math.ceil(centerY) + 2; y++) connected ||= white(x, y);
            check(connected, `horizontal box border gap: ${x},${centerY}`);
        }
    }
    for (const centerX of [start, end]) {
        for (let y = Math.ceil(topY); y < Math.floor(bottomY); y++) {
            let connected = false;
            for (let x = Math.floor(centerX) - 2; x <= Math.ceil(centerX) + 2; x++) connected ||= white(x, y);
            check(connected, `vertical box border gap: ${centerX},${y}`);
        }
    }
    for (const [x, y] of [
        [Math.round(start), Math.floor(topY) - 4], [Math.round(start), Math.ceil(bottomY) + 4],
        [Math.floor(start) - 4, Math.round(topY)], [Math.ceil(end) + 4, Math.round(topY)],
    ]) check(!white(x, y), "corner stroke overshot its junction");

    // Static output schedules no paints; resizing fills whole available cells.
    let frames = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => { frames++; return original(callback); };
    await new Promise<void>(resolve => setTimeout(resolve, 1000));
    window.requestAnimationFrame = original;
    check(frames === 0, "idle terminal scheduled animation frames");
    const before = resized;
    for (const [width, height] of [[600, 180], [923.375, 312.875], [400, 140]]) {
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
        await paint();
        const fitted = screenRect(host);
        checkTop(host);
        check(fitted.width <= width - 8 && width - 8 - fitted.width < cell + 15, "terminal does not fill available width");
        check(fitted.height <= height - 8 && height - 8 - fitted.height < row + 1, "terminal does not fill available height");
    }
    check(resized > before, "container resize did not update dimensions");
    host.style.display = "none";
    terminal.clear();
    terminal.write("boot in a hidden tab");
    terminal.fit();
    host.style.display = "block";
    await paint();
    checkTop(host);
    check(await terminal.readText() === "boot in a hidden tab", "hidden-tab reset lost boot output");
    terminal.destroy();

    // Repeated reboot screens release GPU contexts and retain only current output.
    const repeatHost = document.createElement("div");
    repeatHost.style.cssText = "width:600px;height:180px";
    document.body.append(repeatHost);
    const repeated = new TerminalView(repeatHost);
    await repeated.ready;
    for (let iteration = 0; iteration < 24; iteration++) {
        repeated.write("obsolete\r\n".repeat(100));
        repeated.clear();
        repeated.write(`boot ${iteration}`);
        check(await repeated.readText() === `boot ${iteration}`, "repeated reset retained obsolete output");
        check(repeatHost.querySelector("canvas") !== null, "repeated reset lost WebGL rendering");
    }
    repeated.destroy();

    await paint();
    check(errors.length === 0, `asynchronous terminal failure: ${errors.join("; ")}`);
}
