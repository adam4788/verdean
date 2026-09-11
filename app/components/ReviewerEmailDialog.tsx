"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Finding } from "../../lib/verdean/domain";
import { buildReviewerEmail, buildReviewerMailto } from "../../lib/verdean/reviewer-email";
import type { FindingDisposition } from "../../lib/verdean/workspace";

type ReviewerEmailDialogProps = {
  workspace: string;
  contractName?: string;
  findings: Finding[];
  dispositions: Record<string, FindingDisposition>;
  onClose(): void;
  onDraftOpened(): void;
};

export function ReviewerEmailDialog(props: ReviewerEmailDialogProps) {
  const [recipient, setRecipient] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useMemo(() => buildReviewerEmail(props), [props]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = ""; previous?.focus(); };
  }, [props]);

  const openDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onDraftOpened();
    window.location.href = buildReviewerMailto(recipient, draft);
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) props.onClose(); }}>
    <section className="email-dialog" role="dialog" aria-modal="true" aria-labelledby="reviewer-email-title">
      <header className="modal-header"><div><p className="section-kicker">Reviewer handoff</p><h2 id="reviewer-email-title">Email this review</h2><p>Open a prefilled draft with the finding summary and selected dispositions.</p></div><button className="modal-close" onClick={props.onClose} aria-label="Close reviewer email dialog">Close</button></header>
      <form onSubmit={openDraft}>
        <label><span>Reviewer email</span><input ref={inputRef} type="email" required autoComplete="email" placeholder="reviewer@company.com" value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label>
        <div className="email-preview"><span>Subject</span><strong>{draft.subject}</strong><span>Message preview</span><pre>{draft.body}</pre></div>
        <p className="email-safety">Nothing is sent until you press Send in your email app. Source documents are not attached.</p>
        <div className="email-dialog-actions"><button type="button" className="quiet-button" onClick={props.onClose}>Cancel</button><button type="submit" className="review-button">Open email draft</button></div>
      </form>
    </section>
  </div>;
}
