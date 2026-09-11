declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    DOCUMENT_AI_BASE_URL?: string;
    DOCUMENT_AI_API_KEY?: string;
    DOCUMENT_AI_MODEL?: string;
    DOCUMENT_AI_PROVIDER?: string;
  }
}
