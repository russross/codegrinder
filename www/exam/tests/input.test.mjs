import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../terminal_input.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { TerminalInputQueue } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

// Deterministic timers model FIFO backpressure without an active guest.
test("terminal input retains partial sends, copies paste bytes, and retires queued input", () => {
    const previousWindow = globalThis.window;
    const callbacks = new Map();
    let nextTimer = 0;
    globalThis.window = {
        setTimeout(callback) { callbacks.set(++nextTimer, callback); return nextTimer; },
        clearTimeout(timer) { callbacks.delete(timer); },
    };
    const tick = () => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach(callback => callback());
    };
    try {
        const received = [];
        let capacity = 0;
        const queue = new TerminalInputQueue(bytes => {
            const accepted = Math.min(capacity, bytes.length);
            received.push(...bytes.subarray(0, accepted));
            return accepted;
        });
        const paste = Uint8Array.from({ length: 2400 }, (_, index) => index % 256);
        const expected = [...paste, 31, 32];
        queue.enqueue(paste);
        queue.enqueue(Uint8Array.of(31, 32));
        paste.fill(0);
        tick();
        assert.deepEqual(received, []);
        assert.equal(callbacks.size, 1);
        capacity = 173;
        while (callbacks.size > 0) tick();
        assert.deepEqual(received, expected);

        // Reset cancels both the scheduled retry and every unaccepted byte.
        capacity = 0;
        queue.enqueue(Uint8Array.of(99));
        tick();
        queue.clear();
        capacity = 1024;
        queue.enqueue(Uint8Array.of(42));
        tick();
        assert.deepEqual(received, [...expected, 42]);
        assert.equal(callbacks.size, 0);

        // Replies arrive before the next guest task, after already queued typing.
        queue.enqueue(Uint8Array.of(50, 51));
        queue.enqueue(Uint8Array.of(27, 91, 82), true);
        assert.deepEqual(received.slice(-5), [50, 51, 27, 91, 82]);
        assert.equal(callbacks.size, 0);
        capacity = 2;
        queue.enqueue(Uint8Array.of(27, 91, 49, 82), true);
        assert.deepEqual(received.slice(-2), [27, 91]);
        assert.equal(callbacks.size, 1);
        tick();
        assert.deepEqual(received.slice(-4), [27, 91, 49, 82]);
        assert.equal(callbacks.size, 0);
    } finally {
        globalThis.window = previousWindow;
    }
});

test("invalid input acceptance cancels retries and retires pending bytes", () => {
    const previousWindow = globalThis.window;
    const callbacks = new Map();
    globalThis.window = {
        setTimeout(callback) { const id = callbacks.size + 1; callbacks.set(id, callback); return id; },
        clearTimeout(id) { callbacks.delete(id); },
    };
    try {
        for (const invalid of [-1, 2, 0.5, NaN]) {
            const queue = new TerminalInputQueue(() => invalid);
            queue.enqueue(Uint8Array.of(1));
            const callback = [...callbacks.values()][0];
            callbacks.clear();
            assert.throws(callback, /Invalid VM input acceptance count/);
            assert.equal(callbacks.size, 0);
        }
    } finally { globalThis.window = previousWindow; }
});
