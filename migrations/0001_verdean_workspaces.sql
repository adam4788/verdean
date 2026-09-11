PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verdean_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_mode TEXT NOT NULL CHECK (source_mode IN ('folder', 'files', 'database')),
  status TEXT NOT NULL,
  selected_contract_name TEXT,
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  document_count INTEGER NOT NULL DEFAULT 0,
  finding_count INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verdean_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('quote', 'invoice', 'contract', 'email', 'transcript', 'other', 'queued')),
  source TEXT,
  quote_ids_json TEXT NOT NULL,
  invoice_ids_json TEXT NOT NULL,
  contract_ids_json TEXT NOT NULL,
  parties_json TEXT NOT NULL,
  program TEXT,
  terms_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, name)
);

CREATE TABLE IF NOT EXISTS verdean_document_relationships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  contract_document_id TEXT NOT NULL REFERENCES verdean_documents(id) ON DELETE CASCADE,
  evidence_document_id TEXT NOT NULL REFERENCES verdean_documents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasons_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, contract_document_id, evidence_document_id)
);

CREATE TABLE IF NOT EXISTS verdean_findings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  contract_document_id TEXT REFERENCES verdean_documents(id) ON DELETE SET NULL,
  evidence_document_id TEXT REFERENCES verdean_documents(id) ON DELETE SET NULL,
  term TEXT NOT NULL,
  evidence_value TEXT NOT NULL,
  contract_value TEXT NOT NULL,
  evidence_snippet TEXT NOT NULL,
  contract_snippet TEXT NOT NULL,
  disposition TEXT CHECK (disposition IN ('accept-change', 'fix-contract', 'legal-review')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verdean_review_decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('accept-change', 'fix-contract', 'legal-review')),
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, finding_key)
);

CREATE TABLE IF NOT EXISTS verdean_agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES verdean_workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  organization_status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS verdean_documents_workspace_idx ON verdean_documents(workspace_id, kind);
CREATE INDEX IF NOT EXISTS verdean_relationships_workspace_idx ON verdean_document_relationships(workspace_id);
CREATE INDEX IF NOT EXISTS verdean_findings_workspace_idx ON verdean_findings(workspace_id, term);
CREATE INDEX IF NOT EXISTS verdean_decisions_workspace_idx ON verdean_review_decisions(workspace_id);
CREATE INDEX IF NOT EXISTS verdean_workspaces_updated_idx ON verdean_workspaces(updated_at DESC);
