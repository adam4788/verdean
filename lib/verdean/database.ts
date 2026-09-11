import type { WorkspaceSnapshot } from "./workspace.ts";

export const VERDEAN_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS verdean_workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('folder', 'files', 'database')),
  status TEXT NOT NULL, selected_contract_name TEXT,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  document_count INTEGER NOT NULL DEFAULT 0, finding_count INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verdean_documents (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'invoice', 'contract', 'email', 'transcript', 'other', 'queued')),
  source TEXT, quote_ids_json TEXT NOT NULL,
  invoice_ids_json TEXT NOT NULL, contract_ids_json TEXT NOT NULL, parties_json TEXT NOT NULL,
  program TEXT, terms_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id, name)
);
CREATE TABLE IF NOT EXISTS verdean_document_relationships (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  contract_document_id TEXT NOT NULL REFERENCES verdean_documents(id) ON DELETE CASCADE,
  evidence_document_id TEXT NOT NULL REFERENCES verdean_documents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100), reasons_json TEXT NOT NULL,
  updated_at TEXT NOT NULL, UNIQUE(workspace_id, contract_document_id, evidence_document_id)
);
CREATE TABLE IF NOT EXISTS verdean_findings (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  contract_document_id TEXT REFERENCES verdean_documents(id) ON DELETE SET NULL,
  evidence_document_id TEXT REFERENCES verdean_documents(id) ON DELETE SET NULL,
  term TEXT NOT NULL, evidence_value TEXT NOT NULL, contract_value TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL, contract_snippet TEXT NOT NULL,
  disposition TEXT CHECK (disposition IN ('accept-change', 'fix-contract', 'legal-review')),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verdean_review_decisions (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('accept-change', 'fix-contract', 'legal-review')),
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, finding_key)
);
CREATE TABLE IF NOT EXISTS verdean_agent_runs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL, activity_json TEXT NOT NULL, organization_status TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS verdean_documents_workspace_idx ON verdean_documents(workspace_id, kind);
CREATE INDEX IF NOT EXISTS verdean_relationships_workspace_idx ON verdean_document_relationships(workspace_id);
CREATE INDEX IF NOT EXISTS verdean_findings_workspace_idx ON verdean_findings(workspace_id, term);
CREATE INDEX IF NOT EXISTS verdean_decisions_workspace_idx ON verdean_review_decisions(workspace_id);
CREATE INDEX IF NOT EXISTS verdean_workspaces_updated_idx ON verdean_workspaces(updated_at DESC);
`;

let schemaReady: Promise<unknown> | undefined;

export async function ensureVerdeanSchema(db: D1Database) {
  const statements = VERDEAN_SCHEMA_SQL
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  schemaReady ??= db.batch(statements).catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  await schemaReady;
}

function documentId(workspaceId: string, index: number) {
  return `${workspaceId}:document:${index}`;
}

function findingKey(finding: WorkspaceSnapshot["analysis"]["findings"][number]) {
  return `${finding.contractName}|${finding.evidenceName}|${finding.term}`;
}

type SqlValue = string | number | null;

function bulkInserts(db: D1Database, table: string, columns: string[], rows: SqlValue[][], guard: { workspaceId: string; version: string }) {
  if (rows.length === 0) return [];
  const rowsPerStatement = Math.max(1, Math.floor((100 - 2) / columns.length));
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < rows.length; index += rowsPerStatement) {
    const batch = rows.slice(index, index + rowsPerStatement);
    const placeholders = batch.map(() => `(${columns.map(() => "?").join(", ")})`).join(", ");
    statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(", ")})
      SELECT * FROM (VALUES ${placeholders})
      WHERE EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)`)
      .bind(...batch.flat(), guard.workspaceId, guard.version));
  }
  return statements;
}

export async function saveWorkspaceSnapshot(db: D1Database, snapshot: WorkspaceSnapshot, expectedVersion: string, newVersion: string) {
  await ensureVerdeanSchema(db);
  const guard = { workspaceId: snapshot.id, version: newVersion };
  const documentIds = new Map(snapshot.analysis.documents.map((document, index) => [document.name, documentId(snapshot.id, index)]));
  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO verdean_workspaces (
      id, name, source_mode, status, selected_contract_name, approved, document_count,
      finding_count, snapshot_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, source_mode = excluded.source_mode, status = excluded.status,
      selected_contract_name = excluded.selected_contract_name, approved = excluded.approved,
      document_count = excluded.document_count, finding_count = excluded.finding_count,
      snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at
    WHERE ? <> '' AND verdean_workspaces.updated_at = ?`)
      .bind(
        snapshot.id, snapshot.name, snapshot.sourceMode, snapshot.analysis.pipeline.status,
        snapshot.selectedContractName, snapshot.approved ? 1 : 0, snapshot.analysis.documents.length,
        snapshot.analysis.findings.length, JSON.stringify(snapshot), snapshot.updatedAt, newVersion,
        expectedVersion, expectedVersion,
      ),
    db.prepare("DELETE FROM verdean_agent_runs WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)").bind(snapshot.id, snapshot.id, newVersion),
    db.prepare("DELETE FROM verdean_review_decisions WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)").bind(snapshot.id, snapshot.id, newVersion),
    db.prepare("DELETE FROM verdean_findings WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)").bind(snapshot.id, snapshot.id, newVersion),
    db.prepare("DELETE FROM verdean_document_relationships WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)").bind(snapshot.id, snapshot.id, newVersion),
    db.prepare("DELETE FROM verdean_documents WHERE workspace_id = ? AND EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)").bind(snapshot.id, snapshot.id, newVersion),
  ];

  const documentRows = snapshot.analysis.documents.map((document, index): SqlValue[] => [
    documentId(snapshot.id, index), snapshot.id, document.name, document.kind, document.source ?? null,
    JSON.stringify(document.quoteIds), JSON.stringify(document.invoiceIds), JSON.stringify(document.contractIds),
    JSON.stringify(document.parties), document.program ?? null, JSON.stringify(document.terms), snapshot.updatedAt,
  ]);
  statements.push(...bulkInserts(db, "verdean_documents", [
    "id", "workspace_id", "name", "kind", "source", "quote_ids_json", "invoice_ids_json",
    "contract_ids_json", "parties_json", "program", "terms_json", "updated_at",
  ], documentRows, guard));

  const relationshipRows: SqlValue[][] = [];
  for (const [contractIndex, contract] of snapshot.analysis.contracts.entries()) {
    const contractDocumentId = documentIds.get(contract.name);
    if (!contractDocumentId) continue;
    for (const [evidenceIndex, evidence] of contract.linkedEvidence.entries()) {
      const evidenceDocumentId = documentIds.get(evidence.name);
      if (!evidenceDocumentId) continue;
      relationshipRows.push([
        `${snapshot.id}:relationship:${contractIndex}:${evidenceIndex}`, snapshot.id,
        contractDocumentId, evidenceDocumentId, `${evidence.kind}-to-contract`, contract.confidence,
        JSON.stringify(contract.confidenceReason), snapshot.updatedAt,
      ]);
    }
  }
  statements.push(...bulkInserts(db, "verdean_document_relationships", [
    "id", "workspace_id", "contract_document_id", "evidence_document_id", "relationship_type",
    "confidence", "reasons_json", "updated_at",
  ], relationshipRows, guard));

  const findingRows = snapshot.analysis.findings.map((finding, index): SqlValue[] => [
    `${snapshot.id}:finding:${index}`, snapshot.id, documentIds.get(finding.contractName) ?? null,
    documentIds.get(finding.evidenceName) ?? null, finding.term, finding.evidenceValue,
    finding.contractValue, finding.evidenceSnippet, finding.contractSnippet,
    snapshot.findingDispositions[findingKey(finding)] ?? null, snapshot.updatedAt,
  ]);
  statements.push(...bulkInserts(db, "verdean_findings", [
    "id", "workspace_id", "contract_document_id", "evidence_document_id", "term", "evidence_value",
    "contract_value", "evidence_snippet", "contract_snippet", "disposition", "updated_at",
  ], findingRows, guard));

  const decisionRows = Object.entries(snapshot.findingDispositions).map(([key, disposition], index): SqlValue[] => [
    `${snapshot.id}:decision:${index}`, snapshot.id, key, disposition, snapshot.updatedAt,
  ]);
  statements.push(...bulkInserts(db, "verdean_review_decisions", [
    "id", "workspace_id", "finding_key", "disposition", "updated_at",
  ], decisionRows, guard));

  statements.push(db.prepare(`INSERT INTO verdean_agent_runs (
    id, workspace_id, status, activity_json, organization_status, updated_at
  ) SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM verdean_workspaces WHERE id = ? AND updated_at = ?)`)
    .bind(
      `${snapshot.id}:latest`, snapshot.id, snapshot.analysis.pipeline.status,
      JSON.stringify(snapshot.activity), snapshot.organizationStatus, snapshot.updatedAt,
      snapshot.id, newVersion,
    ));
  await db.batch(statements);
}

export async function readWorkspaceSnapshot(db: D1Database, id: string) {
  await ensureVerdeanSchema(db);
  return db.prepare("SELECT snapshot_json, updated_at FROM verdean_workspaces WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ snapshot_json: string; updated_at: string }>();
}

export async function deleteWorkspace(db: D1Database, id: string) {
  await ensureVerdeanSchema(db);
  await db.batch([
    db.prepare("DELETE FROM verdean_agent_runs WHERE workspace_id = ?").bind(id),
    db.prepare("DELETE FROM verdean_review_decisions WHERE workspace_id = ?").bind(id),
    db.prepare("DELETE FROM verdean_findings WHERE workspace_id = ?").bind(id),
    db.prepare("DELETE FROM verdean_document_relationships WHERE workspace_id = ?").bind(id),
    db.prepare("DELETE FROM verdean_documents WHERE workspace_id = ?").bind(id),
    db.prepare("DELETE FROM verdean_workspaces WHERE id = ?").bind(id),
  ]);
}

export async function readWorkspaceCounts(db: D1Database, id: string) {
  await ensureVerdeanSchema(db);
  const count = async (table: string) => {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ?`)
      .bind(id)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  };
  const [documents, relationships, findings, decisions, runs] = await Promise.all([
    count("verdean_documents"),
    count("verdean_document_relationships"),
    count("verdean_findings"),
    count("verdean_review_decisions"),
    count("verdean_agent_runs"),
  ]);
  return { documents, relationships, findings, decisions, runs };
}
