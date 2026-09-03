"use strict";

const { smokeAnswer } = require("../smoke");

test("returns the smoke-test answer", () => {
    expect(smokeAnswer()).toBe(42);
});
