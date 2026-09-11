import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDocuments } from "../lib/verdean/domain.ts";
import {
  MAX_WORKSPACE_ACTIVITY,
  MAX_WORKSPACE_SNAPSHOT_BYTES,
  parseWorkspaceSnapshot,
  prepareWorkspaceSnapshot,
} from "../lib/verdean/workspace.ts";

const workspaceId = "12f8c7f6-6078-4e4e-a6d0-6f7bb87aa210";
const quote = {
  name: "quote.txt",
  text: "Quote ID: Q-1\nSupplier: Acme\nBuyer: Buyer\nUnit price: USD 10.00",
};
const contract = {
  name: "contract.txt",
  text: "Contract ID: C-1\nCommercial reference: Q-1\nSupplier: Acme\nBuyer: Buyer\nUnit price: USD 12.00",
};

test("prepares a database snapshot without persisting raw source text", () => {
  const snapshot = prepareWorkspaceSnapshot({
    id: workspaceId,
    name: "Procurement / 2 documents",
    sourceMode: "folder",
    analysis: analyzeDocuments([quote, contract]),
    queuedFiles: [],
    resolvedQueueNames: new Set<string>(),
    selectedContractName: null,
    findingDispositions: {},
    approved: false,
    activity: ["Read 2 files"],
    organizationStatus: "Organized",
  });

  assert.equal(snapshot.analysis.documents.length, 2);
  assert.ok(snapshot.analysis.documents.every((document) => document.text === ""));
  assert.ok(snapshot.analysis.contracts.every((document) => document.text === ""));
  assert.ok(snapshot.analysis.contracts.flatMap((item) => item.linkedEvidence).every((document) => document.text === ""));
  assert.ok(snapshot.analysis.findings[0]?.evidenceSnippet);
  assert.equal(parseWorkspaceSnapshot(JSON.stringify(snapshot)).id, workspaceId);
});

test("bounds persisted activity and validates workspace identifiers", () => {
  const snapshot = prepareWorkspaceSnapshot({
    id: workspaceId,
    name: "Workspace",
    sourceMode: "files",
    analysis: analyzeDocuments([quote, contract]),
    queuedFiles: [],
    resolvedQueueNames: new Set<string>(),
    selectedContractName: null,
    findingDispositions: {},
    approved: true,
    activity: Array.from({ length: MAX_WORKSPACE_ACTIVITY + 10 }, (_, index) => `event-${index}`),
    organizationStatus: "Read only",
  });

  assert.equal(snapshot.activity.length, MAX_WORKSPACE_ACTIVITY);
  assert.throws(() => parseWorkspaceSnapshot(JSON.stringify({ ...snapshot, id: "../not-an-id" })), /workspace id/i);
  assert.throws(() => parseWorkspaceSnapshot("{}"), /workspace snapshot/i);
  assert.throws(() => parseWorkspaceSnapshot({ padding: "x".repeat(MAX_WORKSPACE_SNAPSHOT_BYTES + 1) }), /exceeds/);
});

test("bounds extracted fields before persistence", () => {
  const analysis = analyzeDocuments([quote, contract]);
  analysis.documents[0]!.program = "p".repeat(2_000);
  analysis.documents[0]!.terms.shipping = "s".repeat(2_000);
  const snapshot = prepareWorkspaceSnapshot({
    id: workspaceId,
    name: "Workspace",
    sourceMode: "files",
    analysis,
    queuedFiles: [],
    resolvedQueueNames: new Set<string>(),
    selectedContractName: null,
    findingDispositions: {},
    approved: false,
    activity: [],
    organizationStatus: "Read only",
  });

  assert.equal(snapshot.analysis.documents[0]?.program?.length, 500);
  assert.equal(snapshot.analysis.documents[0]?.terms.shipping?.length, 1_000);
});

test("removes macOS metadata from new and previously persisted workspaces", () => {
  const snapshot = prepareWorkspaceSnapshot({
    id: workspaceId,
    name: "Workspace",
    sourceMode: "folder",
    analysis: analyzeDocuments([quote, contract]),
    queuedFiles: [{ name: ".DS_Store", reason: "Unsupported" }],
    resolvedQueueNames: new Set([".DS_Store"]),
    selectedContractName: null,
    findingDispositions: {},
    approved: false,
    activity: ["Queued .DS_Store for manual review", "Read contract.txt"],
    organizationStatus: "Categorized",
  });

  assert.deepEqual(snapshot.queuedFiles, []);
  assert.deepEqual(snapshot.resolvedQueueNames, []);
  assert.deepEqual(snapshot.activity, ["Read contract.txt"]);

  const legacy = parseWorkspaceSnapshot({
    ...snapshot,
    queuedFiles: [{ name: "nested/.DS_Store", reason: "Unsupported" }],
    resolvedQueueNames: ["nested/.DS_Store"],
    activity: ["Queued nested/.DS_Store for manual review"],
  });
  assert.deepEqual(legacy.queuedFiles, []);
  assert.deepEqual(legacy.resolvedQueueNames, []);
  assert.deepEqual(legacy.activity, []);
});
