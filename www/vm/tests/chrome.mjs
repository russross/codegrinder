import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

// Real timers and MessageChannel tasks must run normally during VM tests.
// The page reports its result over HTTP instead of advancing Chrome virtual time.
export async function runChromePage(html, directory, options = {}) {
    const root = options.root ?? resolve(import.meta.dirname, "..");
    let finish;
    const result = new Promise(resolveResult => { finish = resolveResult; });
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        options.onRequest?.(url);
        if (url.pathname === "/result") {
            finish(url.searchParams.get("status")); response.end("received"); return;
        }
        if (url.pathname === "/probe.html") {
            response.setHeader("Content-Type", "text/html"); response.end(html); return;
        }
        const path = resolve(root, `.${url.pathname}`);
        if (!path.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
        try {
            const override = await options.response?.(url);
            if (override !== undefined) { response.writeHead(override.status).end(override.body); return; }
            let bytes = await readFile(path);
            if (options.transform) bytes = await options.transform(path, bytes);
            const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".svg": "image/svg+xml" };
            response.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
            response.end(bytes);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
    const flags = process.env.DISPLAY ? [] : ["--headless=new"];
    const chrome = spawn("/usr/bin/chromium-browser", [...flags, "--no-sandbox", "--disable-dev-shm-usage",
        "--no-first-run", "--no-default-browser-check",
        "--ignore-gpu-blocklist", ...(process.env.DISPLAY ? ["--use-angle=gl"] : ["--use-angle=vulkan"]),
        ...(options.chromeArgs ?? []),
        `--user-data-dir=${join(directory, "chrome")}`, `http://127.0.0.1:${server.address().port}/probe.html`],
        { stdio: ["ignore", "ignore", "pipe"] });
    const closed = new Promise(resolveClose => chrome.once("close", (code, signal) => {
        finish(`Chrome exited before reporting a result: code=${code}, signal=${signal}`);
        resolveClose();
    }));
    let errors = "";
    chrome.stderr.on("data", bytes => { errors += bytes.toString(); });
    chrome.on("error", error => finish(String(error)));
    const timeout = setTimeout(() => finish("timeout"), options.timeoutMs ?? 20_000);
    try { assert.equal(await result, "pass", errors); }
    finally {
        clearTimeout(timeout);
        if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill("SIGTERM");
        const forceClose = setTimeout(() => chrome.kill("SIGKILL"), 3000);
        await closed;
        clearTimeout(forceClose);
        server.closeAllConnections();
        await new Promise(resolveClose => server.close(resolveClose));
    }
}
