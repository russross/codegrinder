import assert from "node:assert/strict";
import test from "node:test";

import { FileSystem } from "../scripts/directoryTree.ts";

test("flat byte workspaces preserve files while enforcing path boundaries", () => {
  const encoder = new TextEncoder();
  const mainContent = encoder.encode("export const answer = 42;");
  const fileSystem = new FileSystem({ "src/main.js": mainContent });

  assert.equal(fileSystem.readFile("/src/main.js"), mainContent);
  assert.throws(
    () => fileSystem.writeFile("/src/main.js/nested.js", encoder.encode("invalid")),
    /crosses file/,
  );
  assert.throws(
    () => fileSystem.writeFile("/src", encoder.encode("invalid")),
    /crosses file|collides with directory/,
  );

  const helperContent = encoder.encode("export const helper = true;");
  fileSystem.writeFile("/src/lib/helper.js", helperContent);
  assert.equal(fileSystem.readFile("/src/lib/helper.js"), helperContent);
});
