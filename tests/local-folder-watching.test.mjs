import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("a picked local folder is retained and refreshed while its tab is active", () => {
  assert.match(source, /const\s+\[selectedDirectory,\s*setSelectedDirectory\]\s*=\s*useState<FileSystemDirectoryHandle\s*\|\s*null>\(null\)/);
  assert.ok(source.includes("refreshingDirectoryRef"));
  assert.match(source, /setSelectedDirectory\(handle\)/);
  assert.match(source, /document\.addEventListener\(["']visibilitychange["']/);
  assert.match(source, /document\.visibilityState\s*!==\s*["']visible["']/);
  assert.match(source, /window\.setInterval\(/);
  assert.match(source, /window\.clearInterval\(/);
});

test("folder refreshes analyze all source files but organizes only changed fingerprints", () => {
  assert.match(source, /await\s+ingest\(files, \{ directory: readableDirectory, canWrite: canWriteRef\.current, filesToOrganize: forceOrganization \? files : changed, intakeFailures, generation \}\)/);
  assert.match(source, /for\s+await\s*\(const\s+entry\s+of\s+readableDirectory\.values\(\)\)/);
  assert.match(source, /fingerprintFile\(file\)/);
  assert.match(source, /entry\.name === VERDEAN_OUTPUT_DIRECTORY/);
});

test("folder refresh excludes macOS metadata before counting or reading files", () => {
  assert.match(source, /isIgnoredLocalFile\(entry\.name\)/);
  assert.match(source, /entry\.kind !== "file" \|\| entry\.name === VERDEAN_OUTPUT_DIRECTORY \|\| isIgnoredLocalFile\(entry\.name\)/);
});

test("first empty scan and deletion refreshes are meaningful while unchanged scans no-op", () => {
  assert.match(source, /const firstScan = !scanInitializedRef\.current/);
  assert.match(source, /const removed = !firstScan/);
  assert.match(source, /if \(!firstScan && changed\.length === 0 && !removed && !force && intakeFailures\.length === 0\) return/);
  assert.match(source, /filesToOrganize: forceOrganization \? files : changed/);
});

test("the UI discloses active-tab watching and read-only snapshot fallback", () => {
  assert.match(source, /Watching \$\{selectedDirectory\.name\} while this tab is open/);
  assert.match(source, /Snapshot\/read-only import/);
  assert.match(source, /physical copies require writable folder access/);
  assert.match(source, /event\.currentTarget\.value = ""/);
});

test("organization and permission status remain visible at responsive widths", () => {
  assert.match(source, /<p>Organization<\/p>/);
  assert.match(source, /Originals are preserved\./);
  assert.match(css, /\.sidebar-foot small \{ display:block; margin-top:4px; font-size:12px; \}/);
  assert.match(css, /\.stage-list \{ display:grid; grid-template-columns:repeat\(5,1fr\)/);
  assert.match(css, /@media \(max-width:920px\)[\s\S]*?\.sidebar-foot \{ display:block; margin-top:14px; \}/);
});

test("stale folder reads cannot commit over a newer workspace", () => {
  assert.match(source, /intakeGenerationRef/);
  assert.match(source, /const generation = \+\+intakeGenerationRef\.current/);
  assert.match(source, /if \(generation !== intakeGenerationRef\.current\) return/);
});

test("direct folder enumeration and polling are bounded", () => {
  assert.match(source, /MAX_LOCAL_FILES/);
  assert.match(source, /if \(fileCount >= MAX_LOCAL_FILES\)/);
  assert.match(source, /const WATCH_INTERVAL_MS = 5_000/);
  assert.match(source, /window\.setInterval\(refreshWhenActive, WATCH_INTERVAL_MS\)/);
});
