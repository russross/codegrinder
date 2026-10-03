import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import type { TerminalThemeColors } from "@wterm/core";
import "@wterm/dom/css";
import "./terminal.css";

const theme: TerminalThemeColors = {
    background: 0x000000, foreground: 0xc0c0c0, cursor: 0xc0c0c0,
    palette: [0x000000, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
        0x808080, 0xff8080, 0x80ff80, 0xffff80, 0x8080ff, 0xff80ff, 0x80ffff, 0xffffff],
};

export interface TerminalCallbacks {
    onData?(text: string): void;
    onBinary?(bytes: Uint8Array): void;
    onResize?(cols: number, rows: number): void;
}
export interface TerminalOptions {
    readonly readOnly?: boolean;
    readonly theme?: TerminalThemeColors;
    readonly label?: string;
}

// The widget owns DOM input and rendering; its core owns terminal state.
export class TerminalView {
    readonly ready: Promise<void>;
    private widget: WTerm | undefined;
    private core: GhosttyCore | undefined;
    private initialized = false;
    private destroyed = false;

    constructor(readonly element: HTMLElement, private readonly callbacks: TerminalCallbacks = {},
        private readonly options: TerminalOptions = {}) {
        element.classList.add("terminal-vm");
        if (options.theme !== undefined) element.style.backgroundColor = `#${options.theme.background.toString(16).padStart(6, "0")}`;
        this.ready = this.initialize();
    }

    private async initialize(): Promise<void> {
        const core = await GhosttyCore.load({ scrollbackLimit: 64 * 1024, imageStorageLimit: 0 });
        if (this.destroyed) { core.dispose(); return; }
        this.core = core;
        const surface = document.createElement("div");
        surface.className = "terminal-surface";
        this.element.appendChild(surface);

        // Theme defaults reach both the parser and renderer before first output.
        const widget = new WTerm(surface, { core, cursorBlink: !this.options.readOnly,
            onData: text => { if (this.acceptsInput) this.callbacks.onData?.(text); },
            onBinary: bytes => { if (this.acceptsInput) this.callbacks.onBinary?.(bytes); },
            onResize: this.callbacks.onResize,
        });
        this.widget = widget;
        widget.setThemeColors(this.options.theme ?? theme);
        try {
            await widget.init();
            this.initialized = true;
            const input = surface.querySelector("textarea");
            input?.setAttribute("aria-label", this.options.label ?? "Virtual machine console");
            if (input !== null && !this.acceptsInput) { input.readOnly = true; widget.write("\x1b[?25l"); }
        } catch (error: unknown) {
            this.destroy();
            throw error;
        }
    }

    get cols(): number { return this.widget?.cols ?? 80; }
    get rows(): number { return this.widget?.rows ?? 24; }
    get acceptsInput(): boolean { return !this.options.readOnly; }
    fit(): void { this.widget?.fit(); }

    // Startup output and focus requests wait for the asynchronously loaded core.
    private apply(operation: (widget: WTerm) => void): void {
        if (this.destroyed) return;
        if (this.initialized && this.widget !== undefined) { operation(this.widget); return; }
        void this.ready.then(() => {
            if (!this.destroyed && this.widget !== undefined) operation(this.widget);
        }).catch((error: unknown) => console.error("Terminal initialization failed", error));
    }

    write(text: string | Uint8Array): void { this.apply(widget => widget.write(text)); }
    writeln(text: string): void { this.write(`${text}\r\n`); }
    focus(): void { this.apply(widget => widget.focus()); }
    async readText(): Promise<string> { await this.ready; return this.widget?.readText() ?? ""; }
    getSelection(): string { return this.widget?.getSelectionText() ?? ""; }
    hasSelection(): boolean { return this.getSelection() !== ""; }
    clearSelection(): void { this.widget?.clearSelection(); }
    paste(text: string): void {
        if (!this.acceptsInput || this.destroyed) return;
        this.apply(widget => {
            widget.clearSelection();
            widget.element.scrollTop = widget.element.scrollHeight;
            const input = this.core?.bracketedPaste() === true
                ? `\x1b[200~${text.replace(/\x1b/g, "")}\x1b[201~` : text;
            this.callbacks.onData?.(input);
        });
    }
    selectWord(row: number, col: number): boolean { return this.widget?.selectWord({ row, col }) ?? false; }
    async selectAll(): Promise<boolean> { await this.ready; return this.widget?.selectAll() ?? false; }

    // A machine reset removes history, selection, and guest terminal modes.
    clear(): void {
        this.apply(widget => {
            widget.clearSelection();
            widget.write(`\x1bc\x1b[3J\x1b[2J\x1b[H\x1b[?25${this.acceptsInput ? "h" : "l"}`);
            widget.element.scrollTop = widget.element.scrollHeight;
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.widget?.destroy();
        this.widget?.element.remove();
        this.core?.dispose();
    }
}
