#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(fileURLToPath(import.meta.url));
const provenanceName = ".client-core-provenance.json";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const excluded = (name, path) => name === "node_modules" || name === provenanceName
    || (path === "build" && name.startsWith("test-"));

// The subtree owns source files only. Dependencies and test output remain local.
async function inventory(root, path = "") {
    const files = {};
    let entries;
    try { entries = await readdir(join(root, path), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return files; throw error; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (excluded(entry.name, path)) continue;
        const name = path === "" ? entry.name : `${path}/${entry.name}`;
        if (entry.isDirectory()) Object.assign(files, await inventory(root, name));
        else if (entry.isFile()) files[name] = digest(await readFile(join(root, name)));
        else throw new Error(`Unsupported source entry: ${join(root, name)}`);
    }
    return files;
}

async function readProvenance(destination) {
    let value;
    try { value = JSON.parse(await readFile(join(destination, provenanceName), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
    if (value.format !== 1 || typeof value.files !== "object" || value.files === null || Array.isArray(value.files)) {
        throw new Error("Invalid client-core provenance file");
    }
    for (const [path, hash] of Object.entries(value.files)) {
        if (path.startsWith("/") || path.includes("\\") || path.split("/").some(part => part === "" || part === "." || part === "..")
            || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid client-core provenance entry");
    }
    return value;
}

// Resolve existing ancestors too, so symlinked parents cannot overlap the source.
async function canonicalPath(path) {
    try { return await realpath(path); }
    catch (error) {
        if (error.code !== "ENOENT") throw error;
        return join(await canonicalPath(dirname(path)), basename(path));
    }
}

async function main() {
    const args = process.argv.slice(2);
    const check = args[0] === "--check";
    if (check) args.shift();
    if (args.length !== 1) throw new Error("Usage: node client-core/sync.mjs [--check] DESTINATION");
    const destination = resolve(args[0]);
    const canonicalSource = await canonicalPath(source);
    const canonicalDestination = await canonicalPath(destination);
    if (canonicalDestination === canonicalSource || canonicalDestination.startsWith(`${canonicalSource}/`)
        || canonicalSource.startsWith(`${canonicalDestination}/`)) {
        throw new Error("Source and destination must be separate directories");
    }
    for (const path of [destination, join(destination, provenanceName)]) {
        try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Destination cannot be a symlink: ${path}`); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const incoming = await inventory(source);
    const existing = await inventory(destination);
    const previous = await readProvenance(destination);
    const conflicts = [];
    for (const [path, hash] of Object.entries(existing)) {
        const expected = previous?.files[path] ?? incoming[path];
        if (hash !== expected) conflicts.push(path);
    }
    if (previous !== undefined) {
        for (const path of Object.keys(previous.files)) {
            if (!(path in existing)) conflicts.push(`${path} (locally deleted)`);
        }
    }
    if (conflicts.length > 0) throw new Error(`Shared source has local modifications or unmanaged files:\n${conflicts.join("\n")}`);
    const changed = Object.keys(incoming).filter(path => incoming[path] !== existing[path]);
    const removed = Object.keys(previous?.files ?? {}).filter(path => !(path in incoming));
    if (check) {
        process.stdout.write(`${changed.length} files to update; ${removed.length} files to remove\n`);
        return;
    }

    // Preflight covers every file before the first mutation. Only owned files retire.
    await mkdir(destination, { recursive: true });
    for (const path of changed) {
        await mkdir(dirname(join(destination, path)), { recursive: true });
        await copyFile(join(source, path), join(destination, path));
        const mode = (await stat(join(source, path))).mode & 0o777;
        await chmod(join(destination, path), mode);
    }
    for (const path of removed) await rm(join(destination, path));
    const tree = digest(JSON.stringify(incoming));
    await writeFile(join(destination, provenanceName), `${JSON.stringify({ format: 1,
        source: "codegrinder/www/exam/client-core", tree, files: incoming }, null, 2)}\n`);
    process.stdout.write(`Synchronized client-core ${tree}; ${changed.length} updated, ${removed.length} removed\n`);
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
