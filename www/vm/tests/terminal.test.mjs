import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileFixture } from "./browser.mjs";
import { runChromePage } from "./chrome.mjs";

// Chrome's screenshot API measures real physical pixels, including fractional scaling.
async function connectChrome(directory) {
    const port = (await readFile(join(directory, "chrome/DevToolsActivePort"), "utf8")).split("\n")[0];
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    const pages = await response.json();
    const page = pages.find(page => page.type === "page" && page.url.endsWith("/probe.html"));
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const pending = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const callback = pending.get(message.id);
        if (callback === undefined) return;
        pending.delete(message.id);
        if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
        else callback.resolve(message.result);
    };
    return {
        close() { socket.close(); },
        command(method, params) {
            return new Promise((resolve, reject) => {
                const id = ++nextId;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        },
    };
}

for (const scale of [1, 1.203125, 2]) test(`xterm renders clear screens and connected borders at ${scale}x scaling`, async () => {
    const directory = await compileFixture("./tests/terminal.ts", "terminalTests");
    let chrome;
    try {
        const url = `/build/${directory.split("/").pop()}/fixture.js`;
        await runChromePage(`<!doctype html><meta charset="UTF-8"><body><script src="${url}"></script><script>
            window.terminalTests.run().then(() => fetch("/result?status=pass"),
                error => fetch("/result?status=" + encodeURIComponent(error.stack)));
        </script>`, directory, {
            timeoutMs: 60_000,
            chromeArgs: ["--remote-debugging-port=0", `--force-device-scale-factor=${scale}`, "--window-size=1200,1000"],
            async response(url) {
                if (url.pathname === "/screenshot" || url.pathname === "/wheel") {
                    try {
                        chrome ??= await connectChrome(directory);
                        if (url.pathname === "/wheel") {
                            await chrome.command("Input.dispatchMouseEvent", { type: "mouseWheel",
                                x: Number(url.searchParams.get("x")), y: Number(url.searchParams.get("y")),
                                deltaX: 0, deltaY: Number(url.searchParams.get("delta")) });
                            return { status: 200, body: "ok" };
                        }
                        const result = await chrome.command("Page.captureScreenshot", { format: "png" });
                        if (typeof result.data !== "string") throw new Error(`Screenshot result: ${JSON.stringify(result)}`);
                        return { status: 200, body: JSON.stringify(result.data) };
                    } catch (error) { return { status: 500, body: JSON.stringify(String(error)) }; }
                }
            },
        });
    } finally {
        chrome?.close();
        await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});
