import { cpp } from "@codemirror/lang-cpp";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { risclet } from "./risclet";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
const decoder = new TextDecoder();
// Tabs insert spaces at the next four-column boundary, including each selection.
export function softTab(view: EditorView): boolean {
    if (view.state.readOnly) {
        return false;
    }
    const tabSize = 4;
    const transaction = view.state.changeByRange((range) => {
        const line = view.state.doc.lineAt(range.from);
        const column = range.from - line.from;
        const spaces = tabSize - (column % tabSize);
        const insert = " ".repeat(spaces === 0 ? tabSize : spaces);
        return {
            changes: { from: range.from, to: range.to, insert },
            range: EditorSelection.cursor(range.from + insert.length),
        };
    });
    view.dispatch(transaction);
    return true;
}

// Supported teaching languages use the same highlighting in every consumer.
export function languageFor(filename: string): LanguageSupport | null {
    const extension = filename.split(".").pop();
    switch (extension) {
        case "c":
        case "h":
            return cpp();
        case "s":
        case "S":
            return risclet();
        case "md":
            return markdown();
        case "py":
            return python();
        default:
            break;
    }
    return filename.endsWith("Makefile")
        ? new LanguageSupport(StreamLanguage.define(shell))
        : null;
}

// Hide one trailing newline; serialization restores it for nonempty buffers.
export function editorTextFromFile(content: Uint8Array): string {
    const text = decoder.decode(content);
    return text.endsWith("\n") ? text.slice(0, -1) : text;
}
