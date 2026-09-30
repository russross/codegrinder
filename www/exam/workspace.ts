import { Filesystem, FilesystemError, SeedBuilder } from "./vm/runtime/p9/index.js";
import type { FilesystemRuntime, P9Change } from "./vm/runtime/p9/index.js";

export enum WorkspaceChangeSource {
    Editor = "editor",
    Guest = "guest",
    Server = "server",
}

export interface WorkspaceStudentChange {
    readonly path: string;
    readonly source: WorkspaceChangeSource;
}

export type WorkspaceStudentChangeListener = (change: WorkspaceStudentChange) => void;

function copyFileMap(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
    return new Map([...files].map(([path, content]) => [path, content.slice()]));
}

export class ProblemWorkspace {
    private filesystem: Filesystem | undefined;
    private systemFiles: Map<string, Uint8Array>;
    private studentFiles: Map<string, Uint8Array>;
    private readonly listeners = new Set<WorkspaceStudentChangeListener>();
    private readonly pathRevisions = new Map<string, number>();
    private readonly guestReads = new Map<string, number>();
    private studentRevision = 0;
    private generation = 0;
    private operations: Promise<void> = Promise.resolve();
    private syncError: Error | undefined;
    private subscribed = false;

    constructor(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ) {
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
    }

    subscribe(listener: WorkspaceStudentChangeListener): () => void {
        this.listeners.add(listener);
        return (): void => { this.listeners.delete(listener); };
    }

    revision(): number { return this.studentRevision; }

    visiblePaths(): string[] {
        return [...new Set([...this.studentFiles.keys(), ...this.systemFiles.keys()])];
    }

    studentOwnedPaths(): ReadonlySet<string> { return new Set(this.studentFiles.keys()); }

    isStudentOwned(path: string): boolean { return this.studentFiles.has(path); }

    readVisibleFile(path: string): Uint8Array | undefined {
        return (this.studentFiles.get(path) ?? this.systemFiles.get(path))?.slice();
    }

    writeStudentFile(path: string, content: Uint8Array): void {
        if (!this.studentFiles.has(path)) {
            throw new Error(`Cannot edit non-student-owned file: ${path}`);
        }
        this.writeOwnedFile(path, content, WorkspaceChangeSource.Editor);
    }

    writeServerStudentFile(path: string, content: Uint8Array): void {
        if (!this.studentFiles.has(path)) return;
        this.writeOwnedFile(path, content, WorkspaceChangeSource.Server);
    }

    studentSubmission(): Record<string, Uint8Array> {
        return Object.fromEntries(copyFileMap(this.studentFiles));
    }

    async settle(): Promise<void> {
        // Notifications may enqueue reads while earlier operations finish.
        let pending: Promise<void>;
        do {
            pending = this.operations;
            await pending;
        } while (pending !== this.operations);
        if (this.syncError !== undefined) throw this.syncError;
    }

    async refreshFromServer(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ): Promise<void> {
        await this.settle();
        const previousStudentFiles = this.studentFiles;
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
        for (const path of this.studentFiles.keys()) {
            const localContent = previousStudentFiles.get(path);
            if (localContent !== undefined) this.studentFiles.set(path, localContent);
            else {
                const content = this.studentFiles.get(path);
                if (content !== undefined) this.queueFilesystemWrite(path, content);
            }
        }
        for (const [path, content] of this.systemFiles) {
            this.queueFilesystemWrite(path, content);
            this.emit({ path, source: WorkspaceChangeSource.Server });
        }
        await this.settle();
    }

    async replaceFromServer(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ): Promise<void> {
        await this.settle();
        this.generation += 1;
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
        this.studentRevision = 0;
        this.pathRevisions.clear();
        this.guestReads.clear();
        await this.rebuildFilesystem();
    }

    async rebuildFilesystem(runtime?: FilesystemRuntime): Promise<Filesystem | undefined> {
        if (this.filesystem === undefined) {
            if (runtime === undefined) return undefined;
            this.filesystem = await Filesystem.create(runtime);
        }
        // Recover failed host writes from the canonical maps after VM teardown.
        await this.operations;
        this.generation += 1;
        const filesystem = this.filesystem;
        const builder = new SeedBuilder<Uint8Array>();
        for (const [path, content] of [...this.systemFiles, ...this.studentFiles]) {
            builder.addFile(path, content.length, content.slice());
        }
        await filesystem.installSeed({
            entries: builder.finish(),
            loader: { load: async (content: Uint8Array): Promise<Uint8Array> => content.slice() },
        });
        this.syncError = undefined;
        if (!this.subscribed) {
            await filesystem.subscribe((change: P9Change): void => this.handleFilesystemChange(change));
            this.subscribed = true;
        }
        return filesystem;
    }

    private writeOwnedFile(path: string, content: Uint8Array, source: WorkspaceChangeSource): void {
        this.studentFiles.set(path, content.slice());
        this.studentRevision += 1;
        this.pathRevisions.set(path, this.studentRevision);
        this.queueFilesystemWrite(path, content);
        this.emit({ path, source });
    }

    private track(operation: Promise<void>): void {
        const pending = operation.catch((error: unknown): void => {
            this.syncError = error instanceof Error ? error : new Error(String(error));
        });
        this.operations = Promise.all([this.operations, pending]).then((): void => {});
    }

    private queueFilesystemWrite(path: string, content: Uint8Array): void {
        const filesystem = this.filesystem;
        if (filesystem === undefined) return;
        const bytes = content.slice();
        this.track(this.operations.then(async (): Promise<void> => {
            // Guest renames and removals may have removed a canonical parent directory.
            const parts = path.split("/");
            for (let i = 1; i < parts.length; i += 1) {
                try {
                    await filesystem.mkdir(parts.slice(0, i).join("/"));
                } catch (error: unknown) {
                    if (!(error instanceof FilesystemError) || error.errno !== 17) throw error;
                }
            }
            await filesystem.writeFile(path, bytes);
        }));
    }

    private handleFilesystemChange(change: P9Change): void {
        if (change.source !== "guest" || change.kind === "remove" || change.kind === "metadata") return;
        const paths = change.kind === "rescan" || change.kind === "reset"
            ? [...this.studentFiles.keys()]
            : [...this.studentFiles.keys()].filter(path =>
                [change.path, ...change.aliases].some(name => path === name || path.startsWith(`${name}/`)));
        const filesystem = this.filesystem;
        if (filesystem === undefined) return;
        for (const path of paths) {
            const generation = this.generation;
            const revision = this.pathRevisions.get(path);
            const read = (this.guestReads.get(path) ?? 0) + 1;
            this.guestReads.set(path, read);
            this.track(filesystem.readFile(path).then((content: Uint8Array): void => {
                if (generation !== this.generation || revision !== this.pathRevisions.get(path)
                    || read !== this.guestReads.get(path) || !this.studentFiles.has(path)) return;
                this.studentFiles.set(path, content);
                this.studentRevision += 1;
                this.pathRevisions.set(path, this.studentRevision);
                this.emit({ path, source: WorkspaceChangeSource.Guest });
            }).catch((error: unknown): void => {
                // Rename-away and removal preserve the official student file entry.
                if (!(error instanceof FilesystemError) || error.errno !== 2) throw error;
            }));
        }
    }

    private emit(change: WorkspaceStudentChange): void {
        for (const listener of this.listeners) listener(change);
    }
}
