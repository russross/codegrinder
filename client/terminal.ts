import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { observeUserInput } from "./terminal-user-input";
import { defaultFontSize, monospaceFontFamily } from "./typography";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";

const theme: ITheme = {
    background: "#000000", foreground: "#c0c0c0", cursor: "#c0c0c0", cursorAccent: "#000000",
    black: "#000000", red: "#ff0000", green: "#00ff00", yellow: "#ffff00",
    blue: "#0000ff", magenta: "#ff00ff", cyan: "#00ffff", white: "#ffffff",
    brightBlack: "#808080", brightRed: "#ff8080", brightGreen: "#80ff80", brightYellow: "#ffff80",
    brightBlue: "#8080ff", brightMagenta: "#ff80ff", brightCyan: "#80ffff", brightWhite: "#ffffff",
};

export interface TerminalCallbacks {
    onData?(text: string): void;
    onResponse?(text: string): void;
    onBinary?(bytes: Uint8Array): void;
    onResize?(cols: number, rows: number): void;
}
export interface TerminalOptions {
    readonly readOnly?: boolean;
    readonly theme?: ITheme;
    readonly label?: string;
}

// Each screen owns its parser queue, input subscriptions, and rendering resources.
export class TerminalView {
    readonly ready: Promise<void>;
    private widget: Terminal;
    private fitAddon: FitAddon;
    private readonly resizeObserver: ResizeObserver;
    private destroyed = false;

    constructor(readonly element: HTMLElement, private readonly callbacks: TerminalCallbacks = {},
        private readonly options: TerminalOptions = {}) {
        element.classList.add("terminal-vm");
        element.style.backgroundColor = options.theme?.background ?? theme.background ?? "#000000";
        this.fitAddon = new FitAddon();
        this.widget = this.createScreen(80, 24);
        this.resizeObserver = new ResizeObserver(() => this.fit());
        this.resizeObserver.observe(element);
        this.ready = document.fonts.load(`${defaultFontSize}px ${monospaceFontFamily}`).then(() => { this.fit(); });
    }

    private createScreen(cols: number, rows: number): Terminal {
        const widget = new Terminal({ cols, rows, fontFamily: monospaceFontFamily,
            fontSize: defaultFontSize, lineHeight: 1, theme: this.options.theme ?? theme,
            cursorBlink: this.acceptsInput, disableStdin: !this.acceptsInput,
            scrollback: 1000, smoothScrollDuration: 0, customGlyphs: true,
            windowOptions: { getWinSizePixels: true, getCellSizePixels: true },
        });
        const surface = document.createElement("div");
        surface.className = "terminal-surface";
        this.element.replaceChildren(surface);
        widget.loadAddon(this.fitAddon);
        widget.open(surface);

        // xterm's internal user-input signal distinguishes typing from parser replies.
        let userInput = false;
        const subscription = observeUserInput(widget, () => { userInput = true; });
        widget.onData(text => {
            const fromUser = userInput;
            userInput = false;
            if (this.destroyed || this.widget !== widget || !this.acceptsInput) return;
            if (fromUser) this.callbacks.onData?.(text);
            else this.callbacks.onResponse?.(text);
        });
        widget.onBinary(text => {
            if (!this.destroyed && this.widget === widget && this.acceptsInput) {
                this.callbacks.onBinary?.(Uint8Array.from(text, character => character.charCodeAt(0)));
            }
        });
        widget.onResize(({ cols, rows }) => this.callbacks.onResize?.(cols, rows));
        widget.loadAddon({ activate: () => {}, dispose: () => subscription.dispose() });
        // Guest OSC 52 clipboard requests cannot bypass the page's private buffer.
        widget.parser.registerOscHandler(52, () => true);
        surface.addEventListener("paste", event => {
            if (event.clipboardData === null) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.paste(event.clipboardData.getData("text/plain"));
        }, { capture: true });

        // WebGL draws connected box glyphs directly at device-pixel cell boundaries.
        const renderer = new WebglAddon();
        renderer.onContextLoss(() => {
            renderer.dispose();
            console.warn("Terminal WebGL context lost; using the DOM renderer");
        });
        try { widget.loadAddon(renderer); }
        catch (error: unknown) { console.warn("Terminal WebGL unavailable; using the DOM renderer", error); }
        widget.textarea?.setAttribute("aria-label", this.options.label ?? "Virtual machine console");
        if (!this.acceptsInput) widget.write("\x1b[?25l");
        return widget;
    }

    get cols(): number { return this.widget.cols; }
    get rows(): number { return this.widget.rows; }
    get acceptsInput(): boolean { return !this.options.readOnly; }
    fit(): void {
        if (!this.destroyed && this.element.clientWidth > 0 && this.element.clientHeight > 0) this.fitAddon.fit();
    }
    write(text: string | Uint8Array): void { if (!this.destroyed) this.widget.write(text); }
    writeln(text: string): void { this.write(`${text}\r\n`); }
    focus(): void { if (!this.destroyed) this.widget.focus(); }

    // The write callback is a parser barrier, so callers see all earlier output.
    async readText(history = true): Promise<string> {
        await this.ready;
        if (this.destroyed) return "";
        const widget = this.widget;
        await new Promise<void>(resolve => widget.write("", resolve));
        if (this.destroyed) return "";
        if (widget !== this.widget) return this.readText(history);
        const buffer = widget.buffer.active;
        const lines: string[] = [];
        const start = history ? 0 : buffer.baseY;
        for (let row = start; row < buffer.length; row++) lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
        return lines.join("\n").trimEnd();
    }
    getSelection(): string { return this.destroyed ? "" : this.widget.getSelection(); }
    hasSelection(): boolean { return !this.destroyed && this.widget.hasSelection(); }
    clearSelection(): void { if (!this.destroyed) this.widget.clearSelection(); }
    paste(text: string): void {
        if (this.destroyed || !this.acceptsInput) return;
        this.widget.clearSelection();
        this.widget.scrollToBottom();
        this.widget.paste(this.widget.modes.bracketedPasteMode ? text.replace(/\x1b/g, "") : text);
    }
    async selectAll(): Promise<boolean> {
        await this.readText();
        if (this.destroyed) return false;
        this.widget.selectAll();
        return this.widget.hasSelection();
    }
    selectWord(row: number, column: number): boolean {
        if (this.destroyed) return false;
        const line = this.widget.buffer.active.getLine(this.widget.buffer.active.viewportY + row);
        if (line === undefined) return false;
        const text = line.translateToString(true);
        if (column >= text.length || /\s/.test(text[column])) return false;
        let start = column;
        let end = column + 1;
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        while (end < text.length && !/\s/.test(text[end])) end++;
        this.widget.select(start, this.widget.buffer.active.viewportY + row, end - start);
        return this.hasSelection();
    }

    // Release the old GPU context after xterm removes its rendering listeners.
    private disposeScreen(): void {
        const canvas = this.element.querySelector("canvas");
        const context = canvas?.getContext("webgl2");
        this.widget.dispose();
        context?.getExtension("WEBGL_lose_context")?.loseContext();
    }

    // Replacing the parser drops queued old output before the first reboot paint.
    clear(): void {
        if (this.destroyed) return;
        const cols = this.cols;
        const rows = this.rows;
        const focused = this.element.contains(document.activeElement);
        this.disposeScreen();
        this.fitAddon = new FitAddon();
        this.widget = this.createScreen(cols, rows);
        this.fit();
        if (focused) this.widget.focus();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.resizeObserver.disconnect();
        this.disposeScreen();
        this.element.replaceChildren();
    }
}
