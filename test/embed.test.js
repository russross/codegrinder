import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmbedHtml,
  standaloneProblemType,
} from "../scripts/embed.js";

const supportedProblemTypes = new Map([
  ["javascriptunittest", "javascript"],
  ["python3unittest", "python"],
]);

test("new embeds carry their exact problem type and filesystem", () => {
  const rootNode = {
    children: {
      "main.py": { content: "print('hello')" },
    },
  };
  const html = createEmbedHtml(
    { origin: "https://codegrinder.example", pathname: "/web/" },
    rootNode,
    "python3unittest",
  );
  const source = html.match(/src="([^"]+)"/)?.[1].replaceAll("&amp;", "&");
  const url = new URL(source);

  assert.equal(url.origin, "https://codegrinder.example");
  assert.equal(url.pathname, "/web/");
  assert.equal(url.searchParams.get("dummy"), "true");
  assert.equal(url.searchParams.get("problemType"), "python3unittest");
  assert.deepEqual(JSON.parse(url.searchParams.get("files")), rootNode);
});

test("legacy web embeds retain their former Python runtime", () => {
  assert.equal(
    standaloneProblemType(new URLSearchParams("dummy=true"), supportedProblemTypes),
    "python3unittest",
  );
});

test("standalone runtime selection rejects unsupported problem types", () => {
  assert.equal(
    standaloneProblemType(
      new URLSearchParams("problemType=javascriptunittest"),
      supportedProblemTypes,
    ),
    "javascriptunittest",
  );
  assert.throws(
    () => standaloneProblemType(new URLSearchParams("problemType=cinout"), supportedProblemTypes),
    /No local runtime is configured/,
  );
});
