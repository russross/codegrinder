import { TerminalView } from "./terminal";

// Grading output converts streamed LF without changing raw VM console output.
export class GradingTerminal extends TerminalView {
    private previousCarriageReturn = false;
    constructor(host: HTMLElement) {
        super(host, {}, { readOnly: true, label: "Grading output", theme: {
            background: "#ffffff", foreground: "#454545", cursor: "#454545",
            black: "#454545", red: "#a31515", green: "#236b23", yellow: "#785600",
            blue: "#2455a4", magenta: "#853585", cyan: "#006b73", white: "#666666",
            brightBlack: "#666666", brightRed: "#b52020", brightGreen: "#287828", brightYellow: "#896100",
            brightBlue: "#2862ba", brightMagenta: "#963d96", brightCyan: "#007a84", brightWhite: "#454545",
        } });
    }
    override write(text: string | Uint8Array): void {
        if (typeof text !== "string") { super.write(text); return; }
        let converted = "";
        for (const character of text) {
            if (character === "\n" && !this.previousCarriageReturn) converted += "\r";
            converted += character;
            this.previousCarriageReturn = character === "\r";
        }
        super.write(converted);
    }
    override clear(): void { this.previousCarriageReturn = false; super.clear(); }
}
export function clearTerminal(terminal: TerminalView): void { terminal.clear(); }
