import { createFileRoute } from "@tanstack/react-router";

/**
 * Thin proxy to the URL→Code clone engine (a separate service — see
 * INTEGRATION_PLAN.md). Keeps the engine URL server-side, avoids CORS
 * coupling, and preserves the engine's SSRF posture.
 *
 *   POST /api/clone/start                → engine POST /api/clone/start
 *   GET  /api/clone/:id/status           → engine GET  /api/clone/:id/status
 *   GET  /api/clone/:id/editable         → engine GET  ...
 *   GET  /api/clone/:id/screenshot       → engine GET  ...
 *   GET  /api/clone/:id/download         → engine GET  ... (zip stream)
 */
const ENGINE_URL = process.env.CLONE_ENGINE_URL || "http://localhost:8081";

const ALLOWED = /^(start|[a-zA-Z0-9-]+\/(status|editable|screenshot|download))$/;

async function proxy(request: Request, splat: string): Promise<Response> {
  if (!ALLOWED.test(splat)) {
    return Response.json({ error: "Unknown clone endpoint" }, { status: 404 });
  }
  const target = `${ENGINE_URL}/api/clone/${splat}`;
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers:
        request.method === "POST"
          ? { "content-type": request.headers.get("content-type") || "application/json" }
          : undefined,
      body: request.method === "POST" ? await request.arrayBuffer() : undefined,
    });
    const headers = new Headers();
    for (const h of ["content-type", "content-disposition", "content-length"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json(
      { error: "Clone engine is not reachable. Start it with: PORT=8081 (see RUN_LOCAL.md)" },
      { status: 502 },
    );
  }
}

export const Route = createFileRoute("/api/clone/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => proxy(request, (params as any)._splat ?? ""),
      POST: async ({ request, params }) => proxy(request, (params as any)._splat ?? ""),
    },
  },
});
