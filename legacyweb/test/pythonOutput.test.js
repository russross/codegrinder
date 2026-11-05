import assert from "node:assert/strict";
import test from "node:test";

import { createPythonOutputWriter } from "../scripts/pythonOutput.ts";

test("Python output preserves write boundaries, newlines, and split UTF-8 characters", () => {
  const output = [];
  const writer = createPythonOutputWriter((value) => output.push(value));
  const encoder = new TextEncoder();

  const firstLine = encoder.encode("Loading micropip\n");
  const secondLine = encoder.encode("Loaded café\n");
  const splitCharacter = secondLine.indexOf(0xc3) + 1;

  assert.equal(writer.write(firstLine), firstLine.byteLength);
  assert.equal(writer.write(secondLine.slice(0, splitCharacter)), splitCharacter);
  assert.equal(
    writer.write(secondLine.slice(splitCharacter)),
    secondLine.byteLength - splitCharacter,
  );
  assert.equal(output.join(""), "Loading micropip\nLoaded café\n");
});

test("Python output forwards partial lines without inventing a newline", () => {
  const output = [];
  const writer = createPythonOutputWriter((value) => output.push(value));

  writer.write(new TextEncoder().encode("prompt: "));

  assert.deepEqual(output, ["prompt: "]);
});
