import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";

// Avoid rewriting unchanged manifests so UI builds depend on actual asset changes.
async function writeChanged(path, bytes) {
    try { if (Buffer.compare(await readFile(path), Buffer.from(bytes)) === 0) return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await writeFile(`${path}.part`, bytes);
    await rename(`${path}.part`, path);
}

async function main() {
    const version = process.argv[2];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("expected Riscbox release version");
    const payloads = await readdir("build/riscbox");
    const find = pattern => {
        const matches = payloads.filter(name => pattern.test(name));
        if (matches.length !== 1) throw new Error(`expected one release payload: ${pattern}`);
        return matches[0];
    };
    const release = `../runtime/riscbox-${version}`;
    const drive = (await readFile("build/disk-name", "utf8")).trim().split("/").pop();
    const config = {
        version: 1, machine: "riscv64", memory_size: 256,
        bios: `${release}/${find(/^fw_dynamic\.bin-.*\.gz$/)}`,
        kernel: `${release}/${find(/^linux-.*\.gz$/)}`,
        cmdline: "root=/dev/vda rw rootfstype=ext4 console=hvc0 quiet loglevel=0",
        console: "virtio", drive0: { file: `${drive}/blk.txt` },
        fs0: { server: "workspace", tag: "risclet" },
    };
    const bytes = JSON.stringify(config, null, 2) + "\n";
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const filename = `risclet-${digest}.json`;
    await writeChanged(`image/${filename}`, bytes);
    // These relative URLs are compiled into the matching immutable app bundle.
    await writeChanged("build/assets.json", JSON.stringify({
        configUrl: `vm/image/${filename}`,
        runtimeUrl: `vm/runtime/riscbox-${version}/riscbox.js`,
        wasmUrl: `vm/runtime/riscbox-${version}/riscbox.wasm`,
    }, null, 2) + "\n");
}

main().catch(error => { console.error(`VM assets: ${error.message}`); process.exitCode = 1; });
