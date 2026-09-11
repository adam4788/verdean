import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const iconSource = await readFile(new URL("../app/components/VerdeanIcon.tsx", import.meta.url), "utf8");
const previewSource = await readFile(new URL("../app/components/FindingSourcePreview.tsx", import.meta.url), "utf8");
const emailSource = await readFile(new URL("../app/components/ReviewerEmailDialog.tsx", import.meta.url), "utf8");

test("client intake delegates local file reading and analysis to the Verdean domain", () => {
  assert.match(source, /import\s*\{[\s\S]*analyzeDocuments[\s\S]*readLocalFiles[\s\S]*\}\s*from\s*["']\.\.\/lib\/verdean\/domain["']/);
  assert.match(source, /const\s+readResult\s*=\s*await\s+readLocalFiles\(readableInputs\)/);
  assert.match(source, /file\.webkitRelativePath \|\| file\.name/);
  assert.match(source, /analyzeDocuments\(\[\.\.\.latestReadableDocumentsRef\.current,\s*\.\.\.extractedDocumentsRef\.current\.values\(\)\]\)/);
});

test("client results are driven by domain analysis rather than seeded finding copy", () => {
  assert.match(source, /analysis\.findings/);
  assert.match(source, /analysis\.contracts/);
  assert.match(source, /readResult\.queued/);
  assert.match(source, /const\s+unresolvedFiles\s*=\s*\[\.\.\.readResult\.queued,\s*\.\.\.readResult\.errors\.map/);
  assert.match(source, /analysis\.contracts\.find\(\(item\) => item\.name === selectedContractName\)/);
  assert.match(source, /const\s+reviewReady\s*=\s*Boolean\(contract\) && blockingQueuedFiles\.length === 0/);
});

test("the product starts disconnected and exposes only live analysis paths", () => {
  assert.match(source, /useState<AnalysisResult>\(analyzeDocuments\(\[\]\)\)/);
  assert.match(source, /useState\("No folder connected"\)/);
  assert.match(source, /const \[hasWorkspace, setHasWorkspace\] = useState\(false\)/);
  assert.doesNotMatch(source, /demoInput|demoAnalysis|demoQueued|useDemo|isDemo|source: "demo"/);
  assert.doesNotMatch(source, /Review the example|Reset demo|Demo workspace|fictional sample/i);
  assert.match(source, /Live document intelligence/);
  assert.match(source, /className="field-focus" aria-live="polite"/);
});

test("the dashboard saves to D1, restores from D1, and exposes the live workflow view", () => {
  assert.match(source, /fetch\("\/api\/workspaces", \{/);
  assert.match(source, /method: "PUT"/);
  assert.match(source, /fetch\(`\/api\/workspaces\?workspaceId=/);
  assert.match(source, /parseWorkspaceSnapshot\(body\.workspace\)/);
  assert.match(source, /setAnalysis\(snapshot\.analysis\)/);
  assert.match(source, /setActiveView\("workflow"\)/);
  assert.match(source, /<WorkflowView/);
  assert.match(source, /Saved and verified in D1/);
});

test("findings expose real evidence controls and review is not contract approval", () => {
  assert.match(source, /<details className="clause-details">/);
  assert.match(source, />Compare clauses<\/summary>/);
  assert.match(source, /Mark reviewed/);
  assert.match(source, /Accept change/);
  assert.match(source, /Fix contract/);
  assert.match(source, /Needs legal review/);
  assert.match(source, /Request fixes for all/);
  assert.match(source, /findingDispositions/);
  assert.match(source, /allFindingsDispositioned/);
  assert.doesNotMatch(source, /Review & approve/);
});

test("each finding opens an annotated source preview and reviewer email stays a user-confirmed draft", () => {
  assert.match(source, /<FindingSourcePreview/);
  assert.match(source, /Preview annotated sources/);
  assert.match(source, /setPreviewFinding\(finding\)/);
  assert.match(source, /<ReviewerEmailDialog/);
  assert.match(source, /Email reviewer/);
  assert.match(previewSource, /Relevant clause/);
  assert.match(previewSource, /Reconnect the source folder to restore the full annotated preview\./);
  assert.match(emailSource, /Nothing is sent until you press Send in your email app\./);
});

test("the product icon family uses controlled SVG geometry instead of Unicode glyphs", () => {
  assert.match(source, /VerdeanIcon as Icon/);
  assert.match(iconSource, /viewBox="0 0 24 24"/);
  assert.match(iconSource, /strokeWidth: 1\.75/);
  assert.doesNotMatch(source, /✦|⌁|✓|→|▤/);
});

test("organizer requests write access in the picker gesture and preserves a read-only fallback", () => {
  assert.match(source, /picker\(\{ mode: "readwrite" \}\)/);
  assert.match(source, /requestReadWritePermission\(handle as FileSystemDirectoryHandle & PermissionHandleLike\)/);
  assert.match(source, /catch \{\s*canWriteRef\.current = false;/);
  assert.match(source, /options\?\.directory && options\.canWrite/);
  assert.match(source, /Snapshot\/read-only import: categorized in-app only\. Physical copies require writable folder access\./);
  assert.match(source, /no physical copies were written/);
});

test("organizer visibly describes non-destructive _Verdean sync and its live stage", () => {
  assert.match(source, /"Organizing"/);
  assert.match(source, /_Verdean copies/);
  assert.match(source, /organizationStatus/);
  assert.match(source, /Originals are preserved\./);
  assert.match(source, /_Verdean/);
});

test("watcher analyzes the full source set while syncing only changed files and ignores its output", () => {
  assert.match(source, /entry\.kind !== "file" \|\| entry\.name === VERDEAN_OUTPUT_DIRECTORY/);
  assert.match(source, /filesToOrganize: forceOrganization \? files : changed/);
  assert.match(source, /await ingest\(files, \{ directory: readableDirectory[\s\S]*intakeFailures, generation \}\)/);
  assert.match(source, /scanInitializedRef/);
  assert.match(source, /const removed =/);
  assert.match(source, /if \(!firstScan && changed\.length === 0 && !removed && !force && intakeFailures\.length === 0\) return/);
});

test("simple hierarchy keeps advanced mechanics optional", () => {
  assert.ok(source.includes("Find what changed before you sign."));
  assert.ok(source.includes("Choose a folder"));
  assert.ok(source.includes("Choose individual files"));
  assert.ok(source.includes('className="advanced-panel"'));
  assert.ok(source.includes("Show all ${findings.length} differences"));
  assert.ok(source.includes("findings.slice(0, 3)"));
});

test("multi-contract workspaces have a governing-contract recovery path", () => {
  assert.ok(source.includes("selectedContractName"));
  assert.ok(source.includes("Choose the governing contract"));
  assert.ok(source.includes('<select'));
  assert.ok(source.includes('id="governing-contract"'));
  assert.ok(source.includes('needsContractChoice ? "#governing-contract"'));
  assert.ok(source.includes('finding.contractName === contract.name'));
});

test("human review action appears after the findings section", () => {
  assert.ok(source.lastIndexOf("Mark reviewed") > source.indexOf('id="findings"'));
});

test("queued files have a manual resolution path that controls review blocking", () => {
  assert.ok(source.includes("resolvedQueueNames"));
  assert.ok(source.includes("blockingQueuedFiles"));
  assert.ok(source.includes("Mark manually reviewed"));
  assert.ok(source.includes("Manually reviewed"));
});

test("scan and organization failures expose explicit retries", () => {
  assert.ok(source.includes("intakeFailures"));
  assert.ok(source.includes("Retry scan"));
  assert.ok(source.includes("Retry organization"));
  assert.ok(source.includes("organizationErrorCount"));
  assert.ok(source.includes("forceOrganization"));
});

test("terminal processing status is announced without announcing every stage tick", () => {
  assert.ok(source.includes('role="status"'));
  assert.ok(source.includes('aria-live="polite"'));
  assert.ok(source.includes('role="alert"'));
});


test("PDFs and scans run through optional live page rendering and document intelligence", () => {
  assert.match(source, /documentIntelligenceIntake\(sourceFiles, filesToOrganize\)/);
  assert.match(source, /const sourceIdentities = new Set\(visualEntries\.map\(\(\{ identity \}\) => identity\)\)/);
  assert.match(source, /selectedVisualEntries: intelligenceInputs/);
  assert.match(source, /await\s+renderDocument\(file,\s*controller\.signal\)/);
  assert.match(source, /await\s+extractRenderedPage\(page,\s*\{\s*signal:\s*controller\.signal\s*\}\)/);
  assert.match(source, /documentRunRef\.current\.controller\?\.abort\(\)/);
  assert.match(source, /status: "failed", message: "Needs attention", error: message, pages: \[\]/);
  assert.match(source, /Rendering pages locally/);
  assert.match(source, /Extracting page/);
  assert.doesNotMatch(source, /Local PDF\/scan OCR is not yet wired/);
  assert.match(source, /documentFromExtraction/);
  assert.match(source, /extractedDocumentsRef/);
  assert.match(source, /blockingIntelligenceJobs/);
  assert.match(source, /Choose individual files/);
  assert.doesNotMatch(source, /Only text, CSV, and JSON have readable local-format support in this MVP\./);
  assert.match(source, /Mark manually reviewed/);
  assert.match(source, /job\.status === "failed" && resolvedQueueNames\.has\(job\.id\)/);
  assert.match(source, /resolveQueuedFile\(job\.id\)/);
});

test("document intelligence releases only stale or superseded job previews", () => {
  assert.match(source, /const previewUrlsRef = useRef<Map<string, string\[\]>>\(new Map\(\)\)/);
  assert.match(source, /const releaseJobPreviews = useCallback\(\(jobId: string\)/);
  assert.match(source, /previewUrlsRef\.current\.set\(job\.id, document\.pages\.map\(\(page\) => page\.previewUrl\)\)/);
  assert.match(source, /finally \{\s*if \(!keepPreviews\) releaseJobPreviews\(job\.id\);\s*if \(discardJob\) updateIntelligenceJobs/);
  assert.match(source, /const superseded = intelligenceJobsRef\.current\.filter\(\(job\) => jobs\.some\(\(next\) => next\.fileIdentity === job\.fileIdentity\)\)/);
  assert.match(source, /for \(const job of superseded\) releaseJobPreviews\(job\.id\)/);
  assert.match(source, /let discardJob = false;/);
  assert.match(source, /if \(discardJob\) updateIntelligenceJobs\(\(items\) => items\.filter\(\(item\) => item\.id !== job\.id\)\)/);
  assert.match(source, /previewUrlsRef\.current\.delete\(jobId\)/);
});
