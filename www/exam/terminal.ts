import type { Terminal } from "ghostty-web";

export function clearTerminal(terminal: Terminal): void {
    // Keep the live parser shared by Ghostty's renderer and selection manager.
    terminal.write("\x1bc\x1b[3J\x1b[2J\x1b[H\x1b[?25h");
    terminal.clearSelection();
    terminal.scrollToBottom();
}
