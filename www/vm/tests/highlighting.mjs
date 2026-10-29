import { StringStream, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter } from "@lezer/highlight";
import { languageFor } from "../editor-text.ts";
import { riscletStreamParser } from "../risclet.ts";

// Exercise directive recognition alongside actual strings and fill operands.
// Similar-looking unknown names must remain invalid rather than match prefixes.
export async function run() {
    // C sources and headers use the editor's actual filename-based selection.
    for (const filename of ["main.c", "include/example.h"]) {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const language = languageFor(filename);
        if (language === null) throw new Error(`Missing C highlighter for ${filename}`);
        const view = new EditorView({ parent: host, state: EditorState.create({
            doc: '/* C comment */\nint main(void) { puts("hello"); return 0; }',
            extensions: [language, syntaxHighlighting(classHighlighter)],
        }) });
        try {
            for (const [selector, text] of [[".tok-keyword", "return"], [".tok-string", '"hello"'],
                [".tok-comment", "/* C comment */"]]) {
                if (![...host.querySelectorAll(selector)].some(node => node.textContent === text)) {
                    throw new Error(`${filename}: missing highlighted ${text}`);
                }
            }
        } finally { view.destroy(); host.remove(); }
    }

    for (const [line, expected] of [
        ['.word 0x1234', ['meta', 'number']],
        ['.half -1', ['meta', 'operator', 'number']],
        ['.ascii "text"', ['meta', 'string']],
        ['.string "text", ""', ['meta', 'string', 'punctuation', 'string']],
        ['.asciz "text"', ['meta', 'string']],
        ['.zero 4', ['meta', 'number']],
        ['.space 4, 255', ['meta', 'number', 'punctuation', 'number']],
        ['.wordx 4', ['invalid', 'number']],
        ['.asciix "text"', ['invalid', 'string']],
        ['.L1: nop', ['labelName', 'punctuation', 'keyword']],
        ['.Lloop: j .Lloop', ['labelName', 'punctuation', 'keyword', 'variableName']],
        ['.Ldata: .word .L1', ['labelName', 'punctuation', 'meta', 'variableName']],
        ['.equ .Lsize, . - .L1', ['meta', 'variableName', 'punctuation', 'atom', 'operator', 'variableName']],
        ['.global .Lexport', ['meta', 'variableName']],
        ['.l1', ['invalid']],
        ['amoadd.w.rl', ['keyword']],
        ['amoadd.w.rel', ['invalid']],
        ['j 0b', ['keyword', 'labelName', 'labelName']],
        ['c.addi16sp sp, -16', ['keyword', 'variableName.standard', 'punctuation', 'operator', 'number']],
        ['c.addi4spn a0, sp, 1020', ['keyword', 'variableName.standard', 'punctuation', 'variableName.standard', 'punctuation', 'number']],
        ['c.lui a0, 0xfffff', ['keyword', 'variableName.standard', 'punctuation', 'number']],
        ['sw a0, count, t0', ['keyword', 'variableName.standard', 'punctuation', 'variableName', 'punctuation', 'variableName.standard']],
        ['la a0, . + 2147483647 + 1', ['keyword', 'variableName.standard', 'punctuation', 'atom', 'operator', 'number', 'operator', 'number']],
        ['li a0, -0x80000000', ['keyword', 'variableName.standard', 'punctuation', 'operator', 'number']],
        ['.2byte 0x1002', ['meta', 'number']],
        ['li a0, 0x1f', ['keyword', 'variableName.standard', 'punctuation', 'number']],
        ['li a0, 0xab', ['keyword', 'variableName.standard', 'punctuation', 'number']],
        ['j 0x1 f', ['keyword', 'labelName', 'labelName']],
    ]) {
        const stream = new StringStream(line, 4, 2);
        const state = riscletStreamParser.startState(2);
        const actual = [];
        while (!stream.eol()) {
            stream.start = stream.pos;
            const style = riscletStreamParser.token(stream, state);
            if (style !== null) actual.push(style);
        }
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(`${line}: expected ${expected}, got ${actual}`);
        }
    }
}
