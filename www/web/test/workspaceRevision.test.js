import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceRevisionState } from "../scripts/workspaceRevision.ts";

test("saving an older snapshot does not clear edits made while it was in flight", () => {
  const revision = new WorkspaceRevisionState();
  revision.markLoaded();
  revision.markChanged();
  const inFlight = revision.capture();
  revision.markChanged();
  revision.markSaved(inFlight);

  assert.equal(revision.dirty, true);
  revision.markSaved(revision.capture());
  assert.equal(revision.dirty, false);
});
