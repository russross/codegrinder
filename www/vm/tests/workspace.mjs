// Real WASM namespaces exercise copied content, literal links, and metadata.
export async function snapshotRegression(runtime, snapshotWorkspace, restoreWorkspace) {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const filesystem = runtime.filesystem("snapshot");
    filesystem.mkdir("empty");
    filesystem.mkdir("nested");
    filesystem.writeFile("nested/executable", Uint8Array.of(0, 255, 42));
    filesystem.link("nested/executable", "alias");
    filesystem.symlink("broken", "missing/target");
    filesystem.symlink("directory-link", "nested");
    const attributes = { mode: 0o751, uid: 123, gid: 456,
        atime: { seconds: 789n, nanoseconds: 123456789 }, mtime: { seconds: 900n, nanoseconds: 987654321 } };
    filesystem.setAttributes("nested/executable", attributes);
    filesystem.setAttributes("nested", { ...attributes, mode: 0o750 });

    // Captured bytes survive later writes, deletion, and namespace replacement.
    const snapshot = snapshotWorkspace(filesystem);
    filesystem.writeFile("alias", "changed after capture");
    filesystem.remove("broken");
    filesystem.writeFile("discarded", "later addition");
    restoreWorkspace(filesystem, snapshot);
    const content = filesystem.readFile("alias");
    check(content.length === 3 && content[0] === 0 && content[1] === 255 && content[2] === 42, "snapshot copies binary bytes");
    check(filesystem.stat("alias").inode === filesystem.stat("nested/executable").inode, "hard links retain identity");
    check(filesystem.stat("alias").linkCount === 2, "hard link count restored");
    check(filesystem.listDirectory("empty").length === 0, "empty directory restored");
    check(filesystem.readlink("broken") === "missing/target" && filesystem.readlink("directory-link") === "nested", "literal symlinks restored");
    check(!filesystem.listFiles().includes("discarded"), "later additions removed");
    const stat = filesystem.stat("nested/executable");
    check(stat.mode === attributes.mode && stat.uid === 123 && stat.gid === 456
        && stat.mtime.seconds === 900n && stat.mtime.nanoseconds === 987654321, "file metadata restored");
    check(filesystem.stat("nested").mode === 0o750 && filesystem.stat("nested").mtime.seconds === 900n, "parent metadata restored after children");
    filesystem.writeFile("alias", "through link");
    check(new TextDecoder().decode(filesystem.readFile("nested/executable")) === "through link", "restored aliases share writes");
    return 1;
}
