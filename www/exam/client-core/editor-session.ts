import { defaultKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import type { Filesystem, P9Change } from "@riscbox/storage";
import { editorTextFromFile, languageFor, softTab } from "./editor-text";
import { changeAffectsPath } from "./workspace";

export type SyncTrigger = "blur" | "timer" | "explicit" | "selection" | "interaction" | "transition";
export const EDITOR_ORIGIN = 1n;
export type EditorFilesystem = Pick<Filesystem, "readFile" | "writeFile" | "listFiles">;
export interface EditorSessionOptions {
    canEdit(path: string): boolean;
    onChange(): void;
    onSynced(trigger: SyncTrigger): void;
    onError(error: unknown): void;
    confirmDiscard(path: string): boolean;
}

// The editor owns buffered revisions; server persistence owns a separate revision.
export class EditorSession {
    readonly view: EditorView;
    private readonly language = new Compartment();
    private readonly access = new Compartment();
    private filesystem: EditorFilesystem | undefined;
    private selectedPath: string | null = null;
    private revision = 0;
    private acknowledged = 0;
    private programmatic = false;
    private timer: number | undefined;
    private writes = Promise.resolve();
    private conflictPath: string | null = null;

    constructor(host: HTMLElement, private readonly options: EditorSessionOptions) {
        this.view = new EditorView({ parent: host, state: EditorState.create({ extensions: [
            basicSetup, keymap.of([{ key: "Tab", run: softTab }, ...defaultKeymap]),
            this.language.of([]), this.access.of([EditorView.editable.of(false), EditorState.readOnly.of(true)]),
            EditorView.domEventHandlers({ blur: () => { void this.flush("blur").catch(options.onError); } }),
            EditorView.updateListener.of(update => {
                if (!update.docChanged || this.programmatic || update.state.readOnly) return;
                this.revision += 1;
                this.schedule();
                options.onChange();
            }),
        ] }) });
    }

    get path(): string | null { return this.selectedPath; }
    get dirty(): boolean { return this.revision !== this.acknowledged; }
    get readOnly(): boolean { return this.view.state.readOnly; }
    setReadOnly(readOnly: boolean): void {
        this.view.dispatch({ effects: this.access.reconfigure([
            EditorView.editable.of(!readOnly), EditorState.readOnly.of(readOnly),
        ]) });
        if (!readOnly && this.dirty) this.schedule();
    }

    // Selection changes follow a successful flush or an explicit discard decision.
    open(filesystem: EditorFilesystem, path: string): void {
        if (this.dirty) throw new Error("Flush editor changes before selecting a file");
        const bytes = filesystem.readFile(path);
        const binary = bytes.includes(0);
        this.filesystem = filesystem;
        this.selectedPath = path;
        this.conflictPath = null;
        this.replace(binary ? "This file appears to be a binary file and cannot be displayed in the editor."
            : editorTextFromFile(bytes), !binary && this.options.canEdit(path), path);
        this.options.onChange();
        this.view.focus();
    }

    clear(): void {
        this.cancelTimer();
        this.acknowledged = this.revision;
        this.conflictPath = null;
        this.selectedPath = null;
        this.filesystem = undefined;
        this.replace("", false, "");
        this.options.onChange();
    }

    private replace(text: string, canEdit: boolean, filename: string): void {
        this.programmatic = true;
        try {
            this.view.dispatch({
                changes: this.view.state.doc.toString() === text ? undefined
                    : { from: 0, to: this.view.state.doc.length, insert: text },
                effects: [this.language.reconfigure(languageFor(filename) ?? [])],
            });
            this.setReadOnly(!canEdit);
        } finally { this.programmatic = false; }
    }

    // Debounce restarts after each edit. Blur is the usual synchronization trigger.
    private cancelTimer(): void {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        this.timer = undefined;
    }
    private schedule(): void {
        this.cancelTimer();
        if (!this.dirty) return;
        this.timer = window.setTimeout(() => {
            this.timer = undefined;
            void this.flush("timer").catch(this.options.onError);
        }, 30_000);
    }

    flush(trigger: SyncTrigger = "explicit"): Promise<void> {
        this.cancelTimer();
        const operation = this.writes.then(() => {
            const filesystem = this.filesystem;
            const path = this.selectedPath;
            if (filesystem !== undefined && path !== null && !this.readOnly && this.dirty) {
                const revision = this.revision;
                const text = this.view.state.doc.toString();
                try { filesystem.writeFile(path, new TextEncoder().encode(text === "" ? "" : `${text}\n`), EDITOR_ORIGIN); }
                catch (error: unknown) { this.schedule(); throw error; }
                if (filesystem === this.filesystem && path === this.selectedPath) {
                    this.acknowledged = Math.max(this.acknowledged, revision);
                    this.conflictPath = null;
                    this.schedule();
                    this.options.onChange();
                }
            }
            this.options.onSynced(trigger);
        });
        this.writes = operation.catch(() => undefined);
        return operation;
    }

    // Renames move the dirty buffer; content changes require a discard decision.
    handleChange(change: P9Change): void {
        const filesystem = this.filesystem;
        if (filesystem === undefined || this.selectedPath === null) return;
        const rename = change.kind === "rename" && change.oldPath !== undefined
            && (this.selectedPath === change.oldPath || this.selectedPath.startsWith(`${change.oldPath}/`));
        if (rename && change.oldPath !== undefined) {
            this.selectedPath = change.path + this.selectedPath.slice(change.oldPath.length);
            this.options.onChange();
        }
        if ((change.source === "host" && change.origin === EDITOR_ORIGIN)
            || !changeAffectsPath(change, this.selectedPath)) return;
        if (this.dirty) {
            if (rename || change.kind === "metadata" || this.conflictPath === this.selectedPath) return;
            if (!this.options.confirmDiscard(this.selectedPath)) { this.conflictPath = this.selectedPath; return; }
            this.cancelTimer();
            this.acknowledged = this.revision;
            this.conflictPath = null;
        }
        if (filesystem.listFiles().includes(this.selectedPath)) this.open(filesystem, this.selectedPath);
        else this.clear();
    }

    destroy(): void { this.cancelTimer(); this.clear(); this.view.destroy(); }
}
