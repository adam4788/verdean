/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { isLocalDocumentAiEnabled } from "../lib/document-intelligence/access.ts";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  DOCUMENT_AI_BASE_URL?: string;
  DOCUMENT_AI_API_KEY?: string;
  DOCUMENT_AI_MODEL?: string;
  DOCUMENT_AI_PROVIDER?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The deployed Worker has no authentication or durable rate limiting for
    // inference. Keep the endpoint fail-closed on every non-loopback host;
    // exact loopback requests fall through to the local app route.
    if (url.pathname === "/api/document-intelligence"
      && !isLocalDocumentAiEnabled(url.hostname, env.DOCUMENT_AI_BASE_URL)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) {
        return Response.json(
          { error: "Cross-origin document extraction is not allowed." },
          { status: 403, headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" } },
        );
      }
      return Response.json(
        { error: "Production document intelligence is disabled until authenticated access and durable rate limiting are configured." },
        { status: 503, headers: { "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" } },
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
