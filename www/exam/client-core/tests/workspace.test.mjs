import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { snapshotRegression } from "./workspace.mjs";

const adapter = process.env.RISCBOX_CLIENT_RUNTIME
    ? resolve(process.env.RISCBOX_CLIENT_RUNTIME) : fileURLToPath(new URL("../../build/js/riscbox.js", import.meta.url));
const wasm = process.env.RISCBOX_CLIENT_WASM
    ? resolve(process.env.RISCBOX_CLIENT_WASM) : fileURLToPath(new URL("../../target/wasm32-unknown-unknown/release/riscbox_wasm.wasm", import.meta.url));

// A supplied current build checks metadata and links without a guest image.
test("shared snapshots preserve complete real WASM namespaces", {
    skip: !existsSync(adapter) || !existsSync(wasm) ? "Set RISCBOX_CLIENT_RUNTIME and RISCBOX_CLIENT_WASM to a matching build" : false,
}, async () => {
    const { Riscbox } = createRequire(import.meta.url)(adapter);
    const source = ts.transpileModule(await readFile(new URL("../workspace.ts", import.meta.url), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
    const { snapshotWorkspace, restoreWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const runtime = await Riscbox.instantiate(await readFile(wasm), {
        fetch: async () => new Response(Uint8Array.of(0x73, 0, 0x10, 0)),
    });
    try { assert.equal(await snapshotRegression(runtime, snapshotWorkspace, restoreWorkspace), 1); }
    finally { await runtime.destroy(); }
});
