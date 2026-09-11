import { isIgnoredLocalFile, type AnalysisResult, type AnalyzedDocument } from "./domain.ts";

export const WORKSPACE_SCHEMA_VERSION = 1 as const;
export const MAX_WORKSPACE_ACTIVITY = 200;
export const MAX_PERSISTED_DOCUMENTS = 100;
export const MAX_PERSISTED_FINDINGS = 70;
export const MAX_PERSISTED_RELATIONSHIPS = 70;
export const MAX_WORKSPACE_SNAPSHOT_BYTES = 900_000;

export type FindingDisposition = "accept-change" | "fix-contract" | "legal-review";
export type WorkspaceSourceMode = "folder" | "files" | "database";
export type PersistedQueuedFile = { name: string; reason: string };

export type WorkspaceSnapshot = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  id: string;
  name: string;
  sourceMode: WorkspaceSourceMode;
  updatedAt: string;
  analysis: AnalysisResult;
  queuedFiles: PersistedQueuedFile[];
  resolvedQueueNames: string[];
  selectedContractName: string | null;
  findingDispositions: Record<string, FindingDisposition>;
  approved: boolean;
  activity: string[];
  organizationStatus: string;
};

export type WorkspaceSnapshotInput = Omit<WorkspaceSnapshot, "schemaVersion" | "updatedAt" | "resolvedQueueNames" | "analysis"> & {
  analysis: AnalysisResult;
  resolvedQueueNames: Iterable<string>;
};

const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(["quote", "invoice", "contract", "email", "transcript", "other", "queued"]);
const dispositions = new Set<FindingDisposition>(["accept-change", "fix-contract", "legal-review"]);

function bounded(value: string, maximum = 500) {
  return value.slice(0, maximum);
}

function mentionsIgnoredMetadata(value: string): boolean {
  return /(?:^|[\\/\s])\.DS_Store(?:$|[\s:])/i.test(value);
}

function withoutIgnoredMetadata(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    analysis: {
      ...snapshot.analysis,
      documents: snapshot.analysis.documents.filter((document) => !isIgnoredLocalFile(document.name)),
      contracts: snapshot.analysis.contracts
        .filter((contract) => !isIgnoredLocalFile(contract.name))
        .map((contract) => ({ ...contract, linkedEvidence: contract.linkedEvidence.filter((document) => !isIgnoredLocalFile(document.name)) })),
      findings: snapshot.analysis.findings.filter((finding) => !isIgnoredLocalFile(finding.evidenceName) && !isIgnoredLocalFile(finding.contractName)),
      activity: snapshot.analysis.activity.filter((item) => !mentionsIgnoredMetadata(item)),
    },
    queuedFiles: snapshot.queuedFiles.filter((item) => !isIgnoredLocalFile(item.name)),
    resolvedQueueNames: snapshot.resolvedQueueNames.filter((name) => !isIgnoredLocalFile(name)),
    findingDispositions: Object.fromEntries(Object.entries(snapshot.findingDispositions).filter(([key]) => !mentionsIgnoredMetadata(key))),
    activity: snapshot.activity.filter((item) => !mentionsIgnoredMetadata(item)),
  };
}

function withoutSourceText(document: AnalyzedDocument): AnalyzedDocument {
  return {
    ...document,
    name: bounded(document.name),
    text: "",
    quoteIds: document.quoteIds.slice(0, MAX_PERSISTED_DOCUMENTS).map((value) => bounded(value, 200)),
    invoiceIds: document.invoiceIds.slice(0, MAX_PERSISTED_DOCUMENTS).map((value) => bounded(value, 200)),
    contractIds: document.contractIds.slice(0, MAX_PERSISTED_DOCUMENTS).map((value) => bounded(value, 200)),
    parties: document.parties.slice(0, MAX_PERSISTED_DOCUMENTS).map((value) => bounded(value)),
    program: document.program ? bounded(document.program) : undefined,
    terms: Object.fromEntries(Object.entries(document.terms).flatMap(([key, value]) => typeof value === "string" ? [[key, bounded(value, 1_000)]] : [])),
  };
}

function sanitizedAnalysis(analysis: AnalysisResult): AnalysisResult {
  let relationshipBudget = MAX_PERSISTED_RELATIONSHIPS;
  const contracts = analysis.contracts.slice(0, MAX_PERSISTED_DOCUMENTS).map((contract) => {
    const linkedEvidence = contract.linkedEvidence.slice(0, relationshipBudget).map(withoutSourceText);
    relationshipBudget -= linkedEvidence.length;
    return {
      ...withoutSourceText(contract),
      referenceId: contract.referenceId,
      linkedEvidence,
      confidence: contract.confidence,
      confidenceReason: [...contract.confidenceReason],
    };
  });
  return {
    documents: analysis.documents.slice(0, MAX_PERSISTED_DOCUMENTS).map(withoutSourceText),
    contracts,
    findings: analysis.findings.slice(0, MAX_PERSISTED_FINDINGS).map((finding) => ({
      term: bounded(finding.term),
      evidenceName: bounded(finding.evidenceName),
      contractName: bounded(finding.contractName),
      evidenceValue: bounded(finding.evidenceValue, 1_000),
      contractValue: bounded(finding.contractValue, 1_000),
      evidenceSnippet: bounded(finding.evidenceSnippet, 1_000),
      contractSnippet: bounded(finding.contractSnippet, 1_000),
    })),
    pipeline: { ...analysis.pipeline },
    activity: analysis.activity.slice(0, MAX_WORKSPACE_ACTIVITY),
  };
}

export function prepareWorkspaceSnapshot(input: WorkspaceSnapshotInput): WorkspaceSnapshot {
  return parseWorkspaceSnapshot({
    ...input,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    analysis: sanitizedAnalysis(input.analysis),
    queuedFiles: input.queuedFiles.filter((item) => !isIgnoredLocalFile(item.name)).slice(0, MAX_PERSISTED_DOCUMENTS).map((item) => ({ ...item })),
    resolvedQueueNames: [...input.resolvedQueueNames].filter((name) => !isIgnoredLocalFile(name)).slice(0, MAX_PERSISTED_DOCUMENTS),
    activity: input.activity.filter((item) => !mentionsIgnoredMetadata(item)).slice(0, MAX_WORKSPACE_ACTIVITY),
    findingDispositions: { ...input.findingDispositions },
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum = 1_000): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} must be a string no longer than ${maximum} characters.`);
  return value;
}

function stringArray(value: unknown, label: string, maximumItems = MAX_PERSISTED_DOCUMENTS): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) throw new Error(`${label} must contain at most ${maximumItems} values.`);
  return value.map((item, index) => string(item, `${label}[${index}]`));
}

function assertAnalyzedDocument(value: unknown, label: string): asserts value is AnalyzedDocument {
  const item = object(value, label);
  string(item.name, `${label}.name`, 500);
  if (item.text !== "") throw new Error(`${label}.text must be empty; raw source text is not persisted.`);
  if (!kinds.has(String(item.kind))) throw new Error(`${label}.kind is invalid.`);
  stringArray(item.quoteIds, `${label}.quoteIds`);
  stringArray(item.invoiceIds, `${label}.invoiceIds`);
  stringArray(item.contractIds, `${label}.contractIds`);
  stringArray(item.parties, `${label}.parties`);
  if (item.program !== undefined) string(item.program, `${label}.program`, 500);
  if (item.source !== undefined && !new Set(["local", "document-intelligence"]).has(String(item.source))) throw new Error(`${label}.source is invalid.`);
  const terms = object(item.terms, `${label}.terms`);
  for (const [key, value] of Object.entries(terms)) {
    if (!new Set(["unitPrice", "quantity", "deliveryDate", "payment", "warranty", "shipping", "restockingFee"]).has(key)) throw new Error(`${label}.terms.${key} is invalid.`);
    string(value, `${label}.terms.${key}`, 1_000);
  }
}

function assertAnalysis(value: unknown): asserts value is AnalysisResult {
  const analysis = object(value, "analysis");
  if (!Array.isArray(analysis.documents) || analysis.documents.length > MAX_PERSISTED_DOCUMENTS) throw new Error("analysis.documents is invalid.");
  analysis.documents.forEach((item, index) => assertAnalyzedDocument(item, `analysis.documents[${index}]`));
  if (!Array.isArray(analysis.contracts) || analysis.contracts.length > MAX_PERSISTED_DOCUMENTS) throw new Error("analysis.contracts is invalid.");
  let relationshipCount = 0;
  analysis.contracts.forEach((value, index) => {
    assertAnalyzedDocument(value, `analysis.contracts[${index}]`);
    const item = value as unknown as Record<string, unknown>;
    if (!Array.isArray(item.linkedEvidence) || item.linkedEvidence.length > MAX_PERSISTED_DOCUMENTS) throw new Error(`analysis.contracts[${index}].linkedEvidence is invalid.`);
    relationshipCount += item.linkedEvidence.length;
    item.linkedEvidence.forEach((evidence, evidenceIndex) => assertAnalyzedDocument(evidence, `analysis.contracts[${index}].linkedEvidence[${evidenceIndex}]`));
    if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 100) throw new Error(`analysis.contracts[${index}].confidence is invalid.`);
    stringArray(item.confidenceReason, `analysis.contracts[${index}].confidenceReason`, 10);
  });
  if (relationshipCount > MAX_PERSISTED_RELATIONSHIPS) throw new Error("analysis has too many document relationships.");
  if (!Array.isArray(analysis.findings) || analysis.findings.length > MAX_PERSISTED_FINDINGS) throw new Error("analysis.findings is invalid.");
  for (const [index, value] of analysis.findings.entries()) {
    const item = object(value, `analysis.findings[${index}]`);
    for (const key of ["term", "evidenceName", "contractName", "evidenceValue", "contractValue", "evidenceSnippet", "contractSnippet"]) string(item[key], `analysis.findings[${index}].${key}`, 4_000);
  }
  const pipeline = object(analysis.pipeline, "analysis.pipeline");
  if (!new Set(["review-ready", "queued", "needs-contract"]).has(String(pipeline.status))) throw new Error("analysis.pipeline.status is invalid.");
  string(pipeline.message, "analysis.pipeline.message");
  stringArray(analysis.activity, "analysis.activity", MAX_WORKSPACE_ACTIVITY);
}

export function parseWorkspaceSnapshot(input: string | unknown): WorkspaceSnapshot {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try { parsed = JSON.parse(input); } catch { throw new Error("Workspace snapshot must be valid JSON."); }
  }
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_WORKSPACE_SNAPSHOT_BYTES) {
    throw new Error(`Workspace snapshot exceeds ${MAX_WORKSPACE_SNAPSHOT_BYTES} bytes.`);
  }
  const value = object(parsed, "Workspace snapshot");
  if (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error("Workspace snapshot schema version is unsupported.");
  const id = string(value.id, "Workspace id", 64);
  if (!workspaceId.test(id)) throw new Error("Workspace id must be a UUID.");
  const name = string(value.name, "Workspace name", 200).trim();
  if (!name) throw new Error("Workspace name is required.");
  if (!new Set(["folder", "files", "database"]).has(String(value.sourceMode))) throw new Error("Workspace source mode is invalid.");
  const updatedAt = string(value.updatedAt, "Workspace updatedAt", 64);
  if (!Number.isFinite(Date.parse(updatedAt))) throw new Error("Workspace updatedAt is invalid.");
  assertAnalysis(value.analysis);
  if (!Array.isArray(value.queuedFiles) || value.queuedFiles.length > MAX_PERSISTED_DOCUMENTS) throw new Error("Workspace queuedFiles is invalid.");
  value.queuedFiles.forEach((item, index) => {
    const queued = object(item, `Workspace queuedFiles[${index}]`);
    string(queued.name, `Workspace queuedFiles[${index}].name`, 500);
    string(queued.reason, `Workspace queuedFiles[${index}].reason`, 2_000);
  });
  stringArray(value.resolvedQueueNames, "Workspace resolvedQueueNames");
  if (value.selectedContractName !== null) string(value.selectedContractName, "Workspace selectedContractName", 500);
  const dispositionMap = object(value.findingDispositions, "Workspace findingDispositions");
  if (Object.keys(dispositionMap).length > MAX_PERSISTED_FINDINGS) throw new Error("Workspace findingDispositions has too many values.");
  for (const [key, disposition] of Object.entries(dispositionMap)) {
    string(key, "Workspace finding disposition key", 2_000);
    if (!dispositions.has(disposition as FindingDisposition)) throw new Error("Workspace finding disposition is invalid.");
  }
  if (typeof value.approved !== "boolean") throw new Error("Workspace approved must be boolean.");
  stringArray(value.activity, "Workspace activity", MAX_WORKSPACE_ACTIVITY);
  string(value.organizationStatus, "Workspace organizationStatus", 2_000);
  return withoutIgnoredMetadata(value as WorkspaceSnapshot);
}
