import { chromiumExecutable } from "./tests/chromium.mjs";
import assert from "node:assert/strict";
import puppeteer from "puppeteer-core";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import webpack from "webpack";
import config from "./webpack.config.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const deployment = path.resolve(directory, "../../dist");

test("Chromium verifies exam RPC integration, terminals, clipboard, and the real VM filesystem", { timeout: 360_000 }, async () => {
    const output = await mkdtemp(path.join(tmpdir(), "exam-browser-test-"));
    const compiler = webpack({ ...config, mode: "development", entry: "./browser.test.ts", output: {
        path: output, filename: "browser.js", library: { name: "examBrowserTest", type: "window" },
    } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
        compiler.close(() => {});
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
    }));
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        if (url.pathname === "/test.html") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end('<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="/favicon.svg"></head><body><script src="/browser.js"></script></body></html>');
            return;
        }
        // Serve published entry files separately from the generated test bundle.
        const generated = url.pathname.endsWith(".browser.js") || url.pathname === "/browser.js"
            || /^\/app-[a-f0-9]+\.js$/.test(url.pathname)
            || /^\/[a-f0-9]+\.wasm$/.test(url.pathname);
        const entry = ["/index.html", "/app.js", "/style.css", "/favicon.svg"].includes(url.pathname);
        const root = url.pathname.startsWith("/vms/") ? deployment
            : entry ? path.join(deployment, "client") : generated ? output : directory;
        const filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (!filename.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
        try {
            const contents = await readFile(filename);
            const mime = filename.endsWith(".js") ? "text/javascript; charset=utf-8" : filename.endsWith(".wasm")
                ? "application/wasm" : filename.endsWith(".css") ? "text/css" : filename.endsWith(".svg")
                    ? "image/svg+xml" : "application/octet-stream";
            response.setHeader("Content-Type", mime);
            response.end(contents);
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    let browser;
    const logs = [];
    try {
        // Drive the installed browser directly; its profile belongs to this test.
        browser = await puppeteer.launch({ executablePath: await chromiumExecutable(),
            headless: !process.env.DISPLAY, userDataDir: path.join(output, "chrome"),
            protocolTimeout: 280_000, defaultViewport: null, args: [
                "--no-sandbox", "--disable-dev-shm-usage",
                "--no-first-run", "--no-default-browser-check",
                "--ignore-gpu-blocklist", ...(process.env.DISPLAY ? ["--use-angle=gl"] : ["--use-angle=vulkan"]),
                "--window-size=1200,1000",
            ],
        });
        const page = await browser.newPage();
        page.on("console", message => logs.push(message.text()));
        page.on("pageerror", error => logs.push(String(error)));
        await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1.203125 });
        const url = `http://127.0.0.1:${address.port}/test.html`;
        await page.goto(url);
        const result = await page.evaluate(() => window.examBrowserTest.run()
            .then(results => ({ results }), error => ({ error: error.stack })));
        if (result.error) {
            assert.fail(`${result.error}\n${JSON.stringify(logs, null, 2)}`);
        }
        assert.equal(result.results.length, 4);
        for (const resultName of result.results) console.log(resultName);
        await page.goto(url);
        await page.evaluate(() => window.examBrowserTest.startExamAcceptance());
        let acceptance;
        const deadline = Date.now() + 80_000;
        while (!acceptance && Date.now() < deadline) {
            const progress = await page.evaluate(() => ({ result: window.examBrowserTest.examAcceptanceResult(),
                reset: window.examBrowserTest.examAcceptanceNeedsRebootClick() }));
            acceptance = progress.result;
            if (progress.reset) {
                await page.click("#vm-boot-button");
            }
            if (!acceptance) await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(acceptance, "Exam page acceptance timed out");
        if (acceptance.error) {
            assert.fail(`${acceptance.error}\n${JSON.stringify(logs, null, 2)}`);
        }
        for (const name of acceptance.results) console.log(name);
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(output, { recursive: true, force: true });
    }
});
