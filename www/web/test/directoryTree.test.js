import assert from "node:assert/strict";
import test from "node:test";

import { FileSystem, parseDirectoryNode } from "../scripts/directoryTree.ts";

test("serialized workspace trees retain file and directory boundaries", () => {
  const rootNode = parseDirectoryNode(JSON.parse(JSON.stringify({
    children: {
      src: {
        children: {
          "main.js": { content: "export const answer = 42;" },
        },
      },
    },
    collapsed: false,
  })));
  const fileSystem = new FileSystem(rootNode);

  assert.equal(rootNode.children.src.collapsed, true);
  const main = fileSystem.touch("/src/main.js");
  assert.equal(main.content, "export const answer = 42;");
  assert.throws(() => fileSystem.touch("/src/main.js/nested.js"), /FileNode/);
  assert.throws(() => fileSystem.touch("/src"), /DirectoryNode/);

  const helper = fileSystem.touch("/src/lib/helper.js");
  helper.content = "export const helper = true;";
  assert.equal(fileSystem.touch("/src/lib/helper.js"), helper);
});

test("embedded workspace parsing rejects malformed file content", () => {
  assert.throws(
    () => parseDirectoryNode({ children: { "main.js": { content: 42 } } }),
    /content must be a string/,
  );
});
