import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { snapshotRegression } from "./workspace.mjs";

const assets = JSON.parse(await readFile(new URL("../vm/build/assets.json", import.meta.url), "utf8")).riscv;
const adapter = fileURLToPath(new URL(`../${assets.runtimeUrl}`, import.meta.url));
const wasm = fileURLToPath(new URL(`../${assets.wasmUrl}`, import.meta.url));

// A supplied current build checks metadata and links without a guest image.
test("snapshots preserve complete real WASM namespaces", async () => {
    const { Riscbox } = createRequire(import.meta.url)(adapter);
    const source = ts.transpileModule(await readFile(new URL("../workspace.ts", import.meta.url), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    const { snapshotWorkspace, restoreWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const wasmBytes = await readFile(wasm);
    const runtime = await Riscbox.prepare({
        wasmUrl: "https://fixture.invalid/riscbox.wasm",
        fetch: async url => new Response(String(url).endsWith(".wasm") ? wasmBytes : Uint8Array.of(0x73, 0, 0x10, 0),
            { headers: { "Content-Type": "application/wasm" } }),
        config: { value: { version: 1, machine: "riscv64", memory_size: 32,
            bios: "firmware.bin", console: "uart", fs0: { server: "snapshot", tag: "snapshot" } },
            baseUrl: "https://fixture.invalid/" },
    });
    try { assert.equal(await snapshotRegression(runtime, snapshotWorkspace, restoreWorkspace), 1); }
    finally { await runtime.destroy(); }
});
