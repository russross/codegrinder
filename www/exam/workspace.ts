import { Memory9PServer } from "./vm/runtime/p9.js";
import type { P9Change } from "./vm/runtime/p9.js";

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

function completeFileTree(
    systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
    studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
): Record<string, Uint8Array> {
    return Object.fromEntries([...systemOwnedFiles, ...studentOwnedFiles]);
}

export class ProblemWorkspace {
    readonly filesystem: Memory9PServer;
    private systemFiles: Map<string, Uint8Array>;
    private studentFiles: Map<string, Uint8Array>;
    private readonly listeners = new Set<WorkspaceStudentChangeListener>();
    private studentRevision = 0;

    constructor(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ) {
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
        this.filesystem = new Memory9PServer();
        this.filesystem.loadFiles(completeFileTree(this.systemFiles, this.studentFiles));
        this.filesystem.subscribe((change: P9Change): void => this.handleFilesystemChange(change));
    }

    subscribe(listener: WorkspaceStudentChangeListener): () => void {
        this.listeners.add(listener);
        return (): void => {
            this.listeners.delete(listener);
        };
    }

    revision(): number {
        return this.studentRevision;
    }

    visiblePaths(): string[] {
        return [...new Set([...this.studentFiles.keys(), ...this.systemFiles.keys()])];
    }

    studentOwnedPaths(): ReadonlySet<string> {
        return new Set(this.studentFiles.keys());
    }

    isStudentOwned(path: string): boolean {
        return this.studentFiles.has(path);
    }

    readVisibleFile(path: string): Uint8Array | undefined {
        const content = this.studentFiles.get(path) ?? this.systemFiles.get(path);
        return content?.slice();
    }

    writeStudentFile(path: string, content: Uint8Array): Error | undefined {
        if (!this.studentFiles.has(path)) {
            throw new Error(`Cannot edit non-student-owned file: ${path}`);
        }
        this.studentFiles.set(path, content.slice());
        this.studentRevision += 1;
        const syncError = this.writeFilesystemFile(path, content, "editor");
        this.emit({ path, source: WorkspaceChangeSource.Editor });
        return syncError;
    }

    writeServerStudentFile(path: string, content: Uint8Array): Error | undefined {
        if (!this.studentFiles.has(path)) {
            return undefined;
        }
        this.studentFiles.set(path, content.slice());
        this.studentRevision += 1;
        const syncError = this.writeFilesystemFile(path, content, "server");
        this.emit({ path, source: WorkspaceChangeSource.Server });
        return syncError;
    }

    studentSubmission(): Record<string, Uint8Array> {
        return Object.fromEntries(copyFileMap(this.studentFiles));
    }

    refreshFromServer(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ): void {
        const previousStudentFiles = this.studentFiles;
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
        for (const path of this.studentFiles.keys()) {
            const localContent = previousStudentFiles.get(path);
            if (localContent !== undefined) {
                this.studentFiles.set(path, localContent);
            }
        }
    }

    replaceFromServer(
        systemOwnedFiles: ReadonlyMap<string, Uint8Array>,
        studentOwnedFiles: ReadonlyMap<string, Uint8Array>,
    ): void {
        this.systemFiles = copyFileMap(systemOwnedFiles);
        this.studentFiles = copyFileMap(studentOwnedFiles);
        this.studentRevision = 0;
        this.rebuildFilesystem();
    }

    rebuildFilesystem(): void {
        this.filesystem.loadFiles(completeFileTree(this.systemFiles, this.studentFiles));
    }

    private writeFilesystemFile(path: string, content: Uint8Array, source: string): Error | undefined {
        try {
            this.filesystem.writeFile(path, content, source);
        } catch (error: unknown) {
            return error instanceof Error ? error : new Error(String(error));
        }
        return undefined;
    }

    private handleFilesystemChange(change: P9Change): void {
        if (change.source !== "guest") {
            return;
        }
        if (change.kind !== "create" && change.kind !== "write" && change.kind !== "rename") {
            return;
        }
        if (!this.studentFiles.has(change.path)) {
            return;
        }
        let content: Uint8Array;
        try {
            content = this.filesystem.readFile(change.path);
        } catch {
            return;
        }
        this.studentFiles.set(change.path, content);
        this.studentRevision += 1;
        this.emit({ path: change.path, source: WorkspaceChangeSource.Guest });
    }

    private emit(change: WorkspaceStudentChange): void {
        for (const listener of this.listeners) {
            listener(change);
        }
    }
}
