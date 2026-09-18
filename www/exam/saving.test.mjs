import assert from "node:assert/strict";
import test from "node:test";

import { SaveState } from "./saving.ts";

class FakeTimers {
    callbacks = new Map();
    delays = [];
    nextTimer = 1;

    clearTimeout = (timer) => {
        this.callbacks.delete(timer);
    };

    setTimeout = (callback, delay) => {
        const timer = this.nextTimer;
        this.nextTimer += 1;
        this.callbacks.set(timer, callback);
        this.delays.push(delay);
        return timer;
    };

    fire() {
        const callbacks = [...this.callbacks.values()];
        this.callbacks.clear();
        for (const callback of callbacks) {
            callback();
        }
    }
}

function withFakeTimers(run) {
    const timers = new FakeTimers();
    const previousWindow = globalThis.window;
    globalThis.window = timers;
    try {
        run(timers);
    } finally {
        globalThis.window = previousWindow;
    }
}

test("the clean-to-dirty transition starts one fixed deadline", () => {
    withFakeTimers((timers) => {
        let saveRequests = 0;
        const saving = new SaveState(4, () => {
            saveRequests += 1;
        });

        saving.changed();
        saving.changed();
        saving.changed();

        assert.equal(timers.callbacks.size, 1);
        assert.deepEqual(timers.delays, [30_000]);
        timers.fire();
        assert.equal(saveRequests, 1);
    });
});

test("an immediate request cancels its timer without creating another deadline", () => {
    withFakeTimers((timers) => {
        const saving = new SaveState(0, () => assert.fail("canceled timer fired"));

        saving.changed();
        saving.cancelTimer();
        saving.changed();

        assert.equal(timers.callbacks.size, 0);
        assert.deepEqual(timers.delays, [30_000]);
    });
});

test("edits after submission retain a separate deadline after acknowledgement", () => {
    withFakeTimers((timers) => {
        let saveRequests = 0;
        const saving = new SaveState(0, () => {
            saveRequests += 1;
        });

        saving.changed();
        saving.submitted();
        saving.changed();
        saving.acknowledge(1, 2);

        assert.equal(saving.isDirty(2), true);
        assert.equal(timers.callbacks.size, 1);
        assert.deepEqual(timers.delays, [30_000, 30_000]);
        timers.fire();
        assert.equal(saveRequests, 1);
    });
});

test("acknowledging the current revision makes the buffer clean and cancels its timer", () => {
    withFakeTimers((timers) => {
        const saving = new SaveState(0, () => assert.fail("clean buffer timer fired"));

        saving.changed();
        saving.submitted();
        saving.changed();
        saving.acknowledge(2, 2);

        assert.equal(saving.isDirty(2), false);
        assert.equal(timers.callbacks.size, 0);
    });
});

test("a failed submission can schedule one retry deadline", () => {
    withFakeTimers((timers) => {
        let saveRequests = 0;
        const saving = new SaveState(0, () => {
            saveRequests += 1;
        });

        saving.changed();
        saving.submitted();
        saving.retry();
        saving.retry();

        assert.equal(timers.callbacks.size, 1);
        assert.deepEqual(timers.delays, [30_000, 30_000]);
        timers.fire();
        assert.equal(saveRequests, 1);
    });
});

test("stopping makes pending and future timer work inert while preserving dirty state", () => {
    withFakeTimers((timers) => {
        const saving = new SaveState(3, () => assert.fail("stopped save state requested work"));

        saving.changed();
        saving.stop();
        saving.changed();
        saving.retry();
        saving.acknowledge(4, 4);

        assert.equal(timers.callbacks.size, 0);
        assert.equal(saving.isDirty(4), true);
    });
});
