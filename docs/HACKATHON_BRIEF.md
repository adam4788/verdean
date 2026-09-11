<p><img src="../public/verdean-horizontal.svg" alt="Verdean" width="190"></p>
<p><strong>VERDEAN · PRESENTATION GUIDE</strong><br><em>Every promise, reconciled.</em></p>

# Verdean — Hackathon Brief

> **Every promise, reconciled.**

## One-line pitch

Verdean is a local-first commercial-evidence agent that periodically rechecks a user-approved folder while the product tab is open, links supported quotes, emails, call notes, CSV, JSON, PDFs, scans, and contracts, then surfaces term mismatches with a visible in-session review trail.

## Problem

The commitment that gets signed is often assembled from fragmented promises: a quoted price, an email concession, a call-confirmed delivery date, a PO quantity, and a contract draft. Those artifacts sit in different folders and systems. The manual failure mode is not “nobody can summarize a contract”; it is “nobody continuously checks whether the final contract reflects the full commercial record.”

## Wedge

**Pre-signature commercial reconciliation for procurement, deal desk, RevOps, finance, and legal ops.**

Verdean is deliberately not another generic contract chatbot or repository. It turns passive source files into an autonomous exception queue:

1. detect a changed folder snapshot while the browser tab is open;
2. read supported local files without uploading them;
3. classify each artifact;
4. extract IDs, parties, programs, and commercial terms;
5. link evidence to the most likely governing contract;
6. compare normalized terms deterministically;
7. explain discrepancies with source snippets and confidence factors;
8. pause for human review rather than automatically changing or sending anything.

## Why this counts as agentic

A copilot waits for “summarize this file.” Verdean initiates and advances a bounded multi-step workflow during a visible-tab folder recheck. It maintains pipeline state, works across multiple artifacts, matches candidate contracts, validates terms, records activity, and escalates exceptions. The user selects the governing contract when needed and owns the consequential decision.

The MVP is intentionally bounded: its “intelligence” is transparent local extraction plus deterministic business rules, not an ungrounded legal opinion. Optional development document intelligence now renders PDF/scan pages in-browser (maximum six pages; 850 KB rendered page images) and sends only those page images to a configured provider. It remains secondary to the browser-local TXT/CSV/JSON workflow, does not persist page images or results, and production intentionally returns 503 pending authenticated access, durable rate limiting, privacy, legal, and retention review.

## Primary presentation user

**Procurement / deal-desk operator** preparing an NX-48 component order. Their success criterion is simple: before signature, prove that the contract reflects what sales and the supplier actually agreed.

## Three-minute live presentation

### 0:00–0:25 — Frame the pain

“Commercial truth is scattered across the quote, buyer email, call transcript, PO, and final contract. One missed promise becomes margin leakage, delay, or a dispute.”

Show the quiet Verdean landing state and local-first promise.

### 0:25–0:50 — Connect evidence

Choose **Connect a folder** and select `examples/example-quote-renewal` from this repository. The page contains no preloaded case; every result that appears comes from the selected files.

Point out:

- files stay in the browser session;
- TXT, CSV, and JSON are actually read locally;
- PDFs/scans show live per-page document intelligence with bounding boxes when the configured provider is available; TXT, CSV, and JSON remain browser-local.

### 0:50–1:25 — Let the agent work

Narrate the visible pipeline:

- Cataloging
- Categorizing
- Matching
- Validating

The important moment is that the UI is not a spinner. The active document and stage are visible, and the activity log records what happened.

### 1:25–2:20 — Show the result

Open the matched case:

- Quote/reference ID links the evidence set to the contract.
- Parties and program raise confidence.
- The contract diverges on unit price, quantity, delivery date, payment terms, warranty, shipping, and restocking terms when the corresponding evidence is present.
- Each finding shows the evidence value, contract value, source filenames, and snippets.

Say: “This is not a legal conclusion. It is a grounded commercial exception with provenance.”

### 2:20–2:45 — Prove autonomy

While the tab is open, add or change a supported file in the selected folder. Verdean re-scans the granted folder handle and runs the bounded workflow again. If the browser does not support this permission model, use the snapshot folder picker and reselect the folder to refresh.

### 2:45–3:00 — Human control + roadmap

Assign a disposition to each difference—accept it, request a contract fix, or send it to legal—then click **Mark reviewed**. Every source-backed exception and disposition remains visible.

“Today it periodically rechecks a user-approved folder’s direct files while the tab is visible. Next, an event-driven workflow attaches to Google Drive changes and SAP contract/procurement records.”

## Synthetic scenario

- Supplier quotation: 1,200 units, $46.80 per unit, October 15 delivery, Net 45, freight included, 24-month warranty.
- Supported TXT exports of the buyer email and call notes reinforce the commercial promise.
- Executed contract: 1,000 units, $49.20 per unit, November 1 delivery, Net 30, freight billed separately, 12-month warranty, 15% restocking fee.
- Expected output: one high-confidence contract match and multiple grounded discrepancies.

## Trust boundaries

- User gesture is required before a browser may expose a directory handle.
- File System Access support varies by browser and requires a secure context outside localhost.
- Folder monitoring is only active while the page/tab is open and permission remains available; it is not an OS background service.
- TXT, CSV, and JSON are readable locally and never sent to a provider.
- Optional development PDF/PNG/JPEG/WebP extraction renders up to six pages locally and sends only page images (850 KB maximum each) to a configured provider; no images/results persist in this MVP.
- The production endpoint returns 503 pending authenticated access, durable rate limiting, privacy, legal, and retention review.
- No contract edit, email send, or ERP action occurs.
- Output is commercial exception detection, not legal advice.

## Product roadmap

1. **Document intelligence:** OCR, PDF/DOCX/EML parsing, layout-aware extraction, provenance spans.
2. **Knowledge layer:** entity resolution, amendments, governing-document selection, embeddings plus deterministic controls.
3. **Connectors:** Google Drive changes/webhooks, Gmail/Outlook evidence, SAP Ariba/S/4HANA/CPQ contract and PO data.
4. **Operational controls:** configurable approval policies, assignment, escalation, audit export.
5. **Agent actions:** draft correction packets, request missing evidence, create a review task—always with human approval for external actions.

## Research signal

This wedge is adjacent to validated enterprise categories without duplicating them:

- Zip describes procurement intake as a single front door and says its validation agent cross-references uploaded documents, vendor records, and policy rules—including the example of Net 30 entered when a contract says Net 45.
- Coupa markets AI metadata/clause extraction, automatic routing of high-risk terms, bid-to-contract handoff, and validation of invoices against contracted pricing.
- Ironclad markets bulk contract import, OCR, automatic related-record linking, and metadata indexing.
- Icertis defines contract intelligence as converting static contracts into structured, actionable rules and emphasizes agentic workflows that operationalize agreements.
- SAP describes AI in procurement as structuring contract, invoice, and PO data so terms can be compared automatically.

These products validate contract intelligence, intake orchestration, and matching as real enterprise needs. Verdean’s hackathon wedge is narrower and easier to demonstrate: **periodically reconcile pre-signature quote evidence against the governing contract during an active browser session and explain only the exceptions.**

## Sources

1. MDN, `showDirectoryPicker()` security and compatibility: https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
2. Zip, intake vs. procurement orchestration: https://ziphq.com/blog/intake-vs-procurement-orchestration
3. Coupa, contract lifecycle management: https://www.coupa.com/products/source-to-contract/contract-management
4. Ironclad, contract repository/import: https://ironcladapp.com/product/store-contracts
5. Icertis, contract intelligence: https://www.icertis.com/learn/what-is-contract-intelligence
6. SAP, AI in procurement: https://www.sap.com/resources/ai-in-procurement

> Vendor pages are used to verify workflows and category features, not independent market-size or ROI claims.

## Working-name note

`Verdean` is the project’s working brand name. Treat name, logo, domain, and other intellectual-property questions as matters for the project owner and qualified counsel; this repository does not make a trademark-clearance claim.
