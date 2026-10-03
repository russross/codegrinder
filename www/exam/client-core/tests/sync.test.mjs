import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("subtree sync previews updates and refuses local changes before writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "client-core-sync-"));
    const incoming = join(directory, "incoming");
    const destination = join(directory, "vendored");
    const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    try {
        const script = fileURLToPath(new URL("../sync.mjs", import.meta.url));
        assert.equal(run(script, incoming).status, 0);
        const copiedScript = join(incoming, "sync.mjs");
        const alias = join(directory, "alias");
        await symlink(incoming, alias, "dir");
        assert.match(run(copiedScript, join(alias, "nested")).stderr, /separate directories/);
        assert.equal(run(copiedScript, destination).status, 0);
        const original = await readFile(join(destination, "terminal.css"), "utf8");
        await writeFile(join(incoming, "terminal.css"), `${original}\n/* updated */\n`);
        await rm(join(incoming, "editor-text.ts"));
        assert.equal(run(copiedScript, "--check", destination).status, 0);
        assert.equal(await readFile(join(destination, "terminal.css"), "utf8"), original);
        assert.equal(run(copiedScript, destination).status, 0);
        await assert.rejects(readFile(join(destination, "editor-text.ts")), { code: "ENOENT" });

        const provenance = await readFile(join(destination, ".client-core-provenance.json"), "utf8");
        await writeFile(join(destination, "terminal.css"), "local change");
        const rejected = run(copiedScript, destination);
        assert.equal(rejected.status, 1);
        assert.match(rejected.stderr, /local modifications/);
        assert.equal(await readFile(join(destination, "terminal.css"), "utf8"), "local change");
        assert.equal(await readFile(join(destination, ".client-core-provenance.json"), "utf8"), provenance);
        await writeFile(join(destination, "terminal.css"), await readFile(join(incoming, "terminal.css")));
        await rm(join(destination, "workspace.ts"));
        assert.match(run(copiedScript, destination).stderr, /locally deleted/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
