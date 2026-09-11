const exactLoopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const workspaceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkspaceAccessError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function assertWorkspaceRequest(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!exactLoopbackHosts.has(url.hostname)) {
    throw new WorkspaceAccessError("Workspace database access is local-only until authenticated production access is configured.", 503);
  }
  if (!mutation) return;
  if (request.headers.get("origin") !== url.origin) {
    throw new WorkspaceAccessError("Workspace writes require a same-origin request.", 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new WorkspaceAccessError("Workspace writes require application/json.", 415);
  }
}

export function workspaceIdFromRequest(request: Request) {
  const id = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!workspaceId.test(id)) throw new WorkspaceAccessError("Workspace id must be a UUID.", 400);
  return id;
}
