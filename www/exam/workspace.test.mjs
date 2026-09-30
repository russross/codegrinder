import assert from "node:assert/strict";
import test from "node:test";

import { ProblemWorkspace } from "./workspace.ts";

const encode = (text) => new TextEncoder().encode(text);

test("step-start refresh preserves local work and reset reaches the running VM filesystem", () => {
    const starter = encode("starter\n");
    const workspace = new ProblemWorkspace(
        new Map([["Makefile", encode("old system\n")]]),
        new Map([["first.c", starter], ["second.c", starter]]),
    );
    workspace.writeStudentFile("first.c", encode("editor work\n"));
    workspace.filesystem.writeFile("second.c", encode("VM work\n"), "guest");
    workspace.refreshFromServer(
        new Map([["Makefile", encode("new system\n")]]),
        new Map([["first.c", starter], ["second.c", starter]]),
    );
    assert.deepEqual(workspace.studentSubmission(), {
        "first.c": encode("editor work\n"),
        "second.c": encode("VM work\n"),
    });
    assert.deepEqual(workspace.filesystem.readFile("Makefile"), { kind: "ok", value: encode("new system\n") });
    const beforeReset = workspace.revision();
    assert.equal(workspace.writeStudentFile("first.c", starter), undefined);
    assert.ok(workspace.revision() > beforeReset);
    assert.deepEqual(workspace.filesystem.readFile("first.c"), { kind: "ok", value: starter });
    assert.deepEqual(workspace.studentSubmission(), {
        "first.c": starter,
        "second.c": encode("VM work\n"),
    });
    workspace.filesystem.writeFile("first.c", encode("later VM work\n"), "guest");
    assert.deepEqual(workspace.readVisibleFile("first.c"), encode("later VM work\n"));
});
