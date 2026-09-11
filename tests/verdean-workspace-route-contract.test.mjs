import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/workspaces/route.ts", import.meta.url), "utf8");
const database = await readFile(new URL("../lib/verdean/database.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("workspace writes use compare-and-swap versions and reject stale clients", () => {
  assert.match(route, /x-workspace-version/);
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /Workspace changed in another tab/);
  assert.match(route, /409/);
  assert.match(database, /WHERE \? <> '' AND verdean_workspaces\.updated_at = \?/);
  assert.match(database, /WHERE EXISTS \(SELECT 1 FROM verdean_workspaces WHERE id = \? AND updated_at = \?\)/);
  assert.match(page, /databaseVersionRef/);
  assert.match(page, /"x-workspace-version": databaseVersionRef\.current/);
});

test("a stale hydration 404 cannot clear a newly selected workspace", () => {
  assert.match(page, /if \(response\.status === 404\) \{\s*if \(generation !== persistenceGenerationRef\.current\) return;/);
});

test("workspace reset deletes durable state and returns to the disconnected landing page", () => {
  assert.match(route, /export async function DELETE\(request: Request\)/);
  assert.match(route, /deleteWorkspace\(getD1\(\), workspaceId\)/);
  assert.match(database, /export async function deleteWorkspace/);
  assert.match(database, /DELETE FROM verdean_review_decisions/);
  assert.match(database, /DELETE FROM verdean_documents/);
  assert.match(database, /DELETE FROM verdean_workspaces/);
  assert.match(page, /searchParams\.get\("reset"\) === "1"/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /Start over/);
  assert.match(page, /window\.location\.replace\("\/"\)/);
});
