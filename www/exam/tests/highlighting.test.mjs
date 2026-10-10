import { rm } from "node:fs/promises";
import test from "node:test";
import { compileFixture } from "./browser.mjs";
import { runChromePage } from "./chrome.mjs";

// Bundle the demo highlighter and run it in Chrome using a disposable profile.
test("assembler directive aliases and operands are highlighted", async () => {
    const directory = await compileFixture("./tests/highlighting.mjs", "highlightingTests");
    try {
        const url = `/build/${directory.split("/").pop()}/fixture.js`;
        await runChromePage(`<!doctype html><meta charset="UTF-8"><body><script src="${url}"></script><script>
            highlightingTests.run().then(() => fetch("/result?status=pass"),
                error => fetch("/result?status=" + encodeURIComponent(error.stack)));
        </script>`, directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
