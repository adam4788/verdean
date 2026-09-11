import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

async function render(pathname = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...(init.headers ?? {}) },
      ...init,
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Verdean quote-to-contract validation dashboard", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Verdean — Quote-to-contract validation agent<\/title>/i);
  assert.match(html, /<link rel="canonical" href="http:\/\/localhost:3000\/?"/i);
  assert.match(html, /verdean-horizontal\.svg/i);
  assert.match(html, /favicon\.ico/i);
  assert.match(html, /Find what changed before you sign/);
  assert.match(html, /Connect a folder/);
  assert.match(html, /Choose individual files/);
  assert.match(html, /No folder connected/);
  assert.doesNotMatch(html, /Review the example|Reset demo|Demo workspace|AI-generated fictional samples/i);
  assert.doesNotMatch(html, /Review summary|What the agent found|Mark reviewed/);
});

test("ships a Verdean social-card source", async () => {
  const source = await readFile(new URL("../public/og-source.svg", import.meta.url), "utf8");
  assert.match(source, /Verdean/);
  assert.match(source, /Every promise, reconciled/);
});


test("production document intelligence rejects cross-origin uploads and remains disabled", async () => {
  const crossOrigin = await render("/api/document-intelligence", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(crossOrigin.status, 403);
  assert.match(crossOrigin.headers.get("cache-control") ?? "", /no-store/i);
  const response = await render("/api/document-intelligence", { method: "POST", headers: { origin: "http://localhost", "content-type": "image/jpeg", "x-page-number": "1", "x-page-width": "100", "x-page-height": "100" }, body: new Uint8Array([255, 216, 255, 217]) });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /authenticated access.*rate limiting/i);
});
