import assert from "node:assert/strict";
import test from "node:test";
import { TerminalInputQueue } from "./terminal_input.ts";

test("pasted input retains unaccepted bytes and preserves chunk order across a full FIFO", () => {
    const timers = new Map();
    let nextTimer = 0;
    const previousWindow = globalThis.window;
    globalThis.window = {
        setTimeout: (callback) => { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout: (timer) => timers.delete(timer),
    };
    try {
        const output = [];
        const acceptances = [0, 2, 1, 1024];
        const queue = new TerminalInputQueue(bytes => {
            const accepted = Math.min(bytes.length, acceptances.shift() ?? bytes.length);
            output.push(...bytes.slice(0, accepted));
            return accepted;
        });
        const pasted = Uint8Array.from({ length: 1400 }, (_, i) => i % 256);
        const expected = [...pasted, 1, 2, 3];
        queue.enqueue(pasted);
        pasted.fill(0);
        queue.enqueue(Uint8Array.of(1, 2, 3));
        for (let i = 0; timers.size > 0; i += 1) {
            assert.ok(i < 20, "queue failed to drain");
            const [timer, callback] = timers.entries().next().value;
            timers.delete(timer);
            callback();
        }
        assert.deepEqual(output, expected);
        queue.enqueue(Uint8Array.of(9));
        queue.clear();
        assert.equal(timers.size, 0);
    } finally {
        globalThis.window = previousWindow;
    }
});
