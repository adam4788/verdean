import assert from "node:assert/strict";
import test from "node:test";

import { assertWorkspaceRequest, workspaceIdFromRequest } from "../lib/verdean/workspace-access.ts";

const id = "12f8c7f6-6078-4e4e-a6d0-6f7bb87aa210";

test("workspace API permits exact loopback same-origin requests", () => {
  assert.doesNotThrow(() => assertWorkspaceRequest(new Request(`http://localhost/api/workspaces?workspaceId=${id}`)));
  assert.doesNotThrow(() => assertWorkspaceRequest(new Request("http://127.0.0.1:3000/api/workspaces", {
    method: "PUT",
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
    body: "{}",
  }), true));
});

test("workspace API rejects remote hosts, cross-origin writes, and invalid IDs", () => {
  assert.throws(() => assertWorkspaceRequest(new Request("https://example.invalid/api/workspaces")), /local/i);
  assert.throws(() => assertWorkspaceRequest(new Request("http://localhost/api/workspaces", {
    method: "PUT",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: "{}",
  }), true), /same-origin/i);
  assert.throws(() => workspaceIdFromRequest(new Request("http://localhost/api/workspaces?workspaceId=../etc")), /workspace id/i);
  assert.equal(workspaceIdFromRequest(new Request(`http://localhost/api/workspaces?workspaceId=${id}`)), id);
});
