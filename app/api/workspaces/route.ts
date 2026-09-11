import { getD1 } from "../../../db/index.ts";
import { deleteWorkspace, readWorkspaceCounts, readWorkspaceSnapshot, saveWorkspaceSnapshot } from "../../../lib/verdean/database.ts";
import { WorkspaceAccessError, assertWorkspaceRequest, workspaceIdFromRequest } from "../../../lib/verdean/workspace-access.ts";
import { parseWorkspaceSnapshot } from "../../../lib/verdean/workspace.ts";

export const dynamic = "force-dynamic";

const MAX_SNAPSHOT_BYTES = 1_000_000;
const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

async function readBoundedJson(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SNAPSHOT_BYTES) throw new WorkspaceAccessError("Workspace snapshots are limited to 1 MB.", 413);
  if (!request.body) throw new WorkspaceAccessError("A workspace snapshot is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SNAPSHOT_BYTES) {
      await reader.cancel("Workspace snapshot exceeds the byte limit.");
      throw new WorkspaceAccessError("Workspace snapshots are limited to 1 MB.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new WorkspaceAccessError("Workspace snapshot must be valid JSON.", 400);
  }
}

export async function GET(request: Request) {
  try {
    assertWorkspaceRequest(request);
    const workspaceId = workspaceIdFromRequest(request);
    const row = await readWorkspaceSnapshot(getD1(), workspaceId);
    if (!row) return json({ error: "Workspace not found." }, 404);
    const persisted = await readWorkspaceCounts(getD1(), workspaceId);
    return json({ workspace: parseWorkspaceSnapshot(row.snapshot_json), persisted, version: row.updated_at });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return json({ error: error.message }, error.status);
    console.error("Verdean workspace GET failed", error);
    return json({ error: "Verdean could not read the workspace database." }, 500);
  }
}

export async function PUT(request: Request) {
  try {
    assertWorkspaceRequest(request, true);
    const snapshot = parseWorkspaceSnapshot(await readBoundedJson(request));
    const expectedVersion = request.headers.get("x-workspace-version") ?? "";
    if (expectedVersion.length > 100) throw new WorkspaceAccessError("Workspace version is invalid.", 400);
    const newVersion = crypto.randomUUID();
    await saveWorkspaceSnapshot(getD1(), snapshot, expectedVersion, newVersion);
    const saved = await readWorkspaceSnapshot(getD1(), snapshot.id);
    if (!saved) return json({ error: "The workspace write could not be verified." }, 500);
    if (saved.updated_at !== newVersion) return json({ error: "Workspace changed in another tab. Reload before saving again." }, 409);
    const verified = parseWorkspaceSnapshot(saved.snapshot_json);
    if (verified.updatedAt !== snapshot.updatedAt) return json({ error: "The workspace write could not be verified." }, 500);
    const persisted = await readWorkspaceCounts(getD1(), snapshot.id);
    return json({ workspace: verified, persisted, version: newVersion });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return json({ error: error.message }, error.status);
    if (error instanceof Error && /Workspace|analysis\.|raw source text/i.test(error.message)) return json({ error: error.message }, 400);
    console.error("Verdean workspace PUT failed", error);
    return json({ error: "Verdean could not save the workspace database." }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    assertWorkspaceRequest(request, true);
    const workspaceId = workspaceIdFromRequest(request);
    await deleteWorkspace(getD1(), workspaceId);
    const remaining = await readWorkspaceSnapshot(getD1(), workspaceId);
    if (remaining) return json({ error: "The workspace reset could not be verified." }, 500);
    return json({ deleted: true, workspaceId });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return json({ error: error.message }, error.status);
    console.error("Verdean workspace DELETE failed", error);
    return json({ error: "Verdean could not reset the workspace database." }, 500);
  }
}
