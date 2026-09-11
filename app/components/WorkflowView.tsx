type WorkflowViewProps = {
  running: boolean;
  documentCount: number;
  quoteCount: number;
  invoiceCount: number;
  contractCount: number;
  relationshipCount: number;
  findingCount: number;
  organizationStatus: string;
  databaseStatus: "idle" | "loading" | "saving" | "saved" | "restored" | "conflict" | "error";
  sourceStatus: string;
};

const statusLabel = {
  idle: "Waiting",
  loading: "Loading",
  saving: "Saving",
  saved: "Verified",
  restored: "Restored",
  conflict: "Reload required",
  error: "Needs attention",
};

export function WorkflowView(props: WorkflowViewProps) {
  const classified = props.quoteCount + props.invoiceCount + props.contractCount;
  const steps = [
    { number: "01", title: "Connect", state: props.documentCount ? "complete" : "waiting", detail: props.sourceStatus, output: `${props.documentCount} file${props.documentCount === 1 ? "" : "s"} cataloged` },
    { number: "02", title: "Extract", state: props.running ? "active" : props.documentCount ? "complete" : "waiting", detail: "Text is read locally. PDFs and scans are rendered page-by-page for structured extraction.", output: props.running ? "Agent processing" : "Source values prepared" },
    { number: "03", title: "Classify", state: classified ? "complete" : "waiting", detail: "Documents are typed as quotes, invoices, contracts, communications, or supporting evidence.", output: `${props.quoteCount} quotes · ${props.invoiceCount} invoices · ${props.contractCount} contracts` },
    { number: "04", title: "Organize", state: props.documentCount ? "complete" : "waiting", detail: "Writable folders receive non-destructive copies under _Verdean. Original files remain untouched.", output: props.organizationStatus },
    { number: "05", title: "Link", state: props.relationshipCount ? "complete" : "waiting", detail: "Quote references, parties, and programs connect evidence to its governing contract.", output: `${props.relationshipCount} evidence relationship${props.relationshipCount === 1 ? "" : "s"}` },
    { number: "06", title: "Validate", state: props.documentCount ? "complete" : "waiting", detail: "Normalized price, quantity, dates, payment, warranty, shipping, and fee terms are compared.", output: `${props.findingCount} grounded difference${props.findingCount === 1 ? "" : "s"}` },
    { number: "07", title: "Persist", state: props.databaseStatus === "error" ? "error" : ["saved", "restored"].includes(props.databaseStatus) ? "complete" : props.databaseStatus === "saving" || props.databaseStatus === "loading" ? "active" : "waiting", detail: "Metadata, normalized terms, links, findings, and review decisions are written to Cloudflare D1. Raw source text and file bytes are not stored.", output: `Database: ${statusLabel[props.databaseStatus]}` },
    { number: "08", title: "Review", state: props.findingCount ? "active" : props.documentCount ? "complete" : "waiting", detail: "A person records a disposition for every difference before marking the review complete.", output: props.findingCount ? "Human decision required" : "No differences awaiting disposition" },
  ];

  return <section className="workflow-view" aria-labelledby="workflow-title">
    <header className="workflow-header"><div><p className="section-kicker">Agent workflow</p><h2 id="workflow-title" tabIndex={-1}>How every document moves through Verdean</h2><p>This view reflects the live workspace—not a generic illustration. Counts and statuses update as intake, matching, persistence, and review progress.</p></div><span className={`database-badge ${props.databaseStatus}`} role="status" aria-live="polite">D1 · {statusLabel[props.databaseStatus]}</span></header>
    <div className="workflow-grid">{steps.map((step) => <article className={`workflow-step ${step.state}`} key={step.number}><span className="workflow-number">{step.number}</span><div><div className="workflow-step-head"><h3>{step.title}</h3><span>{step.state === "complete" ? "Complete" : step.state === "active" ? "In progress" : step.state === "error" ? "Attention" : "Waiting"}</span></div><p>{step.detail}</p><strong>{step.output}</strong></div></article>)}</div>
    <section className="workflow-data"><div><p className="section-kicker">Database contract</p><h3>What D1 stores</h3></div><div className="workflow-data-grid"><span><strong>Documents</strong>Names, types, references, parties, programs, and normalized commercial terms.</span><span><strong>Relationships</strong>Quote-to-contract and invoice-to-contract links with confidence reasons.</span><span><strong>Review trail</strong>Grounded findings, dispositions, pipeline status, and agent activity.</span><span><strong>Privacy boundary</strong>No raw source text, local file bytes, folder handles, or rendered page images.</span></div></section>
  </section>;
}
