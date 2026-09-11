import {
  DocumentAiError,
  extractDocumentPage,
  type DocumentAiEnvironment,
} from "../../../lib/document-intelligence/provider.ts";
import { isLocalDocumentAiEnabled } from "../../../lib/document-intelligence/access.ts";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const MAX_PAGE_BYTES = 850_000;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

export function strictIntegerHeader(request: Request, name: string, minimum: number, maximum: number) {
  const raw = request.headers.get(name) ?? "";
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new DocumentAiError(`${name} must be an integer from ${minimum} to ${maximum}.`, 400);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new DocumentAiError(`${name} must be an integer from ${minimum} to ${maximum}.`, 400);
  }
  return value;
}

export async function readLimitedBody(request: Request, maximum = MAX_PAGE_BYTES) {
  if (!request.body) throw new DocumentAiError("A rendered page image is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) {
      await reader.cancel("Document page exceeds the byte limit.");
      throw new DocumentAiError("The rendered page exceeds the 850 KB inference limit.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function providerEnvironment(): DocumentAiEnvironment {
  return {
    NODE_ENV: process.env.NODE_ENV,
    DOCUMENT_AI_BASE_URL: process.env.DOCUMENT_AI_BASE_URL,
    DOCUMENT_AI_API_KEY: process.env.DOCUMENT_AI_API_KEY,
    DOCUMENT_AI_MODEL: process.env.DOCUMENT_AI_MODEL,
    DOCUMENT_AI_PROVIDER: process.env.DOCUMENT_AI_PROVIDER,
  };
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return json({ error: "Cross-origin document extraction is not allowed." }, 403);
  }

  if (!isLocalDocumentAiEnabled(requestUrl.hostname, process.env.DOCUMENT_AI_BASE_URL)) {
    return json({ error: "Production document intelligence is disabled until authenticated access and durable rate limiting are configured." }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PAGE_BYTES) {
    return json({ error: "Document intelligence requests are limited to 850 KB." }, 413);
  }
  const mimeType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^(image\/png|image\/jpeg|image\/webp)$/.test(mimeType)) {
    return json({ error: "Upload one rendered PNG, JPEG, or WebP document page." }, 415);
  }

  try {
    const pageNumber = strictIntegerHeader(request, "x-page-number", 1, 50);
    const width = strictIntegerHeader(request, "x-page-width", 1, 10_000);
    const height = strictIntegerHeader(request, "x-page-height", 1, 10_000);
    const bytes = await readLimitedBody(request);
    const result = await extractDocumentPage({
      name: `uploaded-document-page-${pageNumber}`,
      mimeType,
      bytes,
      pageNumber,
      width,
      height,
    }, { environment: providerEnvironment() });
    return json(result);
  } catch (error) {
    if (error instanceof DocumentAiError) return json({ error: error.message }, error.status);
    return json({ error: "Document intelligence could not process this page." }, 500);
  }
}
