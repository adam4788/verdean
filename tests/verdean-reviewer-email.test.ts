import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewerEmail, buildReviewerMailto } from "../lib/verdean/reviewer-email.ts";

const findings = [
  {
    term: "Unit price",
    evidenceName: "quote.txt",
    contractName: "contract.txt",
    evidenceValue: "46.80",
    contractValue: "49.20",
    evidenceSnippet: "Unit price: USD 46.80",
    contractSnippet: "Unit price is USD 49.20.",
  },
];

test("builds a bounded reviewer summary without attaching source documents", () => {
  const draft = buildReviewerEmail({
    workspace: "Example Buyer Co. / 5 documents",
    contractName: "contract.txt",
    findings,
    dispositions: { "contract.txt\u0000quote.txt\u0000Unit price": "fix-contract" },
  });

  assert.equal(draft.subject, "Review requested: Example Buyer Co. / 5 documents");
  assert.match(draft.body, /1\. Unit price/);
  assert.match(draft.body, /Evidence \(quote\.txt\): 46\.80/);
  assert.match(draft.body, /Contract \(contract\.txt\): 49\.20/);
  assert.match(draft.body, /Disposition: Fix contract/);
  assert.doesNotMatch(draft.body, /Unit price is USD 49\.20/);
});

test("creates an encoded mailto draft for an explicit reviewer", () => {
  const draft = buildReviewerEmail({ workspace: "Workspace", contractName: "contract.txt", findings, dispositions: {} });
  const href = buildReviewerMailto("reviewer@example.com", draft);

  assert.match(href, /^mailto:reviewer%40example\.com\?/);
  assert.match(href, /subject=Review%20requested%3A%20Workspace/);
  assert.match(href, /body=/);
});
