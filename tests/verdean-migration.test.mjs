import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../migrations/0001_verdean_workspaces.sql", import.meta.url);

function normalized(sql) {
  return sql.replace(/\s+/g, " ").toLowerCase();
}

test("Verdean D1 migration persists workspaces, documents, links, findings, decisions, and runs", async () => {
  const sql = normalized(await readFile(migrationUrl, "utf8"));
  for (const table of ["verdean_workspaces", "verdean_documents", "verdean_document_relationships", "verdean_findings", "verdean_review_decisions", "verdean_agent_runs"]) {
    assert.match(sql, new RegExp(`create table if not exists ${table}`));
  }
  assert.match(sql, /workspace_id text not null references verdean_workspaces\(id\) on delete cascade/);
  assert.match(sql, /snapshot_json text not null/);
});
