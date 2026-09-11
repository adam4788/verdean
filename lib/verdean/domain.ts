export type DocumentKind = "quote" | "invoice" | "contract" | "email" | "transcript" | "other" | "queued";
export type LocalDocument = { name: string; text: string; source?: "local" | "document-intelligence" };
export type ExtractedPage = { documentType: string; summary: string; fields: Array<{ label: string; value: string }> };
export type TextFileLike = { name: string; size?: number; text(): Promise<string> };
export type FileReadResult = { documents: LocalDocument[]; queued: { name: string; reason: string }[]; errors: { name: string; message: string }[] };
export type CommercialTerms = {
  unitPrice?: string; quantity?: string; deliveryDate?: string; payment?: string;
  warranty?: string; shipping?: string; restockingFee?: string;
};
export type AnalyzedDocument = LocalDocument & {
  kind: DocumentKind; quoteIds: string[]; invoiceIds: string[]; contractIds: string[]; parties: string[]; program?: string; terms: CommercialTerms;
};
export type Finding = { term: string; evidenceName: string; contractName: string; evidenceValue: string; contractValue: string; evidenceSnippet: string; contractSnippet: string };
export type ContractAnalysis = AnalyzedDocument & { referenceId?: string; linkedEvidence: AnalyzedDocument[]; confidence: number; confidenceReason: string[] };
export type AnalysisResult = { documents: AnalyzedDocument[]; contracts: ContractAnalysis[]; findings: Finding[]; pipeline: { status: "review-ready" | "queued" | "needs-contract"; message: string }; activity: string[] };

export const SUPPORTED_LOCAL_FILE = /\.(txt|csv|json)$/i;
export const MAX_LOCAL_FILES = 100;
export const MAX_LOCAL_FILE_BYTES = 2_000_000;
export function isIgnoredLocalFile(name: string): boolean {
  return /(?:^|[\\/])\.DS_Store$/i.test(name);
}
const termLabels: Record<keyof CommercialTerms, string> = { unitPrice: "Unit price", quantity: "Quantity", deliveryDate: "Delivery date", payment: "Payment terms", warranty: "Warranty", shipping: "Shipping", restockingFee: "Restocking fee" };
const lines = (text: string) => text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);
const matchOne = (text: string, expression: RegExp) => text.match(expression)?.[1]?.trim();
const clean = (value: string) => value.replace(/\s+/g, " ").replace(/[.,]$/, "").trim();

export function documentFromExtraction(name: string, pages: ExtractedPage[]): LocalDocument {
  const text = pages.flatMap((page, index) => [
    `Visual extraction page: ${index + 1}`,
    `Document type: ${page.documentType}`,
    `Summary: ${page.summary}`,
    ...page.fields.map((field) => `${field.label}: ${field.value}`),
  ]).join("\n");
  return { name, text, source: "document-intelligence" };
}

export async function readLocalFiles(files: Iterable<TextFileLike>, signal?: AbortSignal): Promise<FileReadResult> {
  const result: FileReadResult = { documents: [], queued: [], errors: [] };
  let seen = 0;
  for (const file of files) {
    if (isIgnoredLocalFile(file.name)) continue;
    seen += 1;
    if (signal?.aborted) {
      result.errors.push({ name: file.name, message: "Reading files was cancelled." });
      break;
    }
    if (!SUPPORTED_LOCAL_FILE.test(file.name)) {
      result.queued.push({ name: file.name, reason: "Unsupported file type; queued for manual review." });
      continue;
    }
    if (seen > MAX_LOCAL_FILES) {
      result.queued.push({ name: file.name, reason: `Folder exceeds the ${MAX_LOCAL_FILES}-file local read limit; queued for manual review.` });
      continue;
    }
    if (file.size !== undefined && file.size > MAX_LOCAL_FILE_BYTES) {
      result.queued.push({ name: file.name, reason: "File exceeds the 2 MB local read limit; queued for manual review." });
      continue;
    }
    try {
      const text = await file.text();
      if (signal?.aborted) {
        result.errors.push({ name: file.name, message: "Reading files was cancelled." });
        break;
      }
      result.documents.push({ name: file.name, text });
    } catch (cause) {
      result.errors.push({ name: file.name, message: cause instanceof Error ? cause.message : "Unable to read file." });
    }
  }
  return result;
}

export function classifyDocument(document: LocalDocument): DocumentKind {
  if (document.source !== "document-intelligence" && !SUPPORTED_LOCAL_FILE.test(document.name)) return "queued";
  const value = `${document.name}\n${document.text}`.toLowerCase();
  if (/^from:|^to:|^subject:/im.test(document.text)) return "email";
  if (/call transcript|participants:|\b\d{1,2}:\d{2}\b/.test(value)) return "transcript";
  if (/document type\s*:\s*(?:supplier )?invoice|invoice id|invoice number|supplier invoice|(?:^|[_-])invoice(?:[_-]|\.|$)/.test(value)) return "invoice";
  if (/document type\s*:\s*(?:executed )?contract|contract id|master supply|executed copy|signed (order|agreement)|commercial reference|(?:^|[_-])contract(?:[_-]|\.|$)/.test(value)) return "contract";
  if (/document type\s*:\s*(?:supplier )?(?:quote|quotation)|quote id|supplier quotation|quotation|(?:^|[_-])quote(?:[_-]|\.|$)/.test(value)) return "quote";
  return "other";
}

function firstLine(text: string, expression: RegExp): string | undefined { return lines(text).find((line) => expression.test(line)); }
function money(text: string): string | undefined {
  const pricePattern = /(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/;
  const isUnitLine = (line: string) => /unit\s+price|per\s+unit|unit\s+rate/i.test(line) && !/total/i.test(line);
  const unitLine = lines(text).find(isUnitLine);
  const unit = unitLine && matchOne(unitLine, /(?:unit\s+price(?: is)?|per\s+unit|unit\s+rate)\s*[:=]?\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (unit) return unit.replace(/,/g, "");
  const atLine = lines(text).find((line) => /\bat\b/i.test(line) && pricePattern.test(line) && !/total/i.test(line));
  return atLine && matchOne(atLine, /\bat\b\s*(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{2})?)/i)?.replace(/,/g, "");
}
function quantity(text: string): string | undefined { return matchOne(text, /(?:quantity\s*:\s*|provide\s+|with\s+the\s+)([\d,]+)(?:[- ]?unit|\s+nx-48)/i)?.replace(/,/g, ""); }
function dateValue(text: string): string | undefined { return matchOne(text, /delivery[^\n]*?\b([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i); }
function extractTerms(text: string): CommercialTerms {
  const delivery = dateValue(text);
  const payment = matchOne(text, /(Net\s*(?:\d+|forty[- ]five|thirty)[^\n.]*)/i);
  const warranty = matchOne(text, /((?:\d+|twenty[- ]four)\s*-?month warranty|warrant(?:y|ed)[^.\n]*?(?:\d+|twenty[- ]four)\s+months?[^.\n]*)/i);
  const shippingLine = firstLine(text, /freight|shipping/i);
  const feeLine = firstLine(text, /restocking|cancellation/i);
  return {
    unitPrice: money(text), quantity: quantity(text), deliveryDate: delivery,
    payment: payment && clean(payment), warranty: warranty && clean(warranty),
    shipping: shippingLine && clean(shippingLine), restockingFee: feeLine && clean(feeLine),
  };
}

export function analyzeDocument(document: LocalDocument): AnalyzedDocument {
  const text = document.text;
  const quoteIds = [...text.matchAll(/\b(Q-[\w-]+)\b/gi)].map((match) => match[1]!.toUpperCase());
  const invoiceIds = [...text.matchAll(/\b(INV-[\w-]+)\b/gi)].map((match) => match[1]!.toUpperCase());
  const contractIds = [...text.matchAll(/contract id\s*:\s*(C-[\w-]+)/gi)].map((match) => match[1]!.toUpperCase());
  const parties = [...text.matchAll(/(?:supplier|buyer)\s*:\s*([^\n]+)/gi)].map((match) => clean(match[1]!));
  const program = matchOne(text, /(?:opportunity|program)\s*:\s*([^\n]+)/i);
  return { ...document, kind: classifyDocument(document), quoteIds: [...new Set(quoteIds)], invoiceIds: [...new Set(invoiceIds)], contractIds: [...new Set(contractIds)], parties: [...new Set(parties)], program: program && clean(program), terms: extractTerms(text) };
}

function normalized(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
const termLabelPrefix = /^(?:warranty(?: terms?| period)?|freight(?: terms?)?|shipping(?: terms?)?|cancellation(?:\/restocking| restocking)? fee|restocking fee)\s*:\s*/i;
function comparableTermValue(value: string) {
  return normalized(value.replace(termLabelPrefix, ""));
}
function snippet(document: AnalyzedDocument, key: keyof CommercialTerms): string {
  const patterns: Record<keyof CommercialTerms, RegExp> = { unitPrice: /unit price|per unit/i, quantity: /quantity|provide|units?/i, deliveryDate: /delivery/i, payment: /payment|payable|net/i, warranty: /warrant/i, shipping: /freight|shipping/i, restockingFee: /restocking|cancellation/i };
  return firstLine(document.text, patterns[key]) ?? document.terms[key]?.slice(0, 160) ?? "Source term unavailable";
}
function evidenceFor(contract: AnalyzedDocument, documents: AnalyzedDocument[]) {
  const sources = documents.filter((document) => document !== contract && ["quote", "invoice", "email", "transcript"].includes(document.kind));
  return sources.filter((document) => {
    const sharedReference = document.quoteIds.some((id) => contract.quoteIds.includes(id));
    const sharedContractId = document.contractIds.some((id) => contract.contractIds.includes(id));
    const sharedParties = document.parties.filter((party) => contract.parties.some((contractParty) => normalized(contractParty) === normalized(party))).length;
    const sameProgram = Boolean(document.program && contract.program && normalized(document.program) === normalized(contract.program));
    return sharedReference || sharedContractId || sharedParties >= 2 || (sharedParties >= 1 && sameProgram);
  });
}

export function analyzeDocuments(input: LocalDocument[]): AnalysisResult {
  const documents = input.map(analyzeDocument);
  const contracts = documents.filter((document) => document.kind === "contract").map((contract): ContractAnalysis => {
    const linkedEvidence = evidenceFor(contract, documents);
    const sharedReference = linkedEvidence.some((document) => document.quoteIds.some((id) => contract.quoteIds.includes(id)));
    const sharedContractId = linkedEvidence.some((document) => document.contractIds.some((id) => contract.contractIds.includes(id)));
    const partyMatch = linkedEvidence.some((document) => document.parties.filter((party) => contract.parties.some((contractParty) => normalized(party) === normalized(contractParty))).length >= 2);
    const programMatch = linkedEvidence.some((document) => document.program && contract.program && normalized(document.program) === normalized(contract.program));
    const sharedId = sharedReference || sharedContractId;
    const confidence = Math.min(100, (sharedId ? 70 : 0) + (partyMatch ? (sharedId ? 15 : 35) : 0) + (programMatch ? (sharedId ? 15 : 30) : 0));
    const confidenceReason = [sharedReference && "shared quote/reference ID (+70)", sharedContractId && "shared contract ID (+70)", partyMatch && `shared parties (+${sharedId ? 15 : 35})`, programMatch && `shared program (+${sharedId ? 15 : 30})`].filter(Boolean) as string[];
    return { ...contract, referenceId: contract.quoteIds[0], linkedEvidence, confidence, confidenceReason };
  });
  const findings = contracts.flatMap((contract) => {
    const primary = contract.linkedEvidence.find((document) => document.kind === "quote")
      ?? contract.linkedEvidence.find((document) => document.kind === "invoice")
      ?? contract.linkedEvidence[0];
    if (!primary) return [];
    const baselines = [primary, ...contract.linkedEvidence.filter((document) => document.kind === "invoice" && document !== primary)];
    const seen = new Set<string>();
    return baselines.flatMap((baseline) => (Object.keys(termLabels) as (keyof CommercialTerms)[]).flatMap((key) => {
      const evidenceValue = baseline.terms[key]; const contractValue = contract.terms[key];
      if (!evidenceValue || !contractValue || comparableTermValue(evidenceValue) === comparableTermValue(contractValue)) return [];
      const duplicateKey = `${termLabels[key]}\u0000${comparableTermValue(evidenceValue)}\u0000${comparableTermValue(contractValue)}`;
      if (seen.has(duplicateKey)) return [];
      seen.add(duplicateKey);
      return [{ term: termLabels[key], evidenceName: baseline.name, contractName: contract.name, evidenceValue, contractValue, evidenceSnippet: snippet(baseline, key), contractSnippet: snippet(contract, key) }];
    }));
  });
  const queued = documents.filter((document) => document.kind === "queued");
  const ambiguousContracts = contracts.length > 1;
  const status = contracts.length === 0 ? "needs-contract" : ambiguousContracts || queued.length ? "queued" : "review-ready";
  const message = ambiguousContracts
    ? `${contracts.length} contracts found — select the governing contract before approval`
    : status === "review-ready"
      ? `${findings.length} discrepancies ready for review`
      : status === "queued"
        ? `${queued.length} unsupported file${queued.length === 1 ? "" : "s"} queued for review`
        : "Add a supported contract to compare";
  return { documents, contracts, findings, pipeline: { status, message }, activity: [`Read ${documents.filter((document) => document.kind !== "queued").length} supported files`, ...contracts.map((contract) => `Linked ${contract.linkedEvidence.length} evidence files to ${contract.name} at ${contract.confidence}% confidence`), ...(findings.length ? [`Detected ${findings.length} commercial discrepancies`] : [])] };
}
