import { FitAddon, Terminal } from "ghostty-web";
import type { FilesystemRuntime } from "./vm/runtime/p9/index.js";
import type { ProblemWorkspace } from "./workspace";
import { registerClipboardTerminal } from "./clipboard";
import { TerminalInputQueue } from "./terminal_input";
import { clearTerminal } from "./terminal";

export interface VmImageDescriptor {
    readonly configUrl: URL;
    readonly memoryMiB: number;
    readonly runtimeUrl: URL;
}

export interface VmTarget {
    readonly workspace: ProblemWorkspace;
    readonly image: VmImageDescriptor;
}

interface VmImagePaths {
    readonly configPath: string;
    readonly memoryMiB: number;
    readonly runtimePath: string;
}

enum VmState {
    Ready,
    Loading,
    Booting,
    Running,
    Halted,
    Failed,
}

interface ResolvedVmConfig {
    readonly version: number;
    readonly machine: string;
    readonly memory_size: number;
}

interface RiscboxRuntime extends FilesystemRuntime {
    readonly started: boolean;
    startResolved(config: ResolvedVmConfig, memoryMiB: number): number;
    consoleInput(data: Uint8Array): number;
    consoleResize(columns: number, rows: number): void;
    boot(): Promise<void>;
    reset(): Promise<void>;
    halt(): Promise<void>;
    destroy(): Promise<void>;
}

interface RiscboxConstructor {
    instantiate(bytes: ArrayBuffer, options: {
        consoleWrite(text: string | Uint8Array): void;
        consoleReset(): void;
        onVmStarted(): void;
        onVmReset(cause: string): void;
        onVmHalted(cause: string): void;
        onError(error: unknown): void;
    }): Promise<RiscboxRuntime>;
    loadResolvedConfig(url: string): Promise<ResolvedVmConfig>;
}

declare global {
    interface Window {
        Riscbox?: RiscboxConstructor;
    }
}

const inputEncoder = new TextEncoder();
const vmImagePathsByProblemType: ReadonlyMap<string, VmImagePaths> = new Map([
    ["riscv", {
        configPath: "vm/image/risclet.cfg",
        memoryMiB: 256,
        runtimePath: "vm/runtime/riscbox.js",
    }],
]);

function examBaseUrl(): URL {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith("/")) return url;
    const lastPathPart = url.pathname.split("/").pop() ?? "";
    if (lastPathPart.includes(".")) return new URL(".", url);
    url.pathname += "/";
    return url;
}

export function vmImageForProblemType(problemType: string): VmImageDescriptor | undefined {
    const paths = vmImagePathsByProblemType.get(problemType);
    if (paths === undefined) return undefined;
    const baseUrl = examBaseUrl();
    return {
        configUrl: new URL(paths.configPath, baseUrl),
        memoryMiB: paths.memoryMiB,
        runtimeUrl: new URL(paths.runtimePath, baseUrl),
    };
}

export class VmController {
    private readonly fitAddon = new FitAddon();
    private readonly terminal: Terminal;
    private runtime: RiscboxRuntime | undefined;
    private runtimeLoading: Promise<RiscboxRuntime> | undefined;
    private lifecycle: Promise<void> = Promise.resolve();
    private generation = 0;
    private inputGeneration = 0;
    private retiring = false;
    private state = VmState.Ready;
    private target: VmTarget | undefined;
    private readonly input = new TerminalInputQueue((bytes: Uint8Array): number =>
        this.state === VmState.Running ? this.runtime?.consoleInput(bytes) ?? 0 : 0);

    constructor(
        host: HTMLElement,
        private readonly bootButton: HTMLButtonElement,
        private readonly flushEditor: () => void,
    ) {
        this.terminal = new Terminal({
            convertEol: false,
            cursorBlink: true,
            fontFamily: '"Latin Modern Mono", monospace',
            fontSize: 18,
            scrollback: 1000,
            theme: {
                background: "#000000", foreground: "#c0c0c0",
                black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
                blue: "#0000ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
                brightBlack: "#808080", brightRed: "#ff8080", brightGreen: "#80ff80",
                brightYellow: "#ffff80", brightBlue: "#8080ff", brightMagenta: "#ff80ff",
                brightCyan: "#80ffff", brightWhite: "#ffffff",
            },
        });
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.open(host);
        registerClipboardTerminal(this.terminal);
        this.terminal.onData((text: string): void => this.sendInput(text));
        this.terminal.onResize(({ cols, rows }): void => { this.runtime?.consoleResize(cols, rows); });
        this.bootButton.addEventListener("click", (): void => {
            if (this.state === VmState.Running) this.resetVm();
            else this.bootIfInactive();
        });
        new ResizeObserver((): void => this.fit()).observe(host);
        this.updateControls();
    }

    setTarget(target: VmTarget | undefined): void {
        const previous = this.target;
        this.generation += 1;
        this.clearInput();
        this.target = target;
        this.state = VmState.Ready;
        this.resetTerminal();
        this.bootButton.hidden = target === undefined;
        this.updateControls();
        this.enqueue(async (): Promise<void> => {
            await this.stopRuntime();
            await previous?.workspace.rebuildFilesystem();
            if (target !== previous) await target?.workspace.rebuildFilesystem();
        });
    }

    async settle(): Promise<void> {
        let pending: Promise<void>;
        do {
            pending = this.lifecycle;
            await pending;
        } while (pending !== this.lifecycle);
    }

    fit(): void { this.fitAddon.fit(); }

    bootIfInactive(): void {
        this.terminal.focus();
        if (this.state === VmState.Loading || this.state === VmState.Booting || this.state === VmState.Running) return;
        const retained = this.state === VmState.Halted;
        const failed = this.state === VmState.Failed;
        const target = this.target;
        if (target === undefined) return;
        this.flushEditor();
        const generation = this.generation;
        this.state = VmState.Loading;
        this.updateControls();
        this.enqueue(async (): Promise<void> => {
            if (generation !== this.generation) return;
            if (retained && this.runtime !== undefined) {
                await target.workspace.settle();
                this.state = VmState.Booting;
                await this.runtime.boot();
                return;
            }
            if (failed) {
                await this.stopRuntime();
                await target.workspace.rebuildFilesystem();
            }
            await this.start(target, generation);
        });
    }

    reportFilesystemSyncError(error: Error): void {
        this.fail(`VM workspace is out of sync; reboot to restore it (${error.message})`);
    }

    resetToReady(): void {
        const target = this.target;
        const generation = ++this.generation;
        this.clearInput();
        this.state = VmState.Ready;
        this.resetTerminal();
        this.updateControls();
        this.enqueue(async (): Promise<void> => {
            await this.stopRuntime();
            if (generation === this.generation) await target?.workspace.rebuildFilesystem();
        });
    }

    private enqueue(operation: () => Promise<void>): void {
        const generation = this.generation;
        this.lifecycle = this.lifecycle.then(operation).catch((error: unknown): void => {
            if (generation !== this.generation) {
                console.error("Retired VM operation failed", error);
                return;
            }
            this.fail(error instanceof Error ? error.message : String(error));
        });
    }

    private async stopRuntime(): Promise<void> {
        const runtime = this.runtime;
        if (runtime === undefined) return;
        this.retiring = true;
        try {
            if (runtime.started) await runtime.halt();
            await runtime.destroy();
        } finally {
            this.retiring = false;
        }
    }

    private resetTerminal(): void {
        this.clearInput();
        clearTerminal(this.terminal);
    }

    private prepareRuntime(image: VmImageDescriptor): Promise<RiscboxRuntime> {
        if (this.runtimeLoading !== undefined) return this.runtimeLoading;
        const loading = this.loadRuntime(image);
        this.runtimeLoading = loading;
        void loading.catch((): void => { this.runtimeLoading = undefined; });
        return loading;
    }

    private async loadRuntime(image: VmImageDescriptor): Promise<RiscboxRuntime> {
        if (window.Riscbox === undefined) {
            const script = document.createElement("script");
            script.src = image.runtimeUrl.href;
            await new Promise<void>((resolve, reject): void => {
                script.addEventListener("load", (): void => resolve(), { once: true });
                script.addEventListener("error", (): void => {
                    script.remove();
                    reject(new Error("Could not load the VM runtime"));
                }, { once: true });
                document.body.appendChild(script);
            });
        }
        const Riscbox = window.Riscbox;
        if (Riscbox === undefined) throw new Error("VM runtime did not expose Riscbox");
        const response = await fetch(new URL("riscbox.wasm", image.runtimeUrl), { cache: "no-cache" });
        if (!response.ok) throw new Error(`VM runtime HTTP ${response.status}`);
        const runtime = await Riscbox.instantiate(await response.arrayBuffer(), {
            consoleWrite: (text): void => { this.terminal.write(text); },
            consoleReset: (): void => this.resetTerminal(),
            onVmStarted: (): void => this.markRunning(),
            onVmReset: (): void => this.markRunning(),
            onVmHalted: (): void => {
                this.clearInput();
                if (this.retiring) return;
                this.state = VmState.Halted;
                this.updateControls();
            },
            onError: (error: unknown): void => {
                this.fail(`The VM runtime stopped unexpectedly: ${String(error)}`);
            },
        });
        this.runtime = runtime;
        return runtime;
    }

    private async start(target: VmTarget, generation: number): Promise<void> {
        const runtime = await this.prepareRuntime(target.image);
        if (generation !== this.generation) return;
        const filesystem = await target.workspace.rebuildFilesystem(runtime);
        if (generation !== this.generation) return;
        if (filesystem === undefined) throw new Error("VM filesystem is unavailable");
        await filesystem.bind("workspace");
        const Riscbox = window.Riscbox;
        if (Riscbox === undefined) throw new Error("VM runtime is unavailable");
        const config = await Riscbox.loadResolvedConfig(target.image.configUrl.href);
        if (generation !== this.generation) return;
        await target.workspace.settle();
        this.fit();
        this.state = VmState.Booting;
        this.updateControls();
        if (runtime.startResolved(config, target.image.memoryMiB) !== 0) {
            throw new Error("Riscbox rejected the VM configuration");
        }
    }

    private resetVm(): void {
        this.flushEditor();
        const generation = this.generation;
        const target = this.target;
        this.state = VmState.Booting;
        this.clearInput();
        this.updateControls();
        this.enqueue(async (): Promise<void> => {
            await target?.workspace.settle();
            if (generation === this.generation) await this.runtime?.reset();
        });
    }

    private markRunning(): void {
        if (this.state !== VmState.Booting) return;
        this.state = VmState.Running;
        this.fit();
        this.runtime?.consoleResize(this.terminal.cols, this.terminal.rows);
        this.updateControls();
        this.terminal.focus();
    }

    private sendInput(text: string): void {
        const target = this.target;
        if (this.state !== VmState.Running || target === undefined) return;
        const generation = this.inputGeneration;
        this.flushEditor();
        void target.workspace.settle().then((): void => {
            if (generation === this.inputGeneration && this.state === VmState.Running) {
                this.input.enqueue(inputEncoder.encode(text));
            }
        }).catch((error: unknown): void => {
            this.reportFilesystemSyncError(error instanceof Error ? error : new Error(String(error)));
        });
    }

    private clearInput(): void {
        this.inputGeneration += 1;
        this.input.clear();
    }

    private fail(message: string): void {
        this.clearInput();
        this.state = VmState.Failed;
        this.terminal.writeln(`\r\n${message}`);
        this.updateControls();
    }

    private updateControls(): void {
        this.bootButton.disabled = this.target === undefined
            || this.state === VmState.Loading || this.state === VmState.Booting;
        this.bootButton.textContent = this.state === VmState.Running || this.state === VmState.Failed
            ? "Reboot VM" : "Boot VM";
    }
}
