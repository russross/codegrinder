import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { openHttpBlockProvider } from "./vm/runtime/block/http.js";
import type { BlockProvider } from "./vm/runtime/block/index.js";
import type { Memory9PServer } from "./vm/runtime/p9/index.js";
import { registerClipboardTerminal } from "./clipboard";

export interface VmImageDescriptor {
    readonly configUrl: URL;
    readonly memoryMiB: number;
    readonly runtimeUrl: URL;
}

export interface VmTarget {
    readonly filesystem: Memory9PServer;
    readonly image: VmImageDescriptor;
    rebuildFilesystem(): void;
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
    Failed,
}

interface ResolvedVmConfig {
    readonly drive0?: {
        readonly file?: string;
        readonly provider?: number;
        readonly capacity_sectors?: string;
    };
    readonly [key: string]: unknown;
}

interface RiscboxRuntime {
    startResolved(config: ResolvedVmConfig, memoryMiB: number): number;
    consoleInput(data: Uint8Array): number;
    consoleResize(columns: number, rows: number): number;
    reset(): Promise<void>;
    halt(): Promise<void>;
    destroy(): Promise<void>;
}

interface RiscboxConstructor {
    instantiate(bytes: ArrayBuffer, options: {
        blockProviders: Map<number, BlockProvider>;
        p9Servers: Map<string, Memory9PServer>;
        consoleWrite(text: string): void;
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
const SHOW_CURSOR = "\x1b[?25h";
const vmImagePathsByProblemType: ReadonlyMap<string, VmImagePaths> = new Map([
    ["riscv", {
        configPath: "vm/image/risclet.cfg",
        memoryMiB: 256,
        runtimePath: "vm/runtime/riscbox.js",
    }],
]);

function examBaseUrl(): URL {
    const url = new URL(window.location.href);
    if (url.pathname.endsWith("/")) {
        return url;
    }
    const lastPathPart = url.pathname.split("/").pop() ?? "";
    if (lastPathPart.includes(".")) {
        return new URL(".", url);
    }
    url.pathname += "/";
    return url;
}

export function vmImageForProblemType(problemType: string): VmImageDescriptor | undefined {
    const paths = vmImagePathsByProblemType.get(problemType);
    if (paths === undefined) {
        return undefined;
    }
    const baseUrl = examBaseUrl();
    return {
        configUrl: new URL(paths.configPath, baseUrl),
        memoryMiB: paths.memoryMiB,
        runtimeUrl: new URL(paths.runtimePath, baseUrl),
    };
}

export class VmController {
    private readonly bootButton: HTMLButtonElement;
    private readonly fitAddon = new FitAddon();
    private readonly host: HTMLElement;
    private readonly terminal: Terminal;
    private runtime: RiscboxRuntime | undefined;
    private teardown: Promise<void> = Promise.resolve();
    private generation = 0;
    private inputBytes: number[] = [];
    private inputOffset = 0;
    private inputTimer: number | undefined;
    private state = VmState.Ready;
    private target: VmTarget | undefined;

    constructor(host: HTMLElement, bootButton: HTMLButtonElement) {
        this.host = host;
        this.bootButton = bootButton;
        this.terminal = new Terminal({
            convertEol: false,
            customGlyphs: true,
            cursorBlink: true,
            scrollback: 1000,
            theme: {
                background: "#1e1e1e",
                foreground: "#d4d4d4",
            },
        });
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.open(this.host);
        registerClipboardTerminal(this.terminal);
        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss((): void => webglAddon.dispose());
            this.terminal.loadAddon(webglAddon);
        } catch (error: unknown) {
            console.warn("VM terminal WebGL renderer is unavailable", error);
        }
        this.fitAddon.fit();
        this.terminal.onData((text: string): void => this.sendInput(text));
        this.terminal.onResize((): void => {
            this.runtime?.consoleResize(this.terminal.cols, this.terminal.rows);
        });
        this.bootButton.addEventListener("click", (): void => {
            if (this.state === VmState.Ready) {
                this.boot();
                return;
            }
            if (this.state === VmState.Running) {
                this.resetVm();
                return;
            }
            this.reboot();
        });
        new ResizeObserver((): void => this.fit()).observe(this.host);
        this.updateControls();
    }

    setTarget(target: VmTarget | undefined): void {
        this.stop();
        this.target = target;
        this.resetTerminal();
        this.bootButton.hidden = target === undefined;
        if (target === undefined) {
            this.bootButton.disabled = true;
            return;
        }
        this.teardown = this.teardown.then((): void => {
            if (this.target === target) {
                target.rebuildFilesystem();
            }
        });
        this.state = VmState.Ready;
        this.updateControls();
    }

    fit(): void {
        this.fitAddon.fit();
    }

    bootIfInactive(): void {
        if (this.state === VmState.Ready) {
            this.boot();
            return;
        }
        if (this.state === VmState.Failed) {
            this.reboot();
        }
    }

    reportFilesystemSyncError(error: Error): void {
        this.terminal.writeln(`\r\nVM workspace is out of sync; reboot to restore it (${error.message})`);
        this.state = VmState.Failed;
        this.updateControls();
    }

    resetToReady(): void {
        this.stop();
        const target = this.target;
        this.teardown = this.teardown.then((): void => {
            if (target !== undefined && this.target === target) {
                target.rebuildFilesystem();
            }
        });
        this.resetTerminal();
        this.updateControls();
    }

    private boot(): void {
        const target = this.target;
        if (target === undefined) {
            return;
        }
        this.stop();
        this.resetTerminal();
        this.state = VmState.Loading;
        this.updateControls();
        void this.start(target, this.generation);
    }

    private reboot(): void {
        const target = this.target;
        if (target === undefined) {
            return;
        }
        this.stop();
        this.teardown = this.teardown.then((): void => {
            if (this.target === target) {
                target.rebuildFilesystem();
            }
        });
        this.boot();
    }

    private stop(): void {
        this.generation += 1;
        if (this.inputTimer !== undefined) {
            window.clearTimeout(this.inputTimer);
        }
        this.inputBytes = [];
        this.inputOffset = 0;
        this.inputTimer = undefined;
        const runtime = this.runtime;
        this.runtime = undefined;
        if (runtime !== undefined) {
            const active = this.state !== VmState.Ready;
            this.teardown = (async (): Promise<void> => {
                try {
                    if (active) {
                        await runtime.halt();
                    }
                } finally {
                    await runtime.destroy();
                }
            })().catch((error: unknown): void => {
                console.error("VM teardown failed", error);
            });
        }
        this.state = VmState.Ready;
    }

    private resetTerminal(): void {
        this.terminal.reset();
        this.terminal.write(SHOW_CURSOR);
    }

    private async start(target: VmTarget, generation: number): Promise<void> {
        try {
            await this.teardown;
            if (generation !== this.generation) {
                return;
            }
            if (window.Riscbox === undefined) {
                const runtimeScript = document.createElement("script");
                runtimeScript.src = target.image.runtimeUrl.href;
                await new Promise<void>((resolve, reject): void => {
                    runtimeScript.addEventListener("load", (): void => resolve(), { once: true });
                    runtimeScript.addEventListener("error", (): void => reject(new Error("Could not load the VM runtime")), { once: true });
                    document.body.appendChild(runtimeScript);
                });
            }
            if (generation !== this.generation) {
                return;
            }
            const Riscbox = window.Riscbox;
            if (Riscbox === undefined) {
                throw new Error("VM runtime did not expose Riscbox");
            }
            const wasmUrl = new URL("riscbox.wasm", target.image.runtimeUrl);
            const wasmResponse = await fetch(wasmUrl);
            if (!wasmResponse.ok) {
                throw new Error(`VM runtime HTTP ${wasmResponse.status}`);
            }
            const [wasmBytes, config] = await Promise.all([
                wasmResponse.arrayBuffer(),
                Riscbox.loadResolvedConfig(target.image.configUrl.href),
            ]);
            if (generation !== this.generation) {
                return;
            }
            const manifestUrl = config.drive0?.file;
            if (manifestUrl === undefined) {
                throw new Error("VM configuration has no block manifest");
            }
            const disk = await openHttpBlockProvider(manifestUrl);
            if (generation !== this.generation) {
                disk.close();
                return;
            }
            const runtime = await Riscbox.instantiate(wasmBytes, {
                blockProviders: new Map([[1, disk]]),
                p9Servers: new Map([["workspace", target.filesystem]]),
                consoleWrite: (text: string): void => this.terminal.write(text),
                consoleReset: (): void => this.resetTerminal(),
                onVmStarted: (): void => {
                    if (generation !== this.generation) {
                        return;
                    }
                    this.state = VmState.Running;
                    runtime.consoleResize(this.terminal.cols, this.terminal.rows);
                    this.updateControls();
                    this.terminal.focus();
                },
                onVmReset: (): void => {
                    if (generation !== this.generation) {
                        return;
                    }
                    this.state = VmState.Running;
                    runtime.consoleResize(this.terminal.cols, this.terminal.rows);
                    this.updateControls();
                    this.terminal.focus();
                },
                onVmHalted: (): void => {
                    if (generation === this.generation) {
                        this.state = VmState.Ready;
                        this.updateControls();
                    }
                },
                onError: (error: unknown): void => {
                    if (generation === this.generation) {
                        this.fail(`The VM runtime stopped unexpectedly: ${String(error)}`);
                    }
                },
            });
            if (generation !== this.generation) {
                disk.close();
                return;
            }
            this.runtime = runtime;
            this.state = VmState.Booting;
            this.updateControls();
            runtime.startResolved({
                ...config,
                drive0: { provider: 1, capacity_sectors: disk.capacitySectors.toString() },
            }, target.image.memoryMiB);
        } catch (error: unknown) {
            if (generation === this.generation) {
                this.fail(error instanceof Error ? error.message : String(error));
            }
        }
    }

    private resetVm(): void {
        const runtime = this.runtime;
        if (runtime === undefined) {
            return;
        }
        this.state = VmState.Booting;
        this.updateControls();
        void runtime.reset().catch((error: unknown): void => {
            this.fail(`Could not reboot the VM: ${String(error)}`);
        });
    }

    private sendInput(text: string): void {
        if (this.state !== VmState.Running) {
            return;
        }
        for (const byte of inputEncoder.encode(text)) {
            this.inputBytes.push(byte);
        }
        if (this.inputTimer === undefined) {
            this.inputTimer = window.setTimeout((): void => this.sendNextInputByte(), 0);
        }
    }

    private sendNextInputByte(): void {
        this.inputTimer = undefined;
        const runtime = this.runtime;
        if (this.state !== VmState.Running || runtime === undefined) {
            this.inputBytes = [];
            this.inputOffset = 0;
            return;
        }
        const byte = this.inputBytes[this.inputOffset];
        if (byte === undefined) {
            this.inputBytes = [];
            this.inputOffset = 0;
            return;
        }
        runtime.consoleInput(Uint8Array.of(byte));
        this.inputOffset += 1;
        this.inputTimer = window.setTimeout((): void => this.sendNextInputByte(), 2);
    }

    private fail(message: string): void {
        this.state = VmState.Failed;
        this.terminal.writeln(`\r\n${message}`);
        this.updateControls();
    }

    private updateControls(): void {
        this.bootButton.disabled = this.target === undefined
            || this.state === VmState.Loading
            || this.state === VmState.Booting;
        this.bootButton.textContent = this.state === VmState.Running || this.state === VmState.Failed
            ? "Reboot VM"
            : "Boot VM";
    }
}
