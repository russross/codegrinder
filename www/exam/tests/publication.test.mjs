import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Direct page URLs stay stable while fetched assets retain immutable names.
test("publication updates direct assets without rewriting unchanged HTML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exam-publication-"));
    const publish = fileURLToPath(new URL("../scripts/publish.py", import.meta.url));
    const run = () => spawnSync("python3", [publish], { cwd: directory, encoding: "utf8" });
    try {
        await mkdir(join(directory, "build/ui"), { recursive: true });
        await writeFile(join(directory, "index.template.html"), '{{app}}\n{{style}}\n{{favicon}}\n');
        await mkdir(join(directory, "vm/build"), { recursive: true });
        await writeFile(join(directory, "vm/build/assets.json"), "{}");
        await writeFile(join(directory, "build/ui/app.js"), "first application");
        await writeFile(join(directory, "build/ui/app-chunkhash.js"), "lazy chunk");
        await writeFile(join(directory, "style.css"), "first style");
        await writeFile(join(directory, "favicon.svg"), "icon");
        assert.equal(run().status, 0);
        const first = (await readFile(join(directory, "index.html"), "utf8")).trim().split("\n");
        const timestamp = (await stat(join(directory, "index.html"), { bigint: true })).mtimeNs;
        assert.deepEqual(first, ["dist/app.js", "dist/style.css", "dist/favicon.svg"]);

        // Refreshing the same entry URLs retrieves the newly published direct dependencies.
        await writeFile(join(directory, "build/ui/app.js"), "second application");
        await writeFile(join(directory, "style.css"), "second style");
        assert.equal(run().status, 0);
        const second = await readFile(join(directory, "index.html"), "utf8");
        assert.equal(second.trim(), first.join("\n"));
        assert.equal((await stat(join(directory, "index.html"), { bigint: true })).mtimeNs, timestamp);
        assert.equal(await readFile(join(directory, first[0]), "utf8"), "second application");
        assert.equal(await readFile(join(directory, first[1]), "utf8"), "second style");
        assert.equal(await readFile(join(directory, "dist/app-chunkhash.js"), "utf8"), "lazy chunk");
        const before = (await readdir(join(directory, "dist"))).sort();
        assert.equal(run().status, 0);
        assert.deepEqual((await readdir(join(directory, "dist"))).sort(), before);

        // Failed assembly cannot replace a working entry page with partial references.
        await writeFile(join(directory, "index.template.html"), "{{missing}}");
        const failure = run();
        assert.notEqual(failure.status, 0);
        assert.match(failure.stderr, /unresolved entry-page placeholder/);
        assert.equal(await readFile(join(directory, "index.html"), "utf8"), second);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
