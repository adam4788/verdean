<p><img src="public/verdean-horizontal.svg" alt="Verdean" width="220"></p>
<p><strong>VERDEAN · PRODUCT REPOSITORY</strong><br><em>Every promise, reconciled.</em></p>

# Verdean

> Every promise, reconciled.

**Public release:** this repository contains the Verdean source code, synthetic fixtures, and brand assets for evaluation and contribution. Do not treat the product name or logos as granted under the source-code license.

Verdean is a local-folder-first quote-to-contract validation product. It starts disconnected and shows results only after a user selects real files. TXT, CSV, and JSON analysis stays browser-local. Document intelligence renders supported PDFs/scans in-browser and sends only rendered page images to the configured provider.

## What it demonstrates

- **Local folder intake and automatic non-destructive organization** through the File System Access API where supported. Verdean requests `readwrite` access with the folder picker and copies (never moves or deletes) source files into `_Verdean/Quotes`, `Contracts`, `Emails`, `Transcripts`, or `Needs Review`. It mitigates destination-name collisions with collision-resistant Verdean-versioned names, up to 10 existence retries, a final late existence re-check, per-app refresh serialization, and remembered-target skipping. Source originals are never moved or deleted. The File System Access API cannot atomically reserve a destination filename across tabs or processes, so no absolute destination no-overwrite guarantee is possible against concurrent external writers; use one writable Verdean session per output folder. It ignores `_Verdean` during scans, periodically rechecks the selected folder's direct files every five seconds while the tab is visible, and keeps copies when an original later disappears. If permission is denied, it still categorizes in-app but performs no writes.
- **Read-only `webkitdirectory` snapshot fallback** categorizes the selected files immediately in the UI/activity log, but cannot create physical copies; the UI explicitly says writable folder access is required.
- **Explicit recovery paths** let reviewers mark queued files manually reviewed, retry folder scans, retry failed organization, and choose a governing contract when more than one contract is found.
- **Transparent agent run**: cataloging → categorizing → organizing → matching → validating, with a reduced-motion-safe visual state.
- **Document categorization, evidence/confidence, commercial-term matching, discrepancies, activity log, and human review state** stored only in the current browser session.
- **Live visual extraction review** with clickable bounding boxes that connect structured fields to the selected PDF or scan.
- **Honest format support**: TXT, CSV, and JSON are browser-local, capped at 100 files and 2 MB per file. PDF/PNG/JPEG/WebP extraction renders at most six pages locally, with an 850 KB rendered-page limit; only those page images go to a configured provider. Page images and results are not persisted by this MVP. Production returns 503 until authenticated access, durable rate limiting, privacy, legal, and retention review are complete.

The presentation path and product boundaries are in [`docs/HACKATHON_BRIEF.md`](docs/HACKATHON_BRIEF.md). Public brand resources are under [`docs/brand`](docs/brand).

The display name lives in the single `BRAND` constant at the top of `app/page.tsx`, making a future rename straightforward. Production brand assets—including outlined lockups, dark and monochrome variants, favicons, and app icons—live under `public/`.

## Plug-and-play local setup

Prerequisites: Node.js 22.18 or newer. PDF and image extraction also requires
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation)
with access to a vision-capable model. TXT, CSV, and JSON processing does not
require Hermes or any provider credentials.

```bash
npm install
```

`npm install` safely creates an ignored `.env.local` from `.env.example` when
one does not already exist. It never overwrites an existing local environment
file. No shared secrets are stored in this repository.

For live PDF/image extraction, authenticate Hermes once and leave its local
subscription proxy running in a first terminal:

```bash
hermes portal
npm run ai:proxy
```

Then start Verdean in a second terminal:

```bash
npm run dev
```

Open the URL shown by Vinext. The product starts with no customer data or preloaded results. Choose **Connect a folder** and select [`examples/example-quote-renewal`](examples/example-quote-renewal), or choose your own supported documents. Verdean reads those files live and deterministically surfaces seven grounded commercial differences from the presentation folder.

### Document workflow and persistence

- Quotes, invoices, contracts, emails, and transcripts are classified as first-class records. Related evidence is linked to a governing contract by shared reference ID, parties, and program.
- Writable folders receive non-destructive copies under `_Verdean/Quotes`, `_Verdean/Invoices`, `_Verdean/Contracts`, `_Verdean/Emails`, `_Verdean/Transcripts`, and `_Verdean/Needs Review`. Source files are never moved or deleted.
- The **Workflow** view shows each live stage and its current counts: connect, extract, classify, organize, link, validate, persist, and review.
- Each discrepancy can open a two-pane annotated preview that highlights the relevant evidence and contract clauses. After a D1-only reload, bounded excerpts remain visible and the UI asks the user to reconnect the local source folder before showing full document text.
- **Email reviewer** prepares a bounded finding/disposition summary in the user’s email application. Verdean does not send automatically or attach source documents; the user confirms the recipient and presses Send in their email client.
- The local Vinext runtime binds a durable Cloudflare D1 database as `DB`. The workspace API normalizes documents, relationships, findings, review decisions, and run status into D1 and also stores a bounded dashboard snapshot for exact reload hydration. Per-write version tokens reject stale cross-tab updates with `409 Conflict` instead of overwriting a newer review trail.
- Raw source-document text, original files, and rendered page images are not stored in D1. Normalized fields and the short evidence snippets required for review are persisted.
- The database API is intentionally loopback-only until production authentication and tenant authorization are installed; remote requests fail closed.

### Environment variables

| Variable | Local default | Purpose |
| --- | --- | --- |
| `DOCUMENT_AI_BASE_URL` | `http://127.0.0.1:8645/v1` | OpenAI-compatible vision endpoint. |
| `DOCUMENT_AI_API_KEY` | `sk-unused` | Placeholder for the Hermes proxy; replace it only for another provider. |
| `DOCUMENT_AI_MODEL` | `google/gemini-3.7-flash` | Vision-capable model identifier sent to the endpoint. |
| `DOCUMENT_AI_PROVIDER` | `Hermes subscription proxy` | Human-readable provider label shown in extraction results. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical metadata base URL for a deployment. |
| `VERDEAN_D1_BINDING` | `DB` | Local Cloudflare D1 binding name. |

To use another OpenAI-compatible vision provider, edit the ignored
`.env.local` file with that provider's base URL, API key, model, and label.
Never add real credentials to `.env.example` or commit `.env.local`.

## Verify

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## License and responsible use

The source code is released under the MIT License in [`LICENSE`](LICENSE). The example documents are synthetic and use reserved `.example` or `.test` email addresses; replace them with your own non-sensitive fixtures when testing. Never commit credentials, customer documents, personal data, or production environment files. The Verdean name and logos are project assets, not a trademark license, and this MVP is not legal advice.
