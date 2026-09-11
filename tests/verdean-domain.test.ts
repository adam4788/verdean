import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDocuments, classifyDocument, documentFromExtraction, isIgnoredLocalFile, readLocalFiles, type LocalDocument } from "../lib/verdean/domain.ts";

const quote = `SUPPLIER QUOTATION
Quote ID: Q-2026-0842
Supplier: Example Supplier Co.
Buyer: Example Buyer Co.
Opportunity: NX-48 Charging Module Program
Quantity: 1,200 units
Unit price: USD 46.80
Delivery date: October 15, 2026
Payment terms: Net 45 from invoice date
Freight: Expedited ground freight included
Warranty: 24 months from delivery
Cancellation/restocking fee: None before production release`;

const email = `Subject: RE: Q-2026-0842 — NX-48 modules
Example Buyer Co.
We can proceed with the 1,200-unit quotation at $46.80 per unit, delivery by October 15, and Net 45 payment terms. Please make sure the included expedited freight and 24-month warranty are reflected. There should be no cancellation or restocking fee before production release.`;

const transcript = `CALL TRANSCRIPT — NX-48 COMMERCIAL REVIEW
Participants: Buyer Reviewer (Example Buyer Co.), Supplier Reviewer (Example Supplier Co.)
Reference: Quote Q-2026-0842
Confirmed: twelve hundred units at forty-six dollars and eighty cents each.
We can deliver the full quantity no later than October fifteenth.
Expedited ground freight remains included. Net forty-five and a twenty-four month warranty are unchanged. No restocking or cancellation fee before production release.`;

const invoice = `SUPPLIER INVOICE
Invoice ID: INV-2026-418
Quote reference: Q-2026-0842
Supplier: Example Supplier Co.
Buyer: Example Buyer Co.
Program: NX-48 Charging Module Program
Quantity: 1,200 units
Unit price: USD 46.80
Payment terms: Net 45 from invoice date`;

const contract = `MASTER SUPPLY ORDER — EXECUTED COPY
Contract ID: C-2026-311
Commercial reference: Q-2026-0842
Supplier: Example Supplier Co.
Buyer: Example Buyer Co.
Program: NX-48 Charging Module Program
Supplier will provide 1,000 NX-48 charging control modules.
Unit price is USD 49.20.
Delivery will occur on or before November 1, 2026. Expedited freight will be invoiced separately to Buyer.
Invoices are payable Net 30 from invoice date.
Goods are warranted for 12 months from delivery.
Orders cancelled before production release are subject to a 15% restocking fee.`;

function document(name: string, text: string): LocalDocument {
  return { name, text };
}

test("classifies supported documents from filename and commercial content", () => {
  assert.equal(classifyDocument(document("uploaded.txt", quote)), "quote");
  assert.equal(classifyDocument(document("notes.txt", email)), "email");
  assert.equal(classifyDocument(document("record.txt", transcript)), "transcript");
  assert.equal(classifyDocument(document("supplier-invoice.txt", invoice)), "invoice");
  assert.equal(classifyDocument(document("agreement.txt", contract)), "contract");
  assert.equal(classifyDocument(document("scan.pdf", "")), "queued");
});

test("links invoices into the contract evidence chain", () => {
  const result = analyzeDocuments([
    document("01_supplier_quote.txt", quote),
    document("02_supplier_invoice.txt", invoice),
    document("03_signed_contract.txt", contract),
  ]);

  assert.equal(result.contracts[0]?.linkedEvidence.length, 2);
  assert.ok(result.contracts[0]?.linkedEvidence.some((evidence) => evidence.kind === "invoice"));
  assert.equal(result.contracts[0]?.confidence, 100);
});

test("links an invoice that references only the governing contract ID", () => {
  const contractReferencedInvoice = `SUPPLIER INVOICE
Invoice ID: INV-2026-419
Contract ID: C-2026-311
Supplier: Example Supplier Co.
Unit price: USD 47.10`;
  const result = analyzeDocuments([
    document("supplier-invoice.txt", contractReferencedInvoice),
    document("signed-contract.txt", contract),
  ]);

  assert.equal(result.contracts[0]?.linkedEvidence[0]?.kind, "invoice");
  assert.ok(result.findings.some((finding) => finding.evidenceName === "supplier-invoice.txt" && finding.term === "Unit price"));
});

test("uses an invoice as the comparison baseline when no quote exists", () => {
  const result = analyzeDocuments([
    document("supplier-invoice.txt", invoice),
    document("signed-contract.txt", contract),
  ]);

  assert.equal(result.contracts[0]?.linkedEvidence[0]?.kind, "invoice");
  assert.ok(result.findings.some((finding) => finding.evidenceName === "supplier-invoice.txt" && finding.term === "Unit price"));
});

test("surfaces an invoice value that differs from both the quote and contract", () => {
  const changedInvoice = invoice.replace("USD 46.80", "USD 47.10");
  const result = analyzeDocuments([
    document("supplier-quote.txt", quote),
    document("supplier-invoice.txt", changedInvoice),
    document("signed-contract.txt", contract),
  ]);

  assert.ok(result.findings.some((finding) => finding.evidenceName === "supplier-invoice.txt" && finding.term === "Unit price" && finding.evidenceValue === "47.10"));
});

test("does not mistake evidence that mentions a contract for the signed contract", () => {
  assert.equal(classifyDocument(document("buyer-email.txt", "From: buyer@example.test\nSubject: Quote Q-2026-0842\nPlease reflect this in the final contract package.")), "email");
  assert.equal(classifyDocument(document("call-transcript.txt", "CALL TRANSCRIPT\nParticipants: Buyer, Supplier\nWe will use the quote in the final contract.")), "transcript");
});

test("analyzes linked commercial evidence and emits deterministic contract discrepancies", () => {
  const result = analyzeDocuments([
    document("01_supplier_quote.txt", quote),
    document("02_buyer_email.txt", email),
    document("03_call_transcript.txt", transcript),
    document("04_signed_contract.txt", contract),
  ]);

  assert.equal(result.contracts.length, 1);
  assert.equal(result.contracts[0]?.referenceId, "Q-2026-0842");
  assert.equal(result.contracts[0]?.confidence, 100);
  assert.equal(result.contracts[0]?.linkedEvidence.length, 3);
  assert.deepEqual(result.findings.map((finding) => finding.term), [
    "Unit price", "Quantity", "Delivery date", "Payment terms", "Warranty", "Shipping", "Restocking fee",
  ]);
  assert.ok(result.findings.every((finding) => finding.contractSnippet && finding.evidenceSnippet));
  assert.equal(result.pipeline.status, "review-ready");
});

test("reads supported File.text content and keeps unsupported files queued", async () => {
  const result = await readLocalFiles([
    { name: "quote.txt", text: async () => quote },
    { name: "scan.pdf", text: async () => { throw new Error("must not read"); } },
  ]);
  assert.equal(result.documents[0]?.text, quote);
  assert.equal(result.queued[0]?.name, "scan.pdf");
  assert.match(result.queued[0]?.reason ?? "", /queued for manual review/i);
  assert.doesNotMatch(result.queued[0]?.reason ?? "", /OCR/i);
  assert.deepEqual(result.errors, []);
});

test("ignores macOS metadata files before reading or displaying them", async () => {
  let reads = 0;
  const result = await readLocalFiles([
    { name: ".DS_Store", text: async () => { reads += 1; throw new Error("must not read"); } },
    { name: "nested/.DS_Store", text: async () => { reads += 1; throw new Error("must not read"); } },
    { name: "quote.txt", text: async () => quote },
  ]);

  assert.equal(isIgnoredLocalFile(".DS_Store"), true);
  assert.equal(isIgnoredLocalFile("nested/.DS_Store"), true);
  assert.equal(isIgnoredLocalFile("quote.txt"), false);
  assert.equal(reads, 0);
  assert.deepEqual(result.documents.map((item) => item.name), ["quote.txt"]);
  assert.deepEqual(result.queued, []);
  assert.deepEqual(result.errors, []);
});

test("turns visual extraction fields into comparable commercial evidence", () => {
  const extractedContract = documentFromExtraction("signed-contract.pdf", [{
    documentType: "Executed contract",
    summary: "Signed commercial agreement",
    fields: [
      { label: "Contract ID", value: "C-2026-311" },
      { label: "Commercial reference", value: "Q-2026-0842" },
      { label: "Supplier", value: "Example Supplier Co." },
      { label: "Buyer", value: "Example Buyer Co." },
      { label: "Program", value: "NX-48 Charging Module Program" },
      { label: "Quantity", value: "1,000 units" },
      { label: "Unit price", value: "USD 49.20" },
      { label: "Delivery date", value: "November 1, 2026" },
      { label: "Payment terms", value: "Net 30 from invoice date" },
    ],
  }]);

  assert.equal(extractedContract.name, "signed-contract.pdf");
  assert.equal(classifyDocument(extractedContract), "contract");
  const result = analyzeDocuments([document("quote.txt", quote), extractedContract]);
  assert.equal(result.contracts[0]?.name, "signed-contract.pdf");
  assert.ok(result.findings.some((finding) => finding.term === "Unit price"));
  assert.ok(result.findings.some((finding) => finding.term === "Payment terms"));
});

test("uses the visual provider document type when a scan has no identifying filename", () => {
  const extractedInvoice = documentFromExtraction("scan-418.pdf", [{
    documentType: "Invoice",
    summary: "Supplier billing record",
    fields: [{ label: "Total", value: "USD 56,160" }],
  }]);

  assert.equal(classifyDocument(extractedInvoice), "invoice");
});

test("reconciles OCR field-label variants against quote terms without false differences", () => {
  const extractedContract = documentFromExtraction("05_alternate_matching_contract_scan.png", [{
    documentType: "Master Supply Order",
    summary: "Master supply order alternate draft for 1,200 NX-48 modules at USD 56,160.00, effective August 22, 2026.",
    fields: [
      { label: "Contract ID", value: "C-2026-312" },
      { label: "Commercial Reference", value: "Q-2026-0842" },
      { label: "Supplier", value: "Example Supplier Co." },
      { label: "Buyer", value: "Example Buyer Co." },
      { label: "Program", value: "NX-48 Charging Module Program" },
      { label: "Effective Date", value: "August 22, 2026" },
      { label: "Goods and Quantity", value: "1,200 NX-48 charging control modules" },
      { label: "Unit Price", value: "USD 46.80" },
      { label: "Total Contract Value", value: "USD 56,160.00" },
      { label: "Delivery Date", value: "on or before October 15, 2026" },
      { label: "Freight Term", value: "Expedited ground freight included" },
      { label: "Payment Term", value: "Net 45 from invoice date" },
      { label: "Warranty Term", value: "24 months from delivery" },
      { label: "Cancellation/Restocking Fee", value: "None before production release" },
    ],
  }]);

  assert.equal(classifyDocument(extractedContract), "contract");
  const result = analyzeDocuments([document("01_supplier_quote.txt", quote), extractedContract]);
  assert.equal(result.contracts[0]?.referenceId, "Q-2026-0842");
  assert.equal(result.contracts[0]?.confidence, 100);
  assert.deepEqual(result.findings, []);
});

test("queues oversized local text before reading it", async () => {
  let reads = 0;
  const result = await readLocalFiles([{
    name: "oversized-contract.txt",
    size: 2_000_001,
    text: async () => { reads += 1; return "must not be read"; },
  }]);

  assert.equal(reads, 0);
  assert.equal(result.documents.length, 0);
  assert.match(result.queued[0]?.reason ?? "", /2 MB local read limit/i);
});

test("never links one contract as evidence for another contract", () => {
  const result = analyzeDocuments([
    document("quote.txt", quote),
    document("contract-v1.txt", contract),
    document("contract-v2.txt", contract.replace("USD 49.20", "USD 50.00")),
  ]);

  assert.ok(result.contracts.every((item) => item.linkedEvidence.every((evidence) => evidence.kind !== "contract")));
  assert.ok(result.findings.every((finding) => finding.evidenceName === "quote.txt"));
  assert.equal(result.pipeline.status, "queued");
  assert.match(result.pipeline.message, /2 contracts found/i);
});

test("falls back to shared parties and program when no reference ID exists", () => {
  const result = analyzeDocuments([
    document("quote.txt", "Supplier: Example Supplier Co.\nBuyer: Example Buyer Co.\nProgram: NX-48 Charging Module Program\nUnit price: USD 46.80"),
    document("contract.txt", "Supplier: Example Supplier Co.\nBuyer: Example Buyer Co.\nProgram: NX-48 Charging Module Program\nUnit price: USD 49.20"),
  ]);

  assert.equal(result.contracts[0]?.confidence, 65);
  assert.equal(result.contracts[0]?.linkedEvidence.length, 1);
});
