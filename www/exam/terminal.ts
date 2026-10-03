import { TerminalView as SharedTerminalView } from "./client-core/terminal";
export { TerminalView } from "./client-core/terminal";

// Grading output converts streamed LF without changing raw VM console output.
export class GradingTerminal extends SharedTerminalView {
    private previousCarriageReturn = false;
    constructor(host: HTMLElement) {
        super(host, {}, { readOnly: true, label: "Grading output", theme: {
            background: 0xffffff, foreground: 0x454545, cursor: 0x454545,
            palette: [0x454545, 0xa31515, 0x236b23, 0x785600, 0x2455a4, 0x853585, 0x006b73, 0x666666,
                0x666666, 0xb52020, 0x287828, 0x896100, 0x2862ba, 0x963d96, 0x007a84, 0x454545],
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
export function clearTerminal(terminal: SharedTerminalView): void { terminal.clear(); }
