import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "./node_modules/typescript/lib/typescript.js";

// Load the exam adapter and shared path rules without browser-only editor imports.
const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const shared = dataModule(await compile("./workspace.ts"));
const source = (await compile("./problem-workspace.ts")).replace('"./workspace"', JSON.stringify(shared));
const { ProblemWorkspace } = await import(dataModule(source));
const assets = JSON.parse(await readFile(new URL("./vm/build/assets.json", import.meta.url), "utf8"));
const { Riscbox } = createRequire(import.meta.url)(`./${assets.runtimeUrl}`);
const encode = text => new TextEncoder().encode(text);

async function createRuntime() {
    const wasm = await readFile(new URL(assets.wasmUrl, import.meta.url));
    return Riscbox.prepare({
        wasmUrl: "https://fixture.invalid/riscbox.wasm",
        fetch: async url => new Response(String(url).endsWith(".wasm") ? wasm : Uint8Array.of(0x73, 0, 0x10, 0),
            { headers: { "Content-Type": "application/wasm" } }),
        config: { value: { version: 1, machine: "riscv64", memory_size: 32,
            bios: "firmware.bin", console: "uart", fs0: { server: "workspace", tag: "workspace" } },
            baseUrl: "https://fixture.invalid/" },
    });
}

// Live guest artifacts and official submission eligibility are separate policies.
test("refresh preserves student work and guest extras; aliases and rename-away preserve official entries", async () => {
    const runtime = await createRuntime();
    try {
        const starter = encode("starter\n");
        const workspace = new ProblemWorkspace(new Map([["Makefile", encode("old system\n")]]),
            new Map([["src/first.c", starter], ["src/second.c", starter]]));
        const filesystem = runtime.filesystem("workspace");
        filesystem.mkdir("src");
        for (const [path, bytes] of workspace.currentFiles()) filesystem.writeFile(path, bytes);
        workspace.attach(filesystem);
        const unsubscribe = filesystem.subscribe(change => workspace.handleFilesystemChange(change));
        workspace.writeStudentFile("src/first.c", encode("editor work\n"));
        workspace.writeServerStudentFile("src/second.c", encode("action work\n"));
        filesystem.writeFile("artifact", "generated\n");
        const revision = workspace.revision();
        workspace.writeStudentFile("src/first.c", encode("editor work\n"));
        assert.equal(workspace.revision(), revision, "identical writes do not dirty submissions");
        await workspace.refreshFromServer(new Map([["Makefile", encode("new system\n")]]),
            new Map([["src/first.c", starter], ["src/second.c", starter]]));
        assert.deepEqual(workspace.studentSubmission(), {
            "src/first.c": encode("editor work\n"), "src/second.c": encode("action work\n"),
        });
        assert.deepEqual(filesystem.readFile("Makefile"), encode("new system\n"));
        filesystem.writeFile("Makefile", "guest replacement\n");
        assert.deepEqual(workspace.readFile("Makefile"), encode("new system\n"));
        filesystem.remove("Makefile");
        assert.ok(workspace.listFiles().includes("Makefile"), "canonical instructions remain visible after guest removal");
        assert.deepEqual(workspace.readFile("Makefile"), encode("new system\n"));
        assert.deepEqual(filesystem.readFile("artifact"), encode("generated\n"));
        filesystem.link("src/first.c", "alias");
        filesystem.writeFile("alias", "alias work\n");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(workspace.studentSubmission()["src/first.c"], encode("alias work\n"));
        filesystem.rename("src", "moved");
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.deepEqual(workspace.studentSubmission()["src/first.c"], encode("alias work\n"));
        workspace.writeStudentFile("src/first.c", starter);
        assert.deepEqual(filesystem.readFile("src/first.c"), starter);
        assert.equal(workspace.isStudentOwned("artifact"), false);
        unsubscribe();
    } finally { await runtime.destroy(); }
});

test("failed writes retain the previous submission and originals remain independent of guest bytes", async () => {
    const runtime = await createRuntime();
    try {
        const workspace = new ProblemWorkspace(new Map(), new Map([["main.c", encode("start")]]));
        const filesystem = runtime.filesystem("workspace");
        filesystem.writeFile("main.c", "start");
        workspace.attach(filesystem);
        filesystem.subscribe(change => workspace.handleFilesystemChange(change));
        const original = workspace.originalFiles();
        original.get("main.c").fill(0);
        assert.deepEqual(workspace.originalFiles().get("main.c"), encode("start"));
        filesystem.remove("main.c");
        filesystem.mkdir("main.c");
        assert.throws(() => workspace.writeStudentFile("main.c", encode("unsaved")));
        assert.deepEqual(workspace.studentSubmission(), { "main.c": encode("start") });
        assert.equal(workspace.revision(), 0);
        assert.throws(() => workspace.writeServerStudentFile("main.c", encode("returned action")));
        assert.deepEqual(workspace.studentSubmission(), { "main.c": encode("returned action") });
    } finally { await runtime.destroy(); }
});

test("non-VM adapter copies bytes, enforces ownership, and reports editor and server origins", () => {
    const workspace = new ProblemWorkspace(new Map([["system", encode("system")]]), new Map([["student", encode("start")]]));
    const origins = [];
    workspace.onFilesystemChange = change => origins.push(change.origin);
    const bytes = encode("edited");
    workspace.writeStudentFile("student", bytes);
    bytes.fill(0);
    assert.deepEqual(workspace.readFile("student"), encode("edited"));
    workspace.writeServerStudentFile("student", encode("server"));
    assert.deepEqual(origins, [1n, 2n]);
    assert.throws(() => workspace.writeFile("system", "changed"));
});
