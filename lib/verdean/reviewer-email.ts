import type { Finding } from "./domain";
import type { FindingDisposition } from "./workspace";

const MAX_EMAIL_FINDINGS = 20;
const MAX_EMAIL_VALUE_LENGTH = 180;
const MAX_EMAIL_BODY_LENGTH = 7_500;

type ReviewerEmailInput = {
  workspace: string;
  contractName?: string;
  findings: Finding[];
  dispositions: Record<string, FindingDisposition>;
};

export type ReviewerEmailDraft = { subject: string; body: string };

function findingKey(finding: Finding) {
  return `${finding.contractName}\u0000${finding.evidenceName}\u0000${finding.term}`;
}

function bounded(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_EMAIL_VALUE_LENGTH);
}

function dispositionLabel(disposition?: FindingDisposition) {
  if (disposition === "accept-change") return "Accept change";
  if (disposition === "fix-contract") return "Fix contract";
  if (disposition === "legal-review") return "Needs legal review";
  return "Not selected";
}

export function buildReviewerEmail(input: ReviewerEmailInput): ReviewerEmailDraft {
  const included = input.findings.slice(0, MAX_EMAIL_FINDINGS);
  const lines = included.flatMap((finding, index) => [
    `${index + 1}. ${bounded(finding.term)}`,
    `   Evidence (${bounded(finding.evidenceName)}): ${bounded(finding.evidenceValue)}`,
    `   Contract (${bounded(finding.contractName)}): ${bounded(finding.contractValue)}`,
    `   Disposition: ${dispositionLabel(input.dispositions[findingKey(finding)])}`,
    "",
  ]);
  if (input.findings.length > included.length) lines.push(`${input.findings.length - included.length} additional findings are available in Verdean.`, "");

  const body = [
    "Verdean contract review",
    "",
    `Workspace: ${bounded(input.workspace)}`,
    `Governing contract: ${bounded(input.contractName ?? "Not selected")}`,
    `Differences: ${input.findings.length}`,
    "",
    ...lines,
    "Open the Verdean workspace on the originating device to inspect annotated source previews and record decisions.",
    "Source documents are not attached to this draft.",
  ].join("\n").slice(0, MAX_EMAIL_BODY_LENGTH);

  return { subject: `Review requested: ${bounded(input.workspace)}`, body };
}

export function buildReviewerMailto(recipient: string, draft: ReviewerEmailDraft) {
  return `mailto:${encodeURIComponent(recipient.trim())}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
