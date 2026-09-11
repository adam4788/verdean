import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrganizationPlan,
  fingerprintFile,
  managedCopyName,
  organizationFolderForKind,
  requestReadWritePermission,
  safeOutputBasename,
  syncOrganizationPlan,
  type DirectoryHandleLike,
  type FileLike,
} from "../lib/verdean/organization.ts";

function file(name: string, text = "contents", lastModified = 1): FileLike {
  return { name, size: text.length, lastModified, text: async () => text };
}

type MemoryDirectory = DirectoryHandleLike & { children: Map<string, unknown>; writes: string[]; calls: string[] };

function memoryDirectory(name = "Source", failWrites = new Set<string>()): MemoryDirectory {
  const children = new Map<string, MemoryDirectory | { name: string; kind: "file"; createWritable(): Promise<{ write(value: FileLike): Promise<void>; close(): Promise<void> }> }>();
  const writes: string[] = [];
  const calls: string[] = [];
  return {
    name,
    kind: "directory",
    children,
    writes,
    calls,
    async getDirectoryHandle(childName, options) {
      calls.push(`directory:${childName}:${Boolean(options?.create)}`);
      const existing = children.get(childName);
      if (existing) return existing as MemoryDirectory;
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      const child = memoryDirectory(childName, failWrites);
      children.set(childName, child);
      return child;
    },
    async getFileHandle(childName, options) {
      calls.push(`file:${childName}:${Boolean(options?.create)}`);
      const existing = children.get(childName);
      if (existing) return existing as never;
      if (!options?.create) throw new DOMException("Not found", "NotFoundError");
      const handle = {
        kind: "file" as const,
        name: childName,
        async createWritable() {
          if (failWrites.has(`${name}/${childName}`)) throw new Error("disk full");
          return {
            async write(value: FileLike) { writes.push(`${name}/${childName}:${await value.text()}`); },
            async close() {},
          };
        },
      };
      children.set(childName, handle);
      return handle;
    },
  };
}

test("maps every document kind to its non-destructive Verdean destination", () => {
  assert.equal(organizationFolderForKind("quote"), "Quotes");
  assert.equal(organizationFolderForKind("invoice"), "Invoices");
  assert.equal(organizationFolderForKind("contract"), "Contracts");
  assert.equal(organizationFolderForKind("email"), "Emails");
  assert.equal(organizationFolderForKind("transcript"), "Transcripts");
  assert.equal(organizationFolderForKind("other"), "Needs Review");
  assert.equal(organizationFolderForKind("queued"), "Needs Review");
});

test("sanitizes untrusted source names into one bounded output basename", () => {
  const safe = safeOutputBasename("../folder\\..\\evil\u0000-name.very-long-extension");
  assert.equal(safe.extension, ".verylongex");
  assert.equal(Array.from(`${safe.stem}${safe.extension}`).some((character) => {
    const code = character.charCodeAt(0);
    return character === "/" || character === "\\" || code <= 0x1f || code === 0x7f;
  }), false);
  assert.ok(!safe.stem.includes(".."));
  assert.ok(safe.stem.length <= 80);
  const name = managedCopyName({ file: file("../../" + "x".repeat(200) + ".txt"), folder: "Quotes", fingerprint: "x" }, "token");
  assert.ok(!/[\\/]/.test(name));
  assert.ok(name.length < 180);
});

test("builds a complete bulk plan and sends unsupported and unreadable files to Needs Review", async () => {
  let pdfReads = 0;
  const unreadable: FileLike = { name: "unreadable.txt", size: 2, lastModified: 1, text: async () => { throw new Error("locked"); } };
  const pdf: FileLike = { name: "scan.pdf", size: 1, lastModified: 1, text: async () => { pdfReads += 1; throw new Error("must not read"); } };
  const plan = await buildOrganizationPlan([
    file("quote.txt", "Quote ID: Q-1"),
    file("invoice.txt", "Invoice ID: INV-1\nQuote reference: Q-1"),
    file("contract.txt", "Contract ID: C-1"),
    file("mail.txt", "From: buyer@example.test\nSubject: hello"),
    file("call.txt", "CALL TRANSCRIPT\nParticipants: buyer"),
    pdf,
    unreadable,
  ]);

  assert.deepEqual(plan.map((item) => [item.file.name, item.folder]), [
    ["quote.txt", "Quotes"], ["invoice.txt", "Invoices"], ["contract.txt", "Contracts"], ["mail.txt", "Emails"], ["call.txt", "Transcripts"], ["scan.pdf", "Needs Review"], ["unreadable.txt", "Needs Review"],
  ]);
  assert.equal(pdfReads, 0);
  assert.match(plan.find((item: { file: FileLike; reason?: string }) => item.file.name === "unreadable.txt")?.reason ?? "", /locked/);
});

test("does not organize macOS metadata files", async () => {
  let reads = 0;
  const metadata: FileLike = { name: ".DS_Store", size: 32, lastModified: 1, text: async () => { reads += 1; return "metadata"; } };
  const plan = await buildOrganizationPlan([metadata, file("quote.txt", "Quote ID: Q-1")]);

  assert.equal(reads, 0);
  assert.deepEqual(plan.map((item) => item.file.name), ["quote.txt"]);
});

test("does not read oversized or over-limit supported files while planning", async () => {
  let reads = 0;
  const oversized: FileLike = { name: "oversized.txt", size: 2_000_001, lastModified: 1, text: async () => { reads += 1; return "Quote ID: Q-1"; } };
  const many = Array.from({ length: 101 }, (_, index) => ({ name: `file-${index}.txt`, size: 1, lastModified: 1, text: async () => { reads += 1; return "Quote ID: Q-1"; } }));
  const plan = await buildOrganizationPlan([oversized, ...many]);
  assert.equal(reads, 99);
  assert.equal(plan[0]?.folder, "Needs Review");
  assert.equal(plan.at(-1)?.folder, "Needs Review");
});

test("copies every planned file under _Verdean without deleting sources", async () => {
  const source = memoryDirectory();
  const plan = await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1")]);
  const token = "first-copy";
  const result = await syncOrganizationPlan(source, plan, { createToken: () => token });

  assert.equal(result.copied, 1);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.errors, []);
  const output = source.children.get("_Verdean") as ReturnType<typeof memoryDirectory>;
  const quotes = output.children.get("Quotes") as ReturnType<typeof memoryDirectory>;
  const safeName = managedCopyName(plan[0], token);
  assert.deepEqual(quotes.writes, [`Quotes/${safeName}:Quote ID: Q-1`]);
  assert.equal(source.children.has("quote.txt"), false);
});

test("sync skips a remembered same-session destination and remains idempotent", async () => {
  const source = memoryDirectory();
  const plan = await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1")]);
  const options = { createToken: () => "same-session" };
  const first = await syncOrganizationPlan(source, plan, options);
  const second = await syncOrganizationPlan(source, plan, options);

  assert.equal(first.copied, 1);
  assert.equal(second.skipped, 1);
  assert.equal(second.copied, 0);
});

test("protects unrelated same-name files with a collision-resistant versioned copy", async () => {
  const source = memoryDirectory();
  const output = await source.getDirectoryHandle("_Verdean", { create: true }) as MemoryDirectory;
  const quotes = await output.getDirectoryHandle("Quotes", { create: true }) as MemoryDirectory;
  const existing = await quotes.getFileHandle("quote.txt", { create: true });
  const existingWriter = await existing.createWritable();
  await existingWriter.write(file("quote.txt", "user-owned contents"));
  await existingWriter.close();

  const item = (await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1", 42)]))[0];
  const token = "safe-target";
  const result = await syncOrganizationPlan(source, [item], { createToken: () => token });
  const safeName = managedCopyName(item, token);

  assert.equal(result.copied, 1);
  assert.equal(result.skipped, 0);
  assert.ok(quotes.children.has("quote.txt"));
  assert.ok(quotes.children.has(safeName));
  assert.deepEqual(quotes.writes, [
    "Quotes/quote.txt:user-owned contents",
    `Quotes/${safeName}:Quote ID: Q-1`,
  ]);
});

test("retries with a new token when a managed-looking destination already exists", async () => {
  const source = memoryDirectory();
  const output = await source.getDirectoryHandle("_Verdean", { create: true }) as MemoryDirectory;
  const quotes = await output.getDirectoryHandle("Quotes", { create: true }) as MemoryDirectory;
  const item = (await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1", 77)]))[0];
  const collisionName = managedCopyName(item, "collision");
  const collision = await quotes.getFileHandle(collisionName, { create: true });
  const collisionWriter = await collision.createWritable();
  await collisionWriter.write(file(collisionName, "unrelated managed-looking file"));
  await collisionWriter.close();
  const tokens = ["collision", "next"];

  const result = await syncOrganizationPlan(source, [item], { createToken: () => tokens.shift() ?? "fallback" });
  const nextName = managedCopyName(item, "next-1");

  assert.equal(result.copied, 1);
  assert.equal(result.skipped, 0);
  assert.ok(quotes.children.has(collisionName));
  assert.ok(quotes.children.has(nextName));
  assert.deepEqual(quotes.writes, [
    `Quotes/${collisionName}:unrelated managed-looking file`,
    `Quotes/${nextName}:Quote ID: Q-1`,
  ]);
});

test("skips a destination that appears during the final collision re-check", async () => {
  const source = memoryDirectory();
  const plan = await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1", 99)]);
  const targetName = managedCopyName(plan[0]!, "race");
  const output = await source.getDirectoryHandle("_Verdean", { create: true }) as MemoryDirectory;
  const quotes = await output.getDirectoryHandle("Quotes", { create: true }) as MemoryDirectory;
  let checks = 0;
  const original = quotes.getFileHandle.bind(quotes);
  quotes.getFileHandle = async (name, options) => {
    if (name === targetName && !options?.create && ++checks === 2) await original(name, { create: true });
    return original(name, options);
  };
  const result = await syncOrganizationPlan(source, plan, { createToken: () => "race" });
  assert.equal(result.copied, 0);
  assert.equal(result.skipped, 1);
  assert.ok(quotes.children.has(targetName));
  assert.equal(quotes.writes.length, 0);
});

test("reports individual copy failures without stopping the rest of the plan", async () => {
  const plan = await buildOrganizationPlan([file("bad.txt", "Quote ID: Q-1"), file("good.txt", "From: buyer@example.test\nSubject: hello")]);
  const token = "failure-target";
  const source = memoryDirectory("Source", new Set([`Quotes/${managedCopyName(plan[0], token)}`]));

  const result = await syncOrganizationPlan(source, plan, { createToken: () => token });
  assert.equal(result.errors.length, 1);
  assert.equal(result.copied, 1);
  assert.match(result.errors[0]?.message ?? "", /disk full/);
});

test("empty plans do not create output folders and root failures are reported", async () => {
  const emptySource = memoryDirectory();
  assert.deepEqual(await syncOrganizationPlan(emptySource, []), { copied: 0, skipped: 0, errors: [] });
  assert.deepEqual(emptySource.calls, []);

  const blocked = memoryDirectory();
  blocked.getDirectoryHandle = async () => { throw new Error("read-only volume"); };
  const result = await syncOrganizationPlan(blocked, await buildOrganizationPlan([file("quote.txt", "Quote ID: Q-1")]));
  assert.equal(result.copied, 0);
  assert.equal(result.errors[0]?.name, "_Verdean");
  assert.match(result.errors[0]?.message ?? "", /read-only volume/);
});

test("requests readwrite permission only when it is not already granted", async () => {
  const calls: string[] = [];
  const granted = await requestReadWritePermission({
    async queryPermission(descriptor) { calls.push(`query:${descriptor.mode}`); return "prompt"; },
    async requestPermission(descriptor) { calls.push(`request:${descriptor.mode}`); return "granted"; },
  });
  assert.equal(granted, true);
  assert.deepEqual(calls, ["query:readwrite", "request:readwrite"]);

  let requested = false;
  assert.equal(await requestReadWritePermission({
    async queryPermission(descriptor) { assert.equal(descriptor.mode, "readwrite"); return "granted"; },
    async requestPermission() { requested = true; return "denied"; },
  }), true);
  assert.equal(requested, false);

  assert.equal(await requestReadWritePermission({
    async queryPermission() { return "prompt"; },
    async requestPermission(descriptor) { assert.equal(descriptor.mode, "readwrite"); return "denied"; },
  }), false);
  assert.equal(fingerprintFile(file("quote.txt", "one", 4)), "quote.txt:3:4");
});
