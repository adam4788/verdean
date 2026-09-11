"use client";

import { useEffect, useRef } from "react";
import type { AnalyzedDocument, Finding } from "../../lib/verdean/domain";

type FindingSourcePreviewProps = {
  finding: Finding;
  evidence?: AnalyzedDocument;
  contract?: AnalyzedDocument;
  onClose(): void;
};

function AnnotatedSource({ document, excerpt, label }: { document?: AnalyzedDocument; excerpt: string; label: string }) {
  const text = document?.text ?? "";
  const index = text.toLocaleLowerCase().indexOf(excerpt.toLocaleLowerCase());
  return <article className="source-preview-pane">
    <header><div><span>{label}</span><h3>{document?.name ?? "Source unavailable"}</h3></div>{document && <em>{document.kind}</em>}</header>
    <div className="annotation-summary"><span>Relevant clause</span><mark>{excerpt}</mark></div>
    {text ? <pre aria-label={`${label} file contents`}>{index >= 0 ? <>{text.slice(0, index)}<mark>{text.slice(index, index + excerpt.length)}</mark>{text.slice(index + excerpt.length)}</> : text}</pre> : <div className="source-unavailable"><strong>Full source preview is not stored</strong><p>Verdean preserves the excerpt above, but raw file contents are not persisted in D1. Reconnect the source folder to restore the full annotated preview.</p></div>}
  </article>;
}

export function FindingSourcePreview({ finding, evidence, contract, onClose }: FindingSourcePreviewProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = ""; previous?.focus(); };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="source-preview-modal" role="dialog" aria-modal="true" aria-labelledby="source-preview-title">
      <header className="modal-header"><div><p className="section-kicker">Annotated source preview</p><h2 id="source-preview-title">{finding.term} mismatch</h2><p>Verdean highlights the clause used for this comparison. Review both files before choosing a disposition.</p></div><button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close annotated source preview">Close</button></header>
      <div className="source-preview-grid">
        <AnnotatedSource document={evidence} excerpt={finding.evidenceSnippet} label="Evidence file" />
        <AnnotatedSource document={contract} excerpt={finding.contractSnippet} label="Contract file" />
      </div>
    </section>
  </div>;
}
