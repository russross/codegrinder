import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { P9Endpoint } from "./vm/runtime/p9.js";

export interface VmImageDescriptor {
    readonly configUrl: URL;
    readonly memoryMiB: number;
    readonly runtimeUrl: URL;
}

export interface VmTarget {
    readonly filesystem: P9Endpoint;
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

interface RiscboxTerminal {
    write(bytes: string): void;
    getSize(): [number, number];
}

interface RiscboxModule {
    p9Server: P9Endpoint;
    ccall?(
        name: string,
        returnType: null,
        argumentTypes: string[],
        argumentsList: (string | number | null)[],
    ): void;
    _console_queue_char?(byte: number): void;
    _console_resize?(): void;
    onRuntimeInitialized(): void;
    onVmStarted(): void;
}

declare global {
    interface Window {
        Module?: RiscboxModule;
        Uint8Array: Uint8ArrayConstructor;
        graphic_display: null;
        net_state: null;
        term?: RiscboxTerminal;
        update_downloading?: (active: boolean) => void;
    }
}

const inputEncoder = new TextEncoder();
const vmImagePathsByProblemType: ReadonlyMap<string, VmImagePaths> = new Map([
    ["riscv", {
        configPath: "vm/image/risclet.cfg",
        memoryMiB: 256,
        runtimePath: "vm/runtime/riscbox-wasm.js",
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
    private frame: HTMLIFrameElement | undefined;
    private frameWindow: Window | undefined;
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
            this.frameWindow?.Module?._console_resize?.();
        });
        this.bootButton.addEventListener("click", (): void => {
            if (this.state === VmState.Ready) {
                this.boot();
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
        this.terminal.reset();
        this.bootButton.hidden = target === undefined;
        if (target === undefined) {
            this.bootButton.disabled = true;
            return;
        }
        target.rebuildFilesystem();
        this.state = VmState.Ready;
        this.updateControls();
    }

    fit(): void {
        this.fitAddon.fit();
    }

    reportFilesystemSyncError(error: Error): void {
        this.terminal.writeln(`\r\nVM workspace is out of sync; reboot to restore it (${error.message})`);
    }

    resetToReady(): void {
        this.stop();
        this.target?.rebuildFilesystem();
        this.terminal.reset();
        this.updateControls();
    }

    private boot(): void {
        const target = this.target;
        if (target === undefined) {
            return;
        }
        this.stop();
        this.terminal.reset();
        this.state = VmState.Loading;
        this.updateControls();

        const frame = document.createElement("iframe");
        frame.hidden = true;
        frame.title = "Risclet virtual machine runtime";
        frame.src = new URL("../frame.html", target.image.runtimeUrl).href;
        frame.addEventListener("load", (): void => this.initializeFrame(frame, target), { once: true });
        frame.addEventListener("error", (): void => {
            if (frame === this.frame) {
                this.fail("Could not create the VM runtime");
            }
        }, { once: true });
        this.frame = frame;
        document.body.appendChild(frame);
    }

    private reboot(): void {
        const target = this.target;
        if (target === undefined) {
            return;
        }
        target.rebuildFilesystem();
        this.boot();
    }

    private stop(): void {
        if (this.inputTimer !== undefined) {
            window.clearTimeout(this.inputTimer);
        }
        this.inputBytes = [];
        this.inputOffset = 0;
        this.inputTimer = undefined;
        this.frameWindow = undefined;
        this.frame?.remove();
        this.frame = undefined;
        this.state = VmState.Ready;
    }

    private initializeFrame(frame: HTMLIFrameElement, target: VmTarget): void {
        if (frame !== this.frame || frame.contentWindow === null) {
            return;
        }
        const runtimeWindow = frame.contentWindow;
        this.frameWindow = runtimeWindow;
        runtimeWindow.term = {
            write: (binaryText: string): void => {
                const bytes = new Uint8Array(binaryText.length);
                for (let i = 0; i < binaryText.length; i += 1) {
                    bytes[i] = binaryText.charCodeAt(i);
                }
                this.terminal.write(bytes);
            },
            getSize: (): [number, number] => [this.terminal.cols, this.terminal.rows],
        };
        runtimeWindow.graphic_display = null;
        runtimeWindow.net_state = null;
        runtimeWindow.update_downloading = (active: boolean): void => {
            if (frame !== this.frame || this.state === VmState.Running) {
                return;
            }
            this.state = active ? VmState.Loading : VmState.Booting;
            this.updateControls();
        };
        runtimeWindow.Module = {
            p9Server: {
                request: (request: Uint8Array, replyCapacity: number): Uint8Array => {
                    const reply = target.filesystem.request(new Uint8Array(request), replyCapacity);
                    return new runtimeWindow.Uint8Array(reply);
                },
            },
            onRuntimeInitialized: (): void => {
                if (frame !== this.frame) {
                    return;
                }
                this.state = VmState.Loading;
                this.updateControls();
                const module = runtimeWindow.Module;
                if (module?.ccall === undefined) {
                    this.fail("VM runtime did not expose its startup function");
                    return;
                }
                module.ccall(
                    "vm_start",
                    null,
                    ["string", "number", "string", "string", "number", "number", "number"],
                    [target.image.configUrl.href, target.image.memoryMiB, "", null, 0, 0, 0],
                );
            },
            onVmStarted: (): void => {
                if (frame !== this.frame) {
                    return;
                }
                this.state = VmState.Running;
                this.updateControls();
                this.terminal.focus();
            },
        };
        runtimeWindow.addEventListener("error", (): void => {
            if (frame === this.frame) {
                this.fail("The VM runtime stopped unexpectedly");
            }
        });
        runtimeWindow.addEventListener("unhandledrejection", (event: PromiseRejectionEvent): void => {
            if (frame === this.frame) {
                this.fail(`The VM runtime stopped unexpectedly: ${String(event.reason)}`);
            }
        });

        const runtime = runtimeWindow.document.createElement("script");
        runtime.src = target.image.runtimeUrl.href;
        runtime.addEventListener("error", (): void => {
            if (frame === this.frame) {
                this.fail("Could not load the VM runtime");
            }
        }, { once: true });
        runtimeWindow.document.body.appendChild(runtime);
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
        const queueCharacter = this.frameWindow?.Module?._console_queue_char;
        if (this.state !== VmState.Running || queueCharacter === undefined) {
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
        queueCharacter(byte);
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
