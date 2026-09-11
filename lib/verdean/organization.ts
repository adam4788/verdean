import { classifyDocument, isIgnoredLocalFile, MAX_LOCAL_FILES, MAX_LOCAL_FILE_BYTES, SUPPORTED_LOCAL_FILE, type DocumentKind } from "./domain.ts";

export const VERDEAN_OUTPUT_DIRECTORY = "_Verdean";
export const ORGANIZATION_FOLDERS = ["Quotes", "Invoices", "Contracts", "Emails", "Transcripts", "Needs Review"] as const;
export type OrganizationFolder = (typeof ORGANIZATION_FOLDERS)[number];

export type FileLike = {
  name: string;
  size: number;
  lastModified: number;
  text(): Promise<string>;
};

export type WritableFileHandleLike = {
  name: string;
  kind: "file";
  createWritable(): Promise<{ write(value: FileLike): Promise<void>; close(): Promise<void> }>;
};

export type DirectoryHandleLike = {
  name: string;
  kind: "directory";
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileHandleLike>;
};

export type PermissionHandleLike = {
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
};

export type OrganizationPlanItem = { file: FileLike; folder: OrganizationFolder; fingerprint: string; reason?: string };
export type OrganizationSyncResult = { copied: number; skipped: number; errors: { name: string; message: string }[] };

export function organizationFolderForKind(kind: DocumentKind): OrganizationFolder {
  switch (kind) {
    case "quote": return "Quotes";
    case "invoice": return "Invoices";
    case "contract": return "Contracts";
    case "email": return "Emails";
    case "transcript": return "Transcripts";
    default: return "Needs Review";
  }
}

export function fingerprintFile(file: Pick<FileLike, "name" | "size" | "lastModified">): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function managedCopyName(item: OrganizationPlanItem, token: string): string {
  const { stem, extension } = safeOutputBasename(item.file.name);
  const safeToken = token.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32) || "copy";
  return `${stem}--verdean-${item.file.size}-${item.file.lastModified}-${safeToken}${extension}`;
}

/** Converts an untrusted source name into one bounded, separator-free basename. */
export function safeOutputBasename(sourceName: string): { stem: string; extension: string } {
  const cleaned = Array.from(sourceName.normalize("NFKC"), (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? "" : character;
  }).join("").replace(/[\\/]/g, "-");
  const dot = cleaned.lastIndexOf(".");
  const rawStem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const rawExtension = dot > 0 ? cleaned.slice(dot + 1) : "";
  const sanitize = (value: string) => value
    .replace(/\.{2,}/g, "-")
    .replace(/[^a-zA-Z0-9._ -]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/g, "")
    .replace(/-+/g, "-")
    .trim();
  const stem = (sanitize(rawStem).slice(0, 80) || "document");
  const extensionValue = sanitize(rawExtension).replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  return { stem, extension: extensionValue ? `.${extensionValue}` : "" };
}

export async function buildOrganizationPlan(files: Iterable<FileLike>): Promise<OrganizationPlanItem[]> {
  const plan: OrganizationPlanItem[] = [];
  let seen = 0;
  for (const file of files) {
    if (isIgnoredLocalFile(file.name)) continue;
    seen += 1;
    if (!SUPPORTED_LOCAL_FILE.test(file.name)) {
      plan.push({ file, folder: "Needs Review", fingerprint: fingerprintFile(file), reason: "Unsupported file type; queued for manual review." });
      continue;
    }
    if (seen > MAX_LOCAL_FILES) {
      plan.push({ file, folder: "Needs Review", fingerprint: fingerprintFile(file), reason: `Folder exceeds the ${MAX_LOCAL_FILES}-file local read limit; queued for manual review.` });
      continue;
    }
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      plan.push({ file, folder: "Needs Review", fingerprint: fingerprintFile(file), reason: "File exceeds the 2 MB local read limit; queued for manual review." });
      continue;
    }
    try {
      const text = await file.text();
      const kind = classifyDocument({ name: file.name, text });
      plan.push({ file, folder: organizationFolderForKind(kind), fingerprint: fingerprintFile(file) });
    } catch (cause) {
      plan.push({
        file,
        folder: "Needs Review",
        fingerprint: fingerprintFile(file),
        reason: cause instanceof Error ? cause.message : "Unable to read file.",
      });
    }
  }
  return plan;
}

export async function requestReadWritePermission(directory: PermissionHandleLike): Promise<boolean> {
  const descriptor = { mode: "readwrite" } as const;
  const current = await directory.queryPermission?.(descriptor);
  if (current === "granted") return true;
  return (await directory.requestPermission?.(descriptor)) === "granted";
}

async function destinationExists(directory: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

type OrganizationSyncOptions = { createToken?: () => string };
const rememberedTargets = new WeakMap<object, Map<string, string>>();

function defaultToken(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function syncOrganizationPlan(source: DirectoryHandleLike, plan: Iterable<OrganizationPlanItem>, options: OrganizationSyncOptions = {}): Promise<OrganizationSyncResult> {
  const result: OrganizationSyncResult = { copied: 0, skipped: 0, errors: [] };
  const items = [...plan];
  if (items.length === 0) return result;
  const createToken = options.createToken ?? defaultToken;
  let targets = rememberedTargets.get(source);
  if (!targets) {
    targets = new Map();
    rememberedTargets.set(source, targets);
  }
  let output: DirectoryHandleLike;
  try {
    output = await source.getDirectoryHandle(VERDEAN_OUTPUT_DIRECTORY, { create: true });
  } catch (cause) {
    result.errors.push({ name: VERDEAN_OUTPUT_DIRECTORY, message: cause instanceof Error ? cause.message : "Unable to create Verdean output directory." });
    return result;
  }
  for (const item of items) {
    try {
      const destination = await output.getDirectoryHandle(item.folder, { create: true });
      const targetKey = `${item.folder}:${item.fingerprint}`;
      const rememberedName = targets.get(targetKey);
      if (rememberedName && await destinationExists(destination, rememberedName)) {
        result.skipped += 1;
        continue;
      }

      let attempt = 0;
      let targetName = rememberedName ?? managedCopyName(item, createToken());
      while (await destinationExists(destination, targetName) && attempt < 10) {
        attempt += 1;
        targetName = managedCopyName(item, `${createToken()}-${attempt}`);
      }
      // File System Access API has no atomic create-new primitive. Re-check as
      // late as possible and never intentionally open a known existing file
      // writable; a concurrent create after this check cannot be eliminated by
      // this API and is documented as a platform limitation.
      if (await destinationExists(destination, targetName)) {
        result.skipped += 1;
        continue;
      }
      const target = await destination.getFileHandle(targetName, { create: true });
      const writable = await target.createWritable();
      await writable.write(item.file);
      await writable.close();
      targets.set(targetKey, targetName);
      result.copied += 1;
    } catch (cause) {
      result.errors.push({ name: item.file.name, message: cause instanceof Error ? cause.message : "Unable to copy file." });
    }
  }
  return result;
}
