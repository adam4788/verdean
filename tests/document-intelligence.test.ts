import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDocumentImage,
  extractDocumentPage,
  normalizeExtraction,
  resolveDocumentAiConfig,
} from "../lib/document-intelligence/provider.ts";

test("normalizes model boxes from 0-1000 coordinates to bounded percentages", () => {
  const result = normalizeExtraction({
    documentType: "Security addendum",
    summary: "Four material security commitments.",
    fields: [
      {
        label: "incident_notification",
        value: "Within 72 hours",
        confidence: 97.4,
        box: { left: 80, top: 200, width: 500, height: 24 },
      },
      {
        label: "small_box",
        value: "Top left",
        confidence: 91,
        box: { left: 50, top: 50, width: 80, height: 15 },
      },
    ],
  });

  assert.deepEqual(result.fields[0], {
    id: "incident-notification",
    label: "Incident notification",
    value: "Within 72 hours",
    confidence: 97,
    box: { left: 8, top: 20, width: 50, height: 2.4 },
  });
  assert.deepEqual(result.fields[1]?.box, { left: 5, top: 5, width: 8, height: 1.5 });
});

test("uses the local Hermes subscription proxy in development and requires explicit production config", () => {
  assert.deepEqual(resolveDocumentAiConfig({ NODE_ENV: "development" }), {
    baseUrl: "http://127.0.0.1:8645/v1",
    apiKey: "sk-unused",
    model: "google/gemini-3.7-flash",
    provider: "Hermes subscription proxy",
  });
  assert.throws(() => resolveDocumentAiConfig({ NODE_ENV: "production" }), /not configured/i);
});

test("rejects unsupported or oversized page images before provider inference", () => {
  assert.throws(() => assertDocumentImage("application/pdf", 100), /PNG, JPEG, or WebP/i);
  assert.doesNotThrow(() => assertDocumentImage("image/png", 850_000));
  assert.throws(() => assertDocumentImage("image/png", 850_001), /850 KB/i);
});

test("sends a structured multimodal request through the configured provider", async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    request = { url: String(input), init: init ?? {} };
    return Response.json({
      model: "test-vision-model",
      choices: [{
        message: {
          content: JSON.stringify({
            documentType: "Invoice",
            summary: "Invoice total and due date.",
            fields: [{
              label: "Total",
              value: "$1,250.00",
              confidence: 94,
              box: { left: 100, top: 300, width: 250, height: 40 },
            }],
          }),
        },
      }],
    });
  };

  const result = await extractDocumentPage({
    name: "invoice-page-1.jpg",
    mimeType: "image/jpeg",
    bytes: new Uint8Array([1, 2, 3]),
    pageNumber: 1,
    width: 1000,
    height: 1400,
  }, {
    environment: {
      NODE_ENV: "production",
      DOCUMENT_AI_BASE_URL: "https://vision.example/v1",
      DOCUMENT_AI_API_KEY: "secret",
      DOCUMENT_AI_MODEL: "test-vision-model",
      DOCUMENT_AI_PROVIDER: "Test provider",
    },
    fetch: fakeFetch,
  });

  assert.equal(request?.url, "https://vision.example/v1/chat/completions");
  assert.match(String(request?.init.headers && new Headers(request.init.headers).get("authorization")), /^Bearer secret$/);
  const payload = JSON.parse(String(request?.init.body));
  assert.equal(payload.response_format.type, "json_schema");
  assert.match(payload.messages[0].content, /untrusted data/i);
  assert.match(payload.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(result.provider, "Test provider");
  assert.equal(result.model, "test-vision-model");
  assert.deepEqual(result.fields[0]?.box, { left: 10, top: 30, width: 25, height: 4 });
});
