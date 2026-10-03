import { rm } from "node:fs/promises";
import test from "node:test";
import { compileFixture } from "./browser.mjs";
import { runChromePage } from "./chrome.mjs";

test("shared editor and VM sessions preserve changes and retire obsolete work", async () => {
    const directory = await compileFixture("./tests/session.mjs", "sessionTests");
    try {
        const url = `/build/${directory.split("/").pop()}/fixture.js`;
        await runChromePage(`<!doctype html><meta charset="UTF-8"><body><script src="${url}"></script><script>
            sessionTests.run().then(() => fetch("/result?status=pass"),
                error => fetch("/result?status=" + encodeURIComponent(error.stack)));
        </script>`, directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
