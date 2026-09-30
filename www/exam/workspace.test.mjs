import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import "./vm/runtime/riscbox.js";
import { ProblemWorkspace } from "./workspace.ts";

const encode = (text) => new TextEncoder().encode(text);
const createRuntime = async () => globalThis.Riscbox.instantiate(
    await readFile(new URL("./vm/runtime/riscbox.wasm", import.meta.url)),
);

test("refresh and reset preserve work, while teardown removes unofficial files and restores system files", async () => {
    const runtime = await createRuntime();
    const starter = encode("starter\n");
    const workspace = new ProblemWorkspace(
        new Map([["Makefile", encode("old system\n")]]),
        new Map([["src/first.c", starter], ["src/second.c", starter]]),
    );
    const filesystem = await workspace.rebuildFilesystem(runtime);
    workspace.writeStudentFile("src/first.c", encode("editor work\n"));
    workspace.writeServerStudentFile("src/second.c", encode("action work\n"));
    await filesystem.writeFile("artifact", "generated\n");
    await workspace.refreshFromServer(
        new Map([["Makefile", encode("new system\n")]]),
        new Map([["src/first.c", starter], ["src/second.c", starter]]),
    );
    assert.deepEqual(workspace.studentSubmission(), {
        "src/first.c": encode("editor work\n"),
        "src/second.c": encode("action work\n"),
    });
    assert.deepEqual(await filesystem.readFile("Makefile"), encode("new system\n"));
    assert.deepEqual(await filesystem.readFile("artifact"), encode("generated\n"));
    await filesystem.rename("src", "moved");
    workspace.writeStudentFile("src/first.c", starter);
    await workspace.settle();
    assert.deepEqual(await filesystem.readFile("src/first.c"), starter);
    await filesystem.writeFile("Makefile", "temporary system edit\n");
    await runtime.destroy();
    await workspace.rebuildFilesystem();
    assert.deepEqual((await filesystem.listFiles()).sort(), ["Makefile", "src/first.c", "src/second.c"]);
    assert.deepEqual(await filesystem.readFile("Makefile"), encode("new system\n"));
    assert.deepEqual(await filesystem.readFile("src/second.c"), encode("action work\n"));
    assert.equal(workspace.isStudentOwned("artifact"), false);
    await filesystem.close();
});

test("queued host writes copy their bytes and failed writes retain canonical work for reboot recovery", async () => {
    const runtime = await createRuntime();
    const workspace = new ProblemWorkspace(new Map(), new Map([["src/main.c", encode("start")]]));
    const filesystem = await workspace.rebuildFilesystem(runtime);
    const bytes = encode("first");
    workspace.writeStudentFile("src/main.c", bytes);
    bytes.fill(0);
    workspace.writeStudentFile("src/main.c", encode("second"));
    await workspace.settle();
    assert.deepEqual(await filesystem.readFile("src/main.c"), encode("second"));
    await filesystem.remove("src/main.c");
    await filesystem.mkdir("src/main.c");
    workspace.writeStudentFile("src/main.c", encode("recover me"));
    await assert.rejects(workspace.settle());
    assert.deepEqual(workspace.studentSubmission(), { "src/main.c": encode("recover me") });
    await runtime.destroy();
    await workspace.rebuildFilesystem();
    await workspace.settle();
    assert.deepEqual(await filesystem.readFile("src/main.c"), encode("recover me"));
    await filesystem.close();
});
