import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import webpack from "webpack";
import config from "./webpack.config.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));

test("Chromium verifies exam RPC integration, terminals, clipboard, and the real VM filesystem", { timeout: 360_000 }, async () => {
    const output = await mkdtemp(path.join(tmpdir(), "exam-browser-test-"));
    const compiler = webpack({ ...config, mode: "development", entry: "./browser.test.ts", output: {
        path: output, filename: "browser.js", library: "examBrowserTest", libraryTarget: "window",
    } });
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
        compiler.close(() => {});
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
    }));
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, "http://localhost");
        if (url.pathname === "/cinout-Makefile") {
            response.end(await readFile(path.resolve(directory, "../../problemtypes/types/cinout/files/Makefile")));
            return;
        }
        if (url.pathname === "/test.html") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end('<!doctype html><html><head><meta charset="UTF-8"><link rel="icon" href="/favicon.svg"></head><body><script src="/browser.js"></script></body></html>');
            return;
        }
        const root = url.pathname.endsWith(".browser.js") || url.pathname === "/browser.js"
            || /^\/app-[a-f0-9]+\.js$/.test(url.pathname)
            || /^\/[a-f0-9]+\.wasm$/.test(url.pathname) ? output : directory;
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
    const driver = spawn("chromedriver", ["--port=9516"], { stdio: ["ignore", "pipe", "pipe"] });
    const driverClosed = new Promise(resolve => driver.once("close", resolve));
    let driverOutput = "";
    driver.stdout.on("data", data => { driverOutput += data.toString(); });
    driver.stderr.on("data", data => { driverOutput += data.toString(); });
    let driverError;
    driver.on("error", error => { driverError = error; });
    const call = async (method, pathname, body) => {
        const response = await fetch(`http://127.0.0.1:9516${pathname}`, {
            method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result));
        return result.value;
    };
    let session;
    try {
        for (let i = 0; i < 100; i += 1) {
            if (driverError) throw driverError;
            try { await call("GET", "/status"); break; } catch {
                if (i === 99) throw new Error(driverOutput);
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        const created = await call("POST", "/session", { capabilities: { alwaysMatch: {
            browserName: "chrome",
            "goog:chromeOptions": { binary: "/usr/bin/chromium-browser", args: [
                ...(process.env.DISPLAY ? [] : ["--headless=new"]), "--no-sandbox", "--disable-dev-shm-usage",
                "--no-first-run", "--no-default-browser-check",
                "--ignore-gpu-blocklist", ...(process.env.DISPLAY ? ["--use-angle=gl"] : ["--use-angle=vulkan"]),
                "--window-size=1200,1000", `--user-data-dir=${path.join(output, "chrome")}`,
            ] },
            "goog:loggingPrefs": { browser: "ALL" },
        } } });
        session = created.sessionId;
        await call("POST", `/session/${session}/goog/cdp/execute`, {
            cmd: "Emulation.setDeviceMetricsOverride",
            params: { width: 1200, height: 1000, deviceScaleFactor: 1.203125, mobile: false },
        });
        await call("POST", `/session/${session}/timeouts`, { script: 280_000 });
        await call("POST", `/session/${session}/url`, { url: `http://127.0.0.1:${address.port}/test.html` });
        const result = await call("POST", `/session/${session}/execute/async`, {
            script: 'const done = arguments[arguments.length - 1]; window.examBrowserTest.run().then(results => done({results}), error => done({error: error.stack}));',
            args: [],
        });
        if (result.error) {
            const logs = await call("POST", `/session/${session}/log`, { type: "browser" });
            assert.fail(`${result.error}\n${JSON.stringify(logs, null, 2)}`);
        }
        assert.equal(result.results.length, 4);
        for (const resultName of result.results) console.log(resultName);
        await call("POST", `/session/${session}/url`, { url: `http://127.0.0.1:${address.port}/test.html` });
        await call("POST", `/session/${session}/execute/sync`, {
            script: 'window.examBrowserTest.startExamAcceptance();', args: [],
        });
        let acceptance;
        const deadline = Date.now() + 80_000;
        while (!acceptance && Date.now() < deadline) {
            const progress = await call("POST", `/session/${session}/execute/sync`, {
                script: 'return { result: window.examBrowserTest.examAcceptanceResult(), reset: window.examBrowserTest.examAcceptanceNeedsRebootClick() };', args: [],
            });
            acceptance = progress.result;
            if (progress.reset) {
                const element = await call("POST", `/session/${session}/element`, { using: "css selector", value: "#vm-boot-button" });
                await call("POST", `/session/${session}/element/${element["element-6066-11e4-a52e-4f735466cecf"]}/click`, {});
            }
            if (!acceptance) await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(acceptance, "Exam page acceptance timed out");
        if (acceptance.error) {
            const logs = await call("POST", `/session/${session}/log`, { type: "browser" });
            assert.fail(`${acceptance.error}\n${JSON.stringify(logs, null, 2)}`);
        }
        for (const name of acceptance.results) console.log(name);
    } finally {
        if (session) await call("DELETE", `/session/${session}`).catch(() => {});
        driver.kill();
        await driverClosed;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await rm(output, { recursive: true, force: true });
    }
});
