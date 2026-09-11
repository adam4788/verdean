import assert from "node:assert/strict";
import test from "node:test";

import { POST, readLimitedBody, strictIntegerHeader } from "../app/api/document-intelligence/route.ts";

test("allows document intelligence on an exact loopback host in Vinext development", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousNodeEnvironment = environment.NODE_ENV;
  const previousBaseUrl = environment.DOCUMENT_AI_BASE_URL;
  environment.NODE_ENV = "production";
  environment.DOCUMENT_AI_BASE_URL = "http://127.0.0.1:8645/v1";

  try {
    const response = await POST(new Request("http://localhost/api/document-intelligence", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "text/plain",
      },
    }));

    assert.equal(response.status, 415);
  } finally {
    if (previousNodeEnvironment === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnvironment;
    if (previousBaseUrl === undefined) delete environment.DOCUMENT_AI_BASE_URL;
    else environment.DOCUMENT_AI_BASE_URL = previousBaseUrl;
  }
});

test("keeps document intelligence disabled without an explicit loopback provider", async () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousBaseUrl = environment.DOCUMENT_AI_BASE_URL;
  delete environment.DOCUMENT_AI_BASE_URL;

  try {
    const response = await POST(new Request("http://localhost/api/document-intelligence", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "text/plain",
      },
    }));

    assert.equal(response.status, 503);
  } finally {
    if (previousBaseUrl === undefined) delete environment.DOCUMENT_AI_BASE_URL;
    else environment.DOCUMENT_AI_BASE_URL = previousBaseUrl;
  }
});

test("streams and rejects a document page body beyond the hard byte limit", async () => {
  const allowed = await readLimitedBody(new Request("http://localhost/api/document-intelligence", {
    method: "POST",
    body: new Uint8Array(850_000),
  }));
  assert.equal(allowed.byteLength, 850_000);

  await assert.rejects(
    () => readLimitedBody(new Request("http://localhost/api/document-intelligence", {
      method: "POST",
      body: new Uint8Array(850_001),
    })),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 413,
  );
});

test("requires complete decimal integer header values", () => {
  for (const value of ["1junk", "1.5", "+1", "01"]) {
    assert.throws(() => strictIntegerHeader(new Request("http://localhost", { headers: { "x-page-number": value } }), "x-page-number", 1, 50), /must be an integer/);
  }
  assert.equal(strictIntegerHeader(new Request("http://localhost", { headers: { "x-page-number": "1" } }), "x-page-number", 1, 50), 1);
});
