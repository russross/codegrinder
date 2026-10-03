import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import webpack from "webpack";
import { clientCoreRules } from "../build/webpack.mjs";
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

test("Wterm renders clear screens and connected borders at fractional scaling", async () => {
    const directory = await mkdtemp(join(import.meta.dirname, "../build/test-terminal-"));
    let chrome;
    try {
        const compiler = webpack({ mode: "development", context: join(import.meta.dirname, ".."),
            entry: "./tests/terminal.ts", output: { path: directory, filename: "terminal.js", library: { name: "terminalTests", type: "window" } },
            module: { rules: [...clientCoreRules(),
                { test: /\.ts$/, use: { loader: "ts-loader", options: { transpileOnly: true } }, exclude: /node_modules/ },
                { test: /\.css$/, use: ["style-loader", "css-loader"] }] },
            resolve: { extensions: [".ts", ".js"] } });
        await new Promise((resolve, reject) => compiler.run((error, stats) => {
            compiler.close(() => {});
            if (error) reject(error);
            else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
            else resolve();
        }));
        const url = `/build/${directory.split("/").pop()}/terminal.js`;
        await runChromePage(`<!doctype html><meta charset="UTF-8"><body><script src="${url}"></script><script>
            window.terminalTests.run().then(() => fetch("/result?status=pass"),
                error => fetch("/result?status=" + encodeURIComponent(error.stack)));
        </script>`, directory, {
            timeoutMs: 30_000,
            chromeArgs: ["--remote-debugging-port=0", "--force-device-scale-factor=1.203125", "--window-size=1200,1000"],
            async response(url) {
                if (url.pathname === "/screenshot") {
                    try {
                        chrome ??= await connectChrome(directory);
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
