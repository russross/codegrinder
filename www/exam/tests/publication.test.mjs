import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Two deployments must preserve each cached entry's linked immutable bytes.
test("publication retains assets referenced by older entries and updates the entry last", async () => {
    const directory = await mkdtemp(join(tmpdir(), "exam-publication-"));
    const publish = fileURLToPath(new URL("../scripts/publish.py", import.meta.url));
    const run = () => spawnSync("python3", [publish], { cwd: directory, encoding: "utf8" });
    try {
        await mkdir(join(directory, "build/ui"), { recursive: true });
        await writeFile(join(directory, "index.template.html"), '{{app}}\n{{style}}\n{{favicon}}\n');
        await writeFile(join(directory, "build/ui/app-first.js"), "first application");
        await writeFile(join(directory, "style.css"), "first style");
        await writeFile(join(directory, "favicon.svg"), "icon");
        assert.equal(run().status, 0);
        const first = (await readFile(join(directory, "index.html"), "utf8")).trim().split("\n");
        const bytes = await Promise.all(first.map(path => readFile(join(directory, path), "utf8")));

        // Changed inputs create new names; the first page's complete asset set remains intact.
        await rm(join(directory, "build/ui/app-first.js"));
        await writeFile(join(directory, "build/ui/app-second.js"), "second application");
        await writeFile(join(directory, "style.css"), "second style");
        assert.equal(run().status, 0);
        const second = await readFile(join(directory, "index.html"), "utf8");
        assert.ok(second.includes("app-second.js") && !second.includes(first[1]));
        assert.deepEqual(await Promise.all(first.map(path => readFile(join(directory, path), "utf8"))), bytes);
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
