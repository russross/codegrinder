import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Terminal } from "ghostty-web";

interface ClipboardContent {
    readonly text: string;
    readonly linewise: boolean;
}

type ClipboardOperation = "copy" | "cut" | "paste";

const terminals: Terminal[] = [];

export function registerClipboardTerminal(terminal: Terminal): void {
    terminals.push(terminal);
}

export function installExamClipboard(editor: EditorView): void {
    let clipboard: ClipboardContent = { text: "", linewise: false };

    function systemText(): string {
        return clipboard.text === "" ? "" : "[redacted]";
    }

    function updateSystemClipboard(): void {
        if (navigator.clipboard === undefined || !document.hasFocus() || !navigator.userActivation.isActive) {
            return;
        }
        // Gesture-less writes can prompt for clipboard-read permission in Chrome.
        void navigator.clipboard.writeText(systemText()).catch(() => {});
    }

    function terminalFor(target: EventTarget | null): Terminal | undefined {
        if (!(target instanceof Node)) {
            return undefined;
        }
        return terminals.find((terminal: Terminal): boolean =>
            terminal.element?.contains(target) === true);
    }

    function intercept(event: Event): void {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    function copyEditor(cut: boolean): ClipboardContent {
        const state = editor.state;
        const selected = state.selection.ranges.filter((range) => !range.empty);
        const linewise = selected.length === 0;
        const lines = linewise ? [...new Set(state.selection.ranges.map((range) =>
            state.doc.lineAt(range.from).number))].map((number) => state.doc.line(number)) : [];
        const ranges = linewise
            ? lines.map((line) => ({ from: line.from, to: Math.min(state.doc.length, line.to + 1) }))
            : selected;
        const text = linewise
            ? lines.map((line) => line.text).join("\n")
            : selected.map((range) => state.sliceDoc(range.from, range.to)).join("\n");
        if (cut && !state.readOnly) {
            editor.dispatch({
                changes: ranges.map((range) => ({ from: range.from, to: range.to })),
                scrollIntoView: true,
                userEvent: "delete.cut",
            });
        }
        return { text, linewise };
    }

    function pasteInto(target: EventTarget | null): void {
        if (clipboard.text === "") {
            return;
        }
        const terminal = terminalFor(target);
        if (terminal !== undefined) {
            if (!terminal.options.disableStdin) {
                terminal.paste(clipboard.text);
            }
            return;
        }
        if (!(target instanceof Node) || !editor.dom.contains(target) || editor.state.readOnly) {
            return;
        }
        const state = editor.state;
        const linewise = clipboard.linewise && state.selection.ranges.every((range) => range.empty);
        const textLines = clipboard.text.split("\n");
        const byLine = textLines.length === state.selection.ranges.length;
        let index = 0;
        let lastLine = -1;
        editor.dispatch({
            ...state.changeByRange((range) => {
                const from = linewise ? state.doc.lineAt(range.from).from : range.from;
                if (linewise && from === lastLine) {
                    return { range };
                }
                lastLine = from;
                const content = byLine ? textLines[index++] : clipboard.text;
                const text = linewise ? `${content}\n` : content;
                return {
                    changes: { from, to: linewise ? from : range.to, insert: text },
                    range: EditorSelection.cursor(range.from + text.length),
                };
            }),
            scrollIntoView: true,
            userEvent: "input.paste",
        });
    }

    function perform(operation: ClipboardOperation, event: Event): void {
        intercept(event);
        if (operation === "paste") {
            pasteInto(event.target);
        } else {
            const target = event.target;
            const terminal = terminalFor(target);
            const selection = window.getSelection();
            const documentText = selection?.toString() ?? "";
            const outsideEditor = selection?.anchorNode !== null
                && selection?.anchorNode !== undefined
                && !editor.dom.contains(selection.anchorNode);
            if (terminal !== undefined) {
                clipboard = { text: terminal.getSelection(), linewise: false };
            } else if (documentText !== "" && outsideEditor) {
                clipboard = { text: documentText, linewise: false };
            } else if (target instanceof Node && editor.dom.contains(target)) {
                clipboard = copyEditor(operation === "cut");
            } else {
                clipboard = { text: documentText, linewise: false };
            }
            if (event instanceof ClipboardEvent) {
                event.clipboardData?.clearData();
                event.clipboardData?.setData("text/plain", systemText());
            }
        }
        updateSystemClipboard();
    }

    document.addEventListener("copy", (event: ClipboardEvent): void => {
        perform("copy", event);
    }, { capture: true });
    document.addEventListener("cut", (event: ClipboardEvent): void => {
        perform("cut", event);
    }, { capture: true });
    document.addEventListener("paste", (event: ClipboardEvent): void => {
        perform("paste", event);
    }, { capture: true });

    document.addEventListener("keydown", (event: KeyboardEvent): void => {
        if (event.altKey || event.isComposing) {
            return;
        }
        const key = event.key.toLowerCase();
        let operation: ClipboardOperation;
        if ((event.ctrlKey || event.metaKey) && key === "c") {
            operation = "copy";
        } else if ((event.ctrlKey || event.metaKey) && key === "x") {
            operation = "cut";
        } else if ((event.ctrlKey || event.metaKey) && key === "v") {
            operation = "paste";
        } else if (event.ctrlKey && key === "insert") {
            operation = "copy";
        } else if (event.shiftKey && key === "insert") {
            operation = "paste";
        } else if (event.shiftKey && key === "delete" && !event.ctrlKey && !event.metaKey) {
            operation = "cut";
        } else {
            return;
        }
        const terminal = terminalFor(event.target);
        if (terminal !== undefined && operation !== "paste" && !terminal.hasSelection()
            && event.ctrlKey && !event.metaKey && !event.shiftKey && (key === "c" || key === "x")) {
            return;
        }
        perform(operation, event);
    }, { capture: true });

    function blockMiddleButton(event: MouseEvent): void {
        if (event.button === 1) {
            intercept(event);
        }
    }
    document.addEventListener("pointerdown", blockMiddleButton, { capture: true });
    document.addEventListener("mousedown", blockMiddleButton, { capture: true });
    document.addEventListener("mouseup", blockMiddleButton, { capture: true });
    document.addEventListener("auxclick", blockMiddleButton, { capture: true });

    for (const eventName of ["dragstart", "dragenter", "dragover", "drop"]) {
        document.addEventListener(eventName, intercept, { capture: true });
    }
    document.addEventListener("beforeinput", (event: InputEvent): void => {
        if (event.inputType === "insertFromPaste" || event.inputType === "insertFromPasteAsQuotation"
            || event.inputType === "insertFromDrop" || event.inputType === "deleteByCut"
            || event.inputType === "deleteByDrag") {
            intercept(event);
        }
    }, { capture: true });

    window.addEventListener("focus", updateSystemClipboard);
    window.addEventListener("blur", updateSystemClipboard);
    document.addEventListener("visibilitychange", updateSystemClipboard);
    updateSystemClipboard();
}
