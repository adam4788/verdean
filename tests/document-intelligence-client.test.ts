import assert from "node:assert/strict";
import test from "node:test";

import { assertDocumentIntelligenceSource, documentIntelligenceIntake, encodeJpegWithinLimit, isDocumentIntelligenceFile, MAX_DOCUMENT_SOURCE_BYTES } from "../lib/document-intelligence/client.ts";

test("routes PDFs and page images to document intelligence without intercepting local text analysis", () => {
  assert.equal(isDocumentIntelligenceFile({ name: "contract.pdf", type: "application/pdf" }), true);
  assert.equal(isDocumentIntelligenceFile({ name: "scan.PNG", type: "" }), true);
  assert.equal(isDocumentIntelligenceFile({ name: "quote.txt", type: "text/plain" }), false);
  assert.equal(isDocumentIntelligenceFile({ name: "archive.zip", type: "application/zip" }), false);
  assert.equal(isDocumentIntelligenceFile({ name: "vector.svg", type: "image/svg+xml" }), false);
  assert.equal(isDocumentIntelligenceFile({ name: "photo.heic", type: "image/heic" }), false);
  assert.equal(isDocumentIntelligenceFile({ name: "renamed.pdf", type: "application/zip" }), false);
});

test("keeps full-intake identities when selecting changed visual files", () => {
  const text = { name: "notes.txt", type: "text/plain", size: 5, lastModified: 10 } as File;
  const firstDuplicate = { name: "scan.png", type: "image/png", size: 20, lastModified: 11 } as File;
  const secondDuplicate = { name: "scan.png", type: "image/png", size: 20, lastModified: 11 } as File;
  const pdf = { name: "contract.pdf", type: "application/pdf", size: 30, lastModified: 12 } as File;

  const intake = documentIntelligenceIntake([text, firstDuplicate, secondDuplicate, pdf], [secondDuplicate, pdf]);

  assert.deepEqual(intake.visualEntries.map(({ file }) => file), [firstDuplicate, secondDuplicate, pdf]);
  assert.notEqual(intake.visualEntries[0]?.identity, intake.visualEntries[1]?.identity);
  assert.deepEqual(intake.selectedVisualEntries.map(({ file }) => file), [secondDuplicate, pdf]);
  assert.equal(intake.selectedVisualEntries[0]?.identity, intake.visualEntries[1]?.identity);
});

test("rejects a rendered JPEG when the lowest safe quality remains above the provider limit", async () => {
  const qualities: number[] = [];
  const canvas = {
    toBlob(callback: BlobCallback, _type?: string, quality?: number) {
      qualities.push(quality!);
      callback(new Blob([new Uint8Array(800_001)], { type: "image/jpeg" }));
    },
  } as unknown as HTMLCanvasElement;

  await assert.rejects(() => encodeJpegWithinLimit(canvas), /Could not prepare the rendered page/i);
  assert.deepEqual(qualities, [0.84, 0.72, 0.6, 0.48, 0.36]);
});

test("rejects oversized sources and unsafe image dimensions before bitmap decoding", async () => {
  const oversized = { name: "huge.pdf", type: "application/pdf", size: MAX_DOCUMENT_SOURCE_BYTES + 1, slice() { throw new Error("must not parse"); } } as unknown as File;
  await assert.rejects(() => assertDocumentIntelligenceSource(oversized), /at most/);

  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(16, 10_001);
  new DataView(png.buffer).setUint32(20, 10_001);
  const unsafeImage = { name: "bomb.png", type: "image/png", size: png.length, slice() { return new Blob([png]); } } as unknown as File;
  await assert.rejects(() => assertDocumentIntelligenceSource(unsafeImage), /dimensions exceed/);
});
