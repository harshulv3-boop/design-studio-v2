import { createFileRoute } from "@tanstack/react-router";
import { figmaResponseToScreens } from "@/lib/ir";
import { irChildrenToHtml } from "@/lib/ir/core/ir-to-html";
import { parseFigmaUrl } from "@/lib/ir/formats/figma/api-types";
import type { FigmaFileImagesResponse, FigmaImagesResponse, FigmaNodesResponse } from "@/lib/ir/formats/figma/api-types";

/**
 * Figma import — server-side route that talks to the Figma REST API.
 *
 * POST /api/import-figma
 *   body: { url: "<figma share url>", token: "<personal access token>" }
 *
 * Flow:
 *   1. Parse the URL → { fileKey, nodeId }.
 *   2. GET /v1/files/:key/nodes?ids=:nodeId  (the structure tree).
 *   3. Collect every IMAGE fill's imageRef + every VECTOR node id, and
 *      GET /v1/images/:key?ids=…&format=png once to resolve them to URLs.
 *   4. Convert via the IR figma importer → IR children → HTML per screen.
 *   5. Return screens + name so the client can call assembleImportedProject.
 *
 * Token handling: the token is consumed in this request only — it is never
 * logged, persisted, or returned to the client. (Treat as you would a password.)
 */

const FIGMA_BASE = "https://api.figma.com";

type Body = { url?: string; token?: string };

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Walk a Figma node tree, collecting IMAGE fill imageRefs and VECTOR node ids
 * that need rasterization. */
function collectImageRefs(node: unknown, refs: Set<string>, ids: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (typeof n.id === "string" && typeof n.type === "string") {
    const type = n.type as string;
    if (["VECTOR", "LINE", "STAR", "POLYGON", "BOOLEAN_OPERATION", "REGULAR_POLYGON"].includes(type)) {
      ids.add(n.id);
    }
  }
  if (Array.isArray(n.fills)) {
    for (const fill of n.fills) {
      if (fill && typeof fill === "object") {
        const f = fill as Record<string, unknown>;
        if (f.type === "IMAGE" && typeof f.imageRef === "string") refs.add(f.imageRef);
      }
    }
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectImageRefs(child, refs, ids);
  }
}

async function fetchJson<T>(url: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-Figma-Token": token } });
  } catch {
    throw new HttpError(502, "Could not reach Figma's API. Check your network connection.");
  }
  if (res.status === 403 || res.status === 401) {
    throw new HttpError(401, "Figma rejected the token. Generate a personal access token at Figma → Settings → Security.");
  }
  if (res.status === 404) {
    throw new HttpError(404, "Figma file or node not found. Check that the URL is correct and the token has access to the file.");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { err?: string; message?: string } | null;
    throw new HttpError(res.status, data?.err || data?.message || `Figma API error (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

async function renderImport(body: Body): Promise<{
  name: string;
  screens: { id: string; name: string; role: string; html: string }[];
  warnings: string[];
  frame?: { w: number; h: number };
}> {
  const url = (body.url || "").trim();
  const token = (body.token || "").trim();
  if (!url) throw new HttpError(400, "A Figma URL is required.");
  if (!token) throw new HttpError(400, "A Figma personal access token is required.");

  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    throw new HttpError(
      400,
      "Couldn't read that Figma URL. Paste a share link like https://www.figma.com/design/<key>/<title>?node-id=…",
    );
  }
  const { fileKey, nodeId } = parsed;

  // 1. Fetch the node tree.
  const nodesUrl = `${FIGMA_BASE}/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`;
  const nodesResponse = await fetchJson<FigmaNodesResponse>(nodesUrl, token);

  // 2. Resolve assets. Image fills and vectors use DIFFERENT endpoints:
  //    - /v1/files/:key/images   resolves imageRefs (hash strings from
  //      IMAGE fills) to their stored S3 URL.
  //    - /v1/images/:key?ids=…   rasterizes VECTOR/LINE/etc nodes to PNG.
  //  Mixing them in one call returns HTTP 400 (imageRef is "not a valid
  //  node_id"), so two calls are required.
  const imageRefs = new Set<string>();
  const vectorIds = new Set<string>();
  for (const entry of Object.values(nodesResponse.nodes)) {
    collectImageRefs(entry.document, imageRefs, vectorIds);
  }
  const images: Record<string, string> = {};

  if (imageRefs.size) {
    const fileImagesUrl = `${FIGMA_BASE}/v1/files/${fileKey}/images`;
    const fileImages = await fetchJson<FigmaFileImagesResponse>(fileImagesUrl, token);
    // Keyed by imageRef → URL. The converter looks up IMAGE fills by imageRef.
    Object.assign(images, fileImages.meta.images);
  }

  if (vectorIds.size) {
    const ids = encodeURIComponent([...vectorIds].join(","));
    const rasterUrl = `${FIGMA_BASE}/v1/images/${fileKey}?ids=${ids}&format=png`;
    const rasterized = await fetchJson<FigmaImagesResponse>(rasterUrl, token);
    // Keyed by node id → PNG URL. The converter looks up vectors by node id.
    for (const [id, url] of Object.entries(rasterized.images)) {
      if (url) images[id] = url;
    }
  }

  // 3. Convert to IR screens.
  const ir = figmaResponseToScreens(nodesResponse, { images });

  // 4. IR → HTML per screen (the canonical serialization the canvas expects).
  const screens = await Promise.all(
    ir.screens.map(async (screen) => ({
      id: screen.id,
      name: screen.name,
      role: screen.role,
      html: await irChildrenToHtml(screen.nodes),
    })),
  );

  return { name: ir.name, screens, warnings: ir.warnings, frame: ir.frame };
}

export const Route = createFileRoute("/api/import-figma")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        try {
          const result = await renderImport(body);
          return Response.json(result);
        } catch (e) {
          const status = e instanceof HttpError ? e.status : 500;
          const message = e instanceof Error ? e.message : String(e);
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
