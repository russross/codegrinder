import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import type { TerminalThemeColors } from "@wterm/core";
import "@wterm/dom/css";
import "./terminal.css";

export enum TerminalKind { Vm, Grade }

const themes: Record<TerminalKind, TerminalThemeColors> = {
    [TerminalKind.Vm]: {
        background: 0x000000, foreground: 0xc0c0c0, cursor: 0xc0c0c0,
        palette: [0x000000, 0xff0000, 0x00ff00, 0xffff00, 0x0000ff, 0xff00ff, 0x00ffff, 0xffffff,
            0x808080, 0xff8080, 0x80ff80, 0xffff80, 0x8080ff, 0xff80ff, 0x80ffff, 0xffffff],
    },
    [TerminalKind.Grade]: {
        background: 0xffffff, foreground: 0x454545, cursor: 0x454545,
        palette: [0x454545, 0xa31515, 0x236b23, 0x785600, 0x2455a4, 0x853585, 0x006b73, 0x666666,
            0x666666, 0xb52020, 0x287828, 0x896100, 0x2862ba, 0x963d96, 0x007a84, 0x454545],
    },
};

interface TerminalCallbacks {
    onData?: (text: string) => void;
    onBinary?: (bytes: Uint8Array) => void;
    onResize?: (cols: number, rows: number) => void;
}

export class TerminalView {
    readonly ready: Promise<void>;
    private widget: WTerm | undefined;
    private core: GhosttyCore | undefined;
    private destroyed = false;
    private initialized = false;
    private previousCarriageReturn = false;

    constructor(readonly element: HTMLElement, readonly kind: TerminalKind, private readonly callbacks: TerminalCallbacks = {}) {
        element.classList.add(kind === TerminalKind.Vm ? "terminal-vm" : "terminal-grade");
        this.ready = this.initialize();
    }

    private async initialize(): Promise<void> {
        const core = await GhosttyCore.load({ scrollbackLimit: 64 * 1024, imageStorageLimit: 0 });
        if (this.destroyed) { core.dispose(); return; }
        this.core = core;
        const surface = document.createElement("div");
        surface.className = "terminal-surface";
        this.element.appendChild(surface);
        const widget = new WTerm(surface, {
            core,
            cursorBlink: this.kind === TerminalKind.Vm,
            onData: text => { if (this.kind === TerminalKind.Vm) this.callbacks.onData?.(text); },
            onBinary: bytes => { if (this.kind === TerminalKind.Vm) this.callbacks.onBinary?.(bytes); },
            onResize: this.callbacks.onResize,
        });
        this.widget = widget;
        widget.setThemeColors(themes[this.kind]);
        try {
            await widget.init();
            this.initialized = true;
            if (this.kind === TerminalKind.Grade) {
                const input = this.element.querySelector("textarea");
                if (input !== null) input.readOnly = true;
                widget.write("\x1b[?25l");
            }
        } catch (error: unknown) {
            this.destroy();
            throw error;
        }
    }

    get cols(): number { return this.widget?.cols ?? 80; }
    get rows(): number { return this.widget?.rows ?? 24; }
    get acceptsInput(): boolean { return this.kind === TerminalKind.Vm; }

    private apply(operation: (widget: WTerm) => void): void {
        if (this.destroyed) return;
        if (this.initialized && this.widget !== undefined) {
            operation(this.widget);
            return;
        }
        void this.ready.then(() => {
            if (!this.destroyed && this.widget !== undefined) operation(this.widget);
        }).catch(() => {});
    }

    write(text: string | Uint8Array): void {
        if (typeof text !== "string") {
            this.apply(widget => widget.write(text));
            return;
        }
        if (this.kind === TerminalKind.Grade) {
            let converted = "";
            for (const character of text) {
                if (character === "\n" && !this.previousCarriageReturn) converted += "\r";
                converted += character;
                this.previousCarriageReturn = character === "\r";
            }
            text = converted;
        }
        this.apply(widget => widget.write(text));
    }
    writeln(text: string): void { this.write(`${text}\r\n`); }
    fit(): void { this.widget?.fit(); }
    focus(): void { this.apply(widget => widget.focus()); }
    getSelection(): string { return this.widget?.getSelectionText() ?? ""; }
    hasSelection(): boolean { return (this.widget?.getSelectionText() ?? null) !== null; }
    clearSelection(): void { this.widget?.clearSelection(); }
    paste(text: string): void {
        if (!this.acceptsInput || this.destroyed) return;
        this.clearSelection();
        if (this.widget !== undefined) this.widget.element.scrollTop = this.widget.element.scrollHeight;
        const input = this.core?.bracketedPaste() === true
            ? `\x1b[200~${text.replace(/\x1b/g, "")}\x1b[201~` : text;
        this.callbacks.onData?.(input);
    }
    clear(): void {
        this.previousCarriageReturn = false;
        this.apply(widget => {
            widget.clearSelection();
            widget.write(`\x1bc\x1b[3J\x1b[2J\x1b[H\x1b[?25${this.acceptsInput ? "h" : "l"}`);
            widget.element.scrollTop = widget.element.scrollHeight;
        });
    }
    async readText(): Promise<string> { await this.ready; return this.widget?.readText() ?? ""; }
    selectWord(row: number, col: number): boolean { return this.widget?.selectWord({ row, col }) ?? false; }
    async selectAll(): Promise<boolean> { return this.widget?.selectAll() ?? false; }
    destroy(): void {
        this.destroyed = true;
        this.widget?.destroy();
        this.widget?.element.remove();
        this.core?.dispose();
    }
}

export function clearTerminal(terminal: TerminalView): void { terminal.clear(); }
