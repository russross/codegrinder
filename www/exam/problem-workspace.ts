import type { Filesystem, P9Change } from "@riscbox/storage";
import type { EditorFilesystem } from "./editor-session";
import { changeAffectsPath } from "./workspace";

export enum WorkspaceChangeSource { Editor = "editor", Guest = "guest", Server = "server" }
export interface WorkspaceStudentChange { readonly path: string; readonly source: WorkspaceChangeSource; }
export type WorkspaceStudentChangeListener = (change: WorkspaceStudentChange) => void;
const SERVER_ORIGIN = 2n;

function copyFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
    return new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
}
function equalBytes(left: Uint8Array | undefined, right: Uint8Array): boolean {
    return left !== undefined && left.length === right.length && right.every((byte, index) => byte === left[index]);
}

// Official submission entries survive guest removals and renames away from them.
export class ProblemWorkspace implements EditorFilesystem {
    private filesystem: Filesystem | undefined;
    private systemFiles: Map<string, Uint8Array>;
    private studentFiles: Map<string, Uint8Array>;
    private originals: Map<string, Uint8Array>;
    private studentRevision = 0;
    private readonly listeners = new Set<WorkspaceStudentChangeListener>();
    onFilesystemChange: ((change: P9Change) => void) | undefined;

    constructor(system: ReadonlyMap<string, Uint8Array>, student: ReadonlyMap<string, Uint8Array>) {
        this.systemFiles = copyFiles(system);
        this.studentFiles = copyFiles(student);
        this.originals = copyFiles(new Map([...system, ...student]));
    }
    subscribe(listener: WorkspaceStudentChangeListener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    revision(): number { return this.studentRevision; }
    visiblePaths(): string[] { return [...new Set([...this.studentFiles.keys(), ...this.systemFiles.keys()])]; }
    studentOwnedPaths(): ReadonlySet<string> { return new Set(this.studentFiles.keys()); }
    isStudentOwned(path: string): boolean { return this.studentFiles.has(path); }
    studentSubmission(): Record<string, Uint8Array> { return Object.fromEntries(copyFiles(this.studentFiles)); }
    originalFiles(): ReadonlyMap<string, Uint8Array> { return copyFiles(this.originals); }
    currentFiles(): ReadonlyMap<string, Uint8Array> { return copyFiles(new Map([...this.systemFiles, ...this.studentFiles])); }

    // The adapter also supports problems without a VM using the official maps.
    attach(filesystem: Filesystem | undefined): void { this.filesystem = filesystem; }
    listFiles(): readonly string[] { return [...new Set([...this.visiblePaths(), ...this.filesystem?.listFiles() ?? []])]; }
    readFile(path: string): Uint8Array {
        const system = this.systemFiles.get(path);
        if (system !== undefined) return system.slice();
        if (this.filesystem?.listFiles().includes(path)) return this.filesystem.readFile(path);
        const bytes = this.readVisibleFile(path);
        if (bytes === undefined) throw new Error(`Workspace file not found: ${path}`);
        return bytes;
    }
    readVisibleFile(path: string): Uint8Array | undefined {
        return (this.studentFiles.get(path) ?? this.systemFiles.get(path))?.slice();
    }
    writeFile(path: string, bytes: Uint8Array | string, origin = 1n): void {
        if (!this.isStudentOwned(path)) throw new Error(`Cannot edit non-student-owned file: ${path}`);
        const content = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
        if (this.filesystem !== undefined) {
            this.ensureParents(path);
            this.filesystem.writeFile(path, content, origin);
            this.record(path, this.filesystem.readFile(path), origin === SERVER_ORIGIN
                ? WorkspaceChangeSource.Server : WorkspaceChangeSource.Editor);
        } else {
            this.record(path, content, origin === SERVER_ORIGIN ? WorkspaceChangeSource.Server : WorkspaceChangeSource.Editor);
            this.onFilesystemChange?.({ kind: "write", path, aliases: [], inode: 0n, source: "host", origin });
        }
    }
    writeStudentFile(path: string, bytes: Uint8Array): void { this.writeFile(path, bytes); }
    writeServerStudentFile(path: string, bytes: Uint8Array): void {
        if (!this.isStudentOwned(path)) return;
        // Returned action bytes remain savable even if the guest changed the path shape.
        this.record(path, bytes, WorkspaceChangeSource.Server);
        this.writeFile(path, bytes, SERVER_ORIGIN);
    }
    // Reads are synchronous; all origins contribute to submission revisions.
    handleFilesystemChange(change: P9Change): void {
        const filesystem = this.filesystem;
        if (filesystem === undefined || change.kind === "metadata") return;
        const existing = new Set(filesystem.listFiles());
        for (const path of this.studentFiles.keys()) {
            if (!existing.has(path) || !changeAffectsPath(change, path)) continue;
            this.record(path, filesystem.readFile(path), change.source === "guest" ? WorkspaceChangeSource.Guest
                : change.origin === SERVER_ORIGIN ? WorkspaceChangeSource.Server : WorkspaceChangeSource.Editor);
        }
    }
    captureStudentFiles(): void {
        this.handleFilesystemChange({ kind: "rescan", path: "", aliases: [], inode: 0n, source: "guest", origin: 0n });
    }
    private record(path: string, bytes: Uint8Array, source: WorkspaceChangeSource): void {
        if (equalBytes(this.studentFiles.get(path), bytes)) return;
        this.studentFiles.set(path, bytes.slice());
        this.studentRevision += 1;
        for (const listener of this.listeners) listener({ path, source });
    }
    private ensureParents(path: string): void {
        const filesystem = this.filesystem;
        if (filesystem === undefined) return;
        const parts = path.split("/");
        for (let end = 1; end < parts.length; end++) {
            const parent = parts.slice(0, end).join("/");
            const name = parts[end - 1];
            const directory = parts.slice(0, end - 1).join("/");
            if (!filesystem.listDirectory(directory).some(entry => entry.name === name)) filesystem.mkdir(parent, SERVER_ORIGIN);
        }
    }

    // Refresh updates system files while retaining the student's working bytes.
    async refreshFromServer(system: ReadonlyMap<string, Uint8Array>, student: ReadonlyMap<string, Uint8Array>): Promise<void> {
        this.systemFiles = copyFiles(system);
        const previous = this.studentFiles;
        this.studentFiles = copyFiles(student);
        for (const [path, bytes] of previous) if (this.studentFiles.has(path)) this.studentFiles.set(path, bytes);
        for (const [path, bytes] of new Map([...system, ...student])) {
            if (previous.has(path) && !system.has(path)) continue;
            if (this.filesystem !== undefined) {
                this.ensureParents(path);
                this.filesystem.writeFile(path, bytes, SERVER_ORIGIN);
            }
        }
    }
    async replaceFromServer(system: ReadonlyMap<string, Uint8Array>, student: ReadonlyMap<string, Uint8Array>): Promise<void> {
        this.attach(undefined);
        this.systemFiles = copyFiles(system);
        this.studentFiles = copyFiles(student);
        this.originals = copyFiles(new Map([...system, ...student]));
        this.studentRevision = 0;
    }
}
