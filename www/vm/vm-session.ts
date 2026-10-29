import type { Riscbox, RiscboxOptions } from "@riscbox/runtime";
import type { Filesystem, P9Change, BlockDisk } from "@riscbox/storage";
import { TerminalView } from "./terminal";
import { TerminalInputQueue } from "./terminal_input";
import { populateWorkspace, restoreWorkspace, snapshotWorkspace } from "./workspace";
import type { WorkspaceSnapshot } from "./workspace";

export interface VmImage {
    readonly configUrl: string;
    readonly runtimeUrl: string;
    readonly wasmUrl: string;
    readonly memoryMiB: number;
    readonly shareName: string;
}
export interface VmTarget {
    readonly image: VmImage;
    snapshot?: WorkspaceSnapshot;
    loadFiles(): Promise<ReadonlyMap<string, Uint8Array>>;
}
export type VmState = "ready" | "loading" | "stopping" | "running" | "halted" | "failed";
export interface VmTransition {
    readonly workspace: "snapshot" | "files";
    readonly poweroff: "orderly" | "force" | "preserve";
    readonly discardDiskChanges: boolean;
    readonly boot: boolean;
}
export interface VmSessionOptions<Target extends VmTarget> {
    loadRuntime(image: VmImage): Promise<typeof Riscbox>;
    flushEditor(): Promise<void>;
    canInteract(): boolean;
    beforeReplace(): void;
    afterHalt?(target: Target): Promise<void>;
    afterSnapshot(target: Target, snapshot: WorkspaceSnapshot): Promise<void>;
    onFilesystemChange(change: P9Change): void;
    onStateChange(state: VmState): void;
    onError(error: unknown): void;
}

// Compare the complete prepared platform identity rather than a problem type label.
export function sameImage(left: VmImage, right: VmImage): boolean {
    return left.configUrl === right.configUrl && left.runtimeUrl === right.runtimeUrl
        && left.wasmUrl === right.wasmUrl && left.memoryMiB === right.memoryMiB
        && left.shareName === right.shareName;
}

export class VmSession<Target extends VmTarget> {
    readonly terminal: TerminalView;
    private machine: Riscbox | undefined;
    private share: Filesystem | undefined;
    private disks: readonly BlockDisk[] = [];
    private image: VmImage | undefined;
    private selected: Target | undefined;
    private loaded = false;
    private inputGeneration = 0;
    private runtimeGeneration = 0;
    private currentState: VmState = "ready";
    private unsubscribe: (() => void) | undefined;
    private readonly resizeObserver: ResizeObserver;
    private shutdownWaiter: { resolve(): void; reject(error: Error): void } | undefined;
    private readonly input = new TerminalInputQueue(bytes =>
        this.state === "running" ? this.machine?.consoleInput(bytes) ?? 0 : 0);

    constructor(host: HTMLElement, private readonly options: VmSessionOptions<Target>) {
        this.terminal = new TerminalView(host, {
            onData: text => this.sendInput(new TextEncoder().encode(text)),
            onResponse: text => {
                if (this.state === "running") this.input.enqueue(new TextEncoder().encode(text), true);
            },
            onBinary: bytes => this.sendInput(bytes),
            onResize: (columns, rows) => {
                if (this.machine?.started) this.machine.consoleResize(columns, rows);
            },
        });
        this.resizeObserver = new ResizeObserver(() => this.fit());
        this.resizeObserver.observe(host);
    }

    get state(): VmState { return this.currentState; }
    get target(): Target | undefined { return this.selected; }
    get runtime(): Riscbox | undefined { return this.machine; }
    get filesystem(): Filesystem {
        if (this.share === undefined) throw new Error("VM filesystem is unavailable");
        return this.share;
    }
    fit(): void { this.terminal.fit(); }
    private setState(state: VmState): void { this.currentState = state; this.options.onStateChange(state); }
    private clearInput(): void { this.inputGeneration += 1; this.input.clear(); }
    private clearTerminal(): void { this.clearInput(); this.terminal.clear(); }

    private sendInput(bytes: Uint8Array): void {
        if (this.state !== "running" || !this.options.canInteract()) return;
        const generation = this.inputGeneration;
        const copied = bytes.slice();
        void this.options.flushEditor().then(() => {
            if (generation === this.inputGeneration && this.state === "running" && this.options.canInteract()) {
                this.input.enqueue(copied);
            }
        }).catch(this.options.onError);
    }

    // Preparation constructs stores without booting. Facades belong to this VM.
    async prepareImage(image: VmImage): Promise<Riscbox> {
        if (this.machine !== undefined) throw new Error("Destroy the existing VM before preparing another image");
        await this.terminal.ready;
        const generation = ++this.runtimeGeneration;
        const active = (): boolean => generation === this.runtimeGeneration;
        const callbacks: RiscboxOptions = {
            consoleWrite: text => { if (active()) this.terminal.write(text); },
            // Retire queued output and terminal modes before the new boot writes.
            consoleReset: () => { if (active()) this.clearTerminal(); },
            onVmStarted: () => { if (active() && this.state !== "running") this.markRunning(); },
            onVmReset: () => { if (active()) this.markRunning(); },
            onVmHalted: () => {
                if (!active()) return;
                this.clearInput();
                const waiter = this.shutdownWaiter;
                this.shutdownWaiter = undefined;
                if (waiter !== undefined) waiter.resolve();
                else this.setState("halted");
            },
            onError: error => { if (active()) this.fail(error); },
        };
        try {
            const constructor = await this.options.loadRuntime(image);
            const runtime = await constructor.prepare({
                config: { url: image.configUrl }, wasmUrl: image.wasmUrl,
                ramMiB: image.memoryMiB, ...callbacks,
            });
            this.machine = runtime;
            this.share = runtime.filesystem(image.shareName);
            // Exam images contain one HTTP root disk; type changes and recovery discard its overlay.
            this.disks = [runtime.block(0)];
            this.unsubscribe = this.share.subscribe(change => { if (active() && this.loaded) this.options.onFilesystemChange(change); });
            this.image = image;
            return runtime;
        } catch (error: unknown) {
            await this.destroyMachine();
            throw error;
        }
    }

    // Callers serialize selections and supply a generation check for supersession.
    async setTarget(target: Target, transition: VmTransition, isCurrent: () => boolean): Promise<boolean> {
        const previous = this.selected;
        if (previous === undefined) this.selected = target;
        this.clearInput();
        try {
            const restoreSnapshot = transition.workspace === "snapshot";
            const changedImage = this.image !== undefined && !sameImage(this.image, target.image);
            if (transition.poweroff === "force" || changedImage) await this.forceHalt();
            else if (transition.poweroff === "orderly") await this.shutdown();
            if (!isCurrent()) return false;
            if (previous !== undefined && this.loaded) {
                await this.options.afterHalt?.(previous);
                if (!isCurrent()) return false;
                if (restoreSnapshot) {
                    previous.snapshot = snapshotWorkspace(this.filesystem);
                    await this.options.afterSnapshot(previous, previous.snapshot);
                }
                if (!isCurrent()) return false;
            }
            const files = !restoreSnapshot || target.snapshot === undefined ? await target.loadFiles() : undefined;
            if (!isCurrent()) return false;
            this.options.beforeReplace();
            this.selected = target;
            this.loaded = false;
            this.setState("loading");
            if (changedImage) await this.destroyMachine();
            if (this.machine === undefined) await this.prepareImage(target.image);
            if (!isCurrent()) return false;
            const runtime = this.machine;
            if (runtime === undefined) throw new Error("VM is unavailable");
            if (transition.discardDiskChanges) {
                await runtime.coldReset();
                if (!isCurrent()) return false;
                for (const disk of this.disks) disk.reset();
            }
            if (!restoreSnapshot) target.snapshot = undefined;
            if (restoreSnapshot && target.snapshot !== undefined) restoreWorkspace(this.filesystem, target.snapshot);
            else if (files !== undefined) populateWorkspace(this.filesystem, files);
            else throw new Error("Workspace files are unavailable");
            this.loaded = true;
            if (runtime.started) this.setState("running");
            else {
                this.clearTerminal();
                this.setState("ready");
            }
            if (transition.boot) await this.boot();
            return isCurrent();
        } catch (error: unknown) {
            if (isCurrent()) this.fail(error);
            throw error;
        }
    }

    // Reset reloads the host's current files without flushing its editor or saving.
    async reset(isCurrent: () => boolean = () => true): Promise<boolean> {
        const target = this.selected;
        if (target === undefined) throw new Error("VM has no workspace to reset");
        return this.setTarget(target, {
            workspace: "files", poweroff: "force", discardDiskChanges: true, boot: true,
        }, isCurrent);
    }

    // Input delivery is not shutdown completion. Only the halt callback releases it.
    private async shutdown(): Promise<void> {
        const runtime = this.machine;
        if (runtime === undefined || !runtime.started) return;
        this.setState("stopping");
        const stopped = new Promise<void>((resolve, reject) => { this.shutdownWaiter = { resolve, reject }; });
        const waiter = this.shutdownWaiter;
        void runtime.requestShutdown().catch((error: unknown) => {
            if (this.shutdownWaiter !== waiter) return;
            waiter?.reject(error instanceof Error ? error : new Error(String(error)));
            this.shutdownWaiter = undefined;
        });
        await stopped;
    }

    // Forced recovery can bypass the application's queue to unblock shutdown.
    async forceHalt(): Promise<void> {
        this.clearInput();
        if (this.machine?.started) await this.machine.halt();
    }
    async boot(): Promise<void> {
        if (this.state === "running" || this.state === "loading") return;
        // Failed preparation can retry from the selected target's complete official files.
        if (!this.loaded) {
            const target = this.selected;
            if (target === undefined) throw new Error("VM has no workspace to boot");
            await this.setTarget(target, {
                workspace: "files", poweroff: "force", discardDiskChanges: true, boot: false,
            }, () => true);
        }
        if (this.machine === undefined) throw new Error("VM is unavailable");
        this.setState("loading");
        try { this.fit(); await this.machine.boot(); }
        catch (error: unknown) { this.fail(error); throw error; }
    }
    async reboot(): Promise<void> {
        if (this.machine === undefined) throw new Error("VM is unavailable");
        this.clearInput();
        if (!this.machine.started) { await this.boot(); return; }
        const generation = this.inputGeneration;
        this.setState("stopping");
        try { await this.machine.requestReboot(); }
        catch (error: unknown) {
            if (generation !== this.inputGeneration) return;
            this.fail(error);
            throw error;
        }
    }
    bootIfInactive(): void {
        if (!this.options.canInteract()) return;
        if (this.state === "ready" || this.state === "halted" || this.state === "failed") {
            void this.boot().catch(this.options.onError);
        } else if (this.state === "running") this.terminal.focus();
    }
    private markRunning(): void {
        this.setState("running");
        this.fit();
        this.machine?.consoleResize(this.terminal.cols, this.terminal.rows);
        this.terminal.focus();
    }
    private fail(error: unknown): void {
        this.clearInput();
        const message = error instanceof Error ? error.message : String(error);
        this.shutdownWaiter?.reject(new Error(message));
        this.shutdownWaiter = undefined;
        this.setState("failed");
        this.terminal.writeln(`\r\n${message}`);
        this.options.onError(error);
    }

    private async destroyMachine(): Promise<void> {
        this.clearInput();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.runtimeGeneration += 1;
        const runtime = this.machine;
        this.machine = undefined;
        this.share = undefined;
        this.disks = [];
        this.image = undefined;
        if (runtime !== undefined) { if (runtime.started) await runtime.halt(); await runtime.destroy(); }
    }
    async destroy(): Promise<void> {
        await this.forceHalt();
        await this.destroyMachine();
        this.resizeObserver.disconnect();
        this.terminal.destroy();
    }
}
