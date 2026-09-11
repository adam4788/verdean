const LOCAL_DOCUMENT_AI_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackHost(hostname: string) {
  return LOCAL_DOCUMENT_AI_HOSTS.has(hostname.toLowerCase());
}

export function isLocalDocumentAiEnabled(requestHostname: string, configuredBaseUrl?: string) {
  if (!isLoopbackHost(requestHostname) || !configuredBaseUrl) return false;

  try {
    return isLoopbackHost(new URL(configuredBaseUrl).hostname);
  } catch {
    return false;
  }
}
