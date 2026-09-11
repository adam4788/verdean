import type { DocumentPageExtraction } from "./provider";

export type RenderedDocumentPage = {
  pageNumber: number;
  width: number;
  height: number;
  blob: Blob;
  previewUrl: string;
};

export type RenderedDocument = {
  pages: RenderedDocumentPage[];
  totalPages: number;
  truncated: boolean;
};

type FileDescriptor = { name: string; type: string };

const MAX_RENDERED_PAGES = 6;
const MAX_DIMENSION = 1_800;
export const MAX_DOCUMENT_SOURCE_BYTES = 10_000_000;
export const MAX_SOURCE_DIMENSION = 10_000;
export const MAX_SOURCE_PIXELS = 40_000_000;
const DOCUMENT_FILE = /\.(pdf|png|jpe?g|webp)$/i;

/** A deterministic occurrence ordinal distinguishes otherwise identical files. */
export function documentFileIdentity(file: Pick<File, "name" | "size" | "lastModified" | "webkitRelativePath">, duplicateOrdinal: number) {
  return `${file.webkitRelativePath || file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${duplicateOrdinal}`;
}

export function documentFileIdentities(files: readonly File[]) {
  const occurrences = new Map<string, number>();
  return files.map((file) => {
    const base = `${file.webkitRelativePath || file.name}\u0000${file.size}\u0000${file.lastModified}`;
    const duplicateOrdinal = occurrences.get(base) ?? 0;
    occurrences.set(base, duplicateOrdinal + 1);
    return { file, identity: documentFileIdentity(file, duplicateOrdinal) };
  });
}

/** Preserves full-intake occurrence identities when a polling pass selects a subset. */
export function documentIntelligenceIntake(files: readonly File[], selectedFiles: readonly File[] = files) {
  const entries = documentFileIdentities(files);
  const selected = new Set(selectedFiles);
  const visualEntries = entries.filter(({ file }) => isDocumentIntelligenceFile(file));
  return {
    visualEntries,
    selectedVisualEntries: visualEntries.filter(({ file }) => selected.has(file)),
  };
}

export function isDocumentIntelligenceFile(file: FileDescriptor) {
  if (!file.type) return DOCUMENT_FILE.test(file.name);
  if (file.type === "application/pdf") return /\.pdf$/i.test(file.name);
  if (file.type === "image/png") return /\.png$/i.test(file.name);
  if (file.type === "image/jpeg") return /\.jpe?g$/i.test(file.name);
  if (file.type === "image/webp") return /\.webp$/i.test(file.name);
  return false;
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = Math.max(1, Math.round(width));
  element.height = Math.max(1, Math.round(height));
  const context = element.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot render document pages.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, element.width, element.height);
  return { element, context };
}

export async function encodeJpegWithinLimit(element: HTMLCanvasElement) {
  for (const quality of [0.84, 0.72, 0.6, 0.48, 0.36]) {
    const blob = await new Promise<Blob>((resolve, reject) => {
      element.toBlob((candidate) => candidate ? resolve(candidate) : reject(new Error("Could not encode the rendered page.")), "image/jpeg", quality);
    });
    if (blob.size <= 800_000) return blob;
  }
  throw new Error("Could not prepare the rendered page for document intelligence.");
}

function scaleToFit(width: number, height: number) {
  const longest = Math.max(width, height);
  return longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
}

function imageDimensions(bytes: Uint8Array, mimeType: string): { width: number; height: number } | null {
  if (mimeType === "image/png" && bytes.length >= 24 && String.fromCharCode(...bytes.subarray(1, 4)) === "PNG") {
    return { width: new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(0), height: new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(4) };
  }
  if (mimeType === "image/webp" && bytes.length >= 30 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...bytes.subarray(12, 16));
    if (kind === "VP8X") return { width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16), height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16) };
    if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff };
    if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  if (mimeType === "image/jpeg") {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1]!;
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[offset + 5]! << 8) + bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) + bytes[offset + 8]! };
      offset += 2 + length;
    }
  }
  return null;
}

export async function assertDocumentIntelligenceSource(file: File) {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_DOCUMENT_SOURCE_BYTES) {
    throw new Error(`Document source files must be at most ${MAX_DOCUMENT_SOURCE_BYTES / 1_000_000} MB.`);
  }
  const mimeType = file.type || (/.png$/i.test(file.name) ? "image/png" : /\.jpe?g$/i.test(file.name) ? "image/jpeg" : /\.webp$/i.test(file.name) ? "image/webp" : "");
  if (!mimeType.startsWith("image/")) return;
  const dimensions = imageDimensions(new Uint8Array(await file.slice(0, 65_536).arrayBuffer()), mimeType);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_SOURCE_DIMENSION || dimensions.height > MAX_SOURCE_DIMENSION || dimensions.width * dimensions.height > MAX_SOURCE_PIXELS) {
    throw new Error("Document image dimensions exceed the safe intake budget.");
  }
}

async function renderImage(file: File, signal?: AbortSignal): Promise<RenderedDocument> {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(file);
  try {
    signal?.throwIfAborted();
    const scale = scaleToFit(bitmap.width, bitmap.height);
    const { element, context } = canvas(bitmap.width * scale, bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, element.width, element.height);
    const blob = await encodeJpegWithinLimit(element);
    return {
      pages: [{ pageNumber: 1, width: element.width, height: element.height, blob, previewUrl: URL.createObjectURL(blob) }],
      totalPages: 1,
      truncated: false,
    };
  } finally {
    bitmap.close();
  }
}

async function renderPdf(file: File, signal?: AbortSignal): Promise<RenderedDocument> {
  signal?.throwIfAborted();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const abortLoading = () => { void loadingTask.destroy(); };
  signal?.addEventListener("abort", abortLoading, { once: true });
  let pdf: Awaited<typeof loadingTask.promise>;
  try {
    signal?.throwIfAborted();
    pdf = await loadingTask.promise;
  } catch (error) {
    signal?.removeEventListener("abort", abortLoading);
    await loadingTask.destroy();
    if (signal?.aborted) throw new DOMException("Document rendering was cancelled.", "AbortError");
    throw error;
  }
  const pages: RenderedDocumentPage[] = [];
  const totalPages = pdf.numPages;
  const count = Math.min(totalPages, MAX_RENDERED_PAGES);

  try {
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(pageNumber);
      try {
        const initial = page.getViewport({ scale: 1.7 });
        const fit = scaleToFit(initial.width, initial.height);
        const viewport = page.getViewport({ scale: 1.7 * fit });
        const { element, context } = canvas(viewport.width, viewport.height);
        await page.render({ canvas: element, canvasContext: context, viewport }).promise;
        signal?.throwIfAborted();
        const blob = await encodeJpegWithinLimit(element);
        pages.push({ pageNumber, width: element.width, height: element.height, blob, previewUrl: URL.createObjectURL(blob) });
      } finally {
        page.cleanup();
      }
    }
  } catch (error) {
    for (const page of pages) URL.revokeObjectURL(page.previewUrl);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortLoading);
    await loadingTask.destroy();
  }

  return { pages, totalPages, truncated: totalPages > count };
}

export async function renderDocument(file: File, signal?: AbortSignal): Promise<RenderedDocument> {
  if (!isDocumentIntelligenceFile(file)) throw new Error("This file does not need visual document intelligence.");
  await assertDocumentIntelligenceSource(file);
  signal?.throwIfAborted();
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return renderPdf(file, signal);
  return renderImage(file, signal);
}

export async function extractRenderedPage(
  page: RenderedDocumentPage,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<DocumentPageExtraction> {
  const response = await (options.fetch ?? fetch)("/api/document-intelligence", {
    method: "POST",
    headers: {
      "content-type": page.blob.type || "image/jpeg",
      "x-page-number": String(page.pageNumber),
      "x-page-width": String(page.width),
      "x-page-height": String(page.height),
    },
    body: page.blob,
    signal: options.signal,
  });
  const body = await response.json().catch(() => ({})) as DocumentPageExtraction & { error?: string };
  if (!response.ok) throw new Error(body.error || `Document intelligence failed (${response.status}).`);
  return body;
}

export function releaseRenderedDocument(document: RenderedDocument) {
  for (const page of document.pages) URL.revokeObjectURL(page.previewUrl);
}
