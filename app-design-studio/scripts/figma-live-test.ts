/**
 * Live Figma import test — end-to-end against the real Figma REST API.
 *
 * Reads FIGMA_TOKEN + FIGMA_TEST_URL from .env.figma-test (gitignored),
 * fetches the node tree, resolves images, runs the full converter, and
 * dumps before/after proof. The token is NEVER printed or logged.
 *
 * Setup:
 *   1. Edit .env.figma-test — paste your token + a Figma frame URL.
 *   2. npx tsx scripts/figma-live-test.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { figmaResponseToScreens } from "@/lib/ir";
import { irChildrenToHtml } from "@/lib/ir/core/ir-to-html";
import { parseFigmaUrl } from "@/lib/ir/formats/figma/api-types";
import type {
  FigmaFileImagesResponse,
  FigmaImagesResponse,
  FigmaNode,
  FigmaNodesResponse,
} from "@/lib/ir/formats/figma/api-types";

const OUT_DIR = resolve(process.cwd(), "scripts/.evidence/figma-live");

/** Minimal .env parser — avoids the dotenv dependency. Handles KEY=value,
 * quotes, and # comments. Only used for local test credentials. */
async function loadEnv(path: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  let src = "";
  try { src = await readFile(path, "utf8"); } catch { /* file missing */ }
  for (const line of src.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = await loadEnv(resolve(process.cwd(), ".env.figma-test"));
const TOKEN = env.FIGMA_TOKEN?.trim();
const URL_ = env.FIGMA_TEST_URL?.trim();

if (!TOKEN || !URL_) {
  console.error(
    "Set FIGMA_TOKEN and FIGMA_TEST_URL in .env.figma-test first.\n" +
      "The token is read from env only — it is never printed or logged.",
  );
  process.exit(1);
}

function collectImageRefs(node: unknown, refs: Set<string>, ids: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (typeof n.id === "string" && typeof n.type === "string") {
    if (["VECTOR", "LINE", "STAR", "POLYGON", "BOOLEAN_OPERATION", "REGULAR_POLYGON"].includes(n.type)) {
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
  if (Array.isArray(n.children)) for (const c of n.children) collectImageRefs(c, refs, ids);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const parsed = parseFigmaUrl(URL_);
  if (!parsed) {
    console.error("Could not parse the Figma URL. Expected: https://www.figma.com/design/<key>/<title>?node-id=…");
    process.exit(1);
  }
  const { fileKey, nodeId } = parsed;
  console.log(`File key:  ${fileKey}`);
  console.log(`Node id:   ${nodeId}`);
  console.log(`Fetching node tree from Figma…`);

  // 1. Node tree.
  const nodesUrl = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=10`;
  const nodesRes = await fetch(nodesUrl, { headers: { "X-Figma-Token": TOKEN } });
  if (nodesRes.status === 401 || nodesRes.status === 403) {
    console.error("Figma rejected the token (HTTP 401/403). Check FIGMA_TOKEN in .env.figma-test.");
    process.exit(1);
  }
  if (nodesRes.status === 404) {
    console.error("Figma returned 404. Check the URL and that the token has access to the file.");
    process.exit(1);
  }
  if (!nodesRes.ok) {
    const err = (await nodesRes.json().catch(() => null)) as { err?: string } | null;
    console.error(`Figma API error (HTTP ${nodesRes.status}): ${err?.err || "unknown"}`);
    process.exit(1);
  }
  const nodesResponse = (await nodesRes.json()) as FigmaNodesResponse;

  // 2. Images — two endpoints (imageRefs vs vector node ids).
  const imageRefs = new Set<string>();
  const vectorIds = new Set<string>();
  for (const entry of Object.values(nodesResponse.nodes)) {
    collectImageRefs(entry.document, imageRefs, vectorIds);
  }
  const images: Record<string, string> = {};
  if (imageRefs.size) {
    console.log(`Resolving ${imageRefs.size} image fill(s)…`);
    const fileImagesRes = await fetch(`https://api.figma.com/v1/files/${fileKey}/images`, {
      headers: { "X-Figma-Token": TOKEN },
    });
    if (fileImagesRes.ok) {
      const fileImages = (await fileImagesRes.json()) as FigmaFileImagesResponse;
      Object.assign(images, fileImages.meta.images);
    } else {
      console.warn(`file/images returned HTTP ${fileImagesRes.status}.`);
    }
  }
  if (vectorIds.size) {
    console.log(`Rasterizing ${vectorIds.size} vector(s)…`);
    const ids = encodeURIComponent([...vectorIds].join(","));
    const rasterRes = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${ids}&format=png`,
      { headers: { "X-Figma-Token": TOKEN } },
    );
    if (rasterRes.ok) {
      const rasterized = (await rasterRes.json()) as FigmaImagesResponse;
      for (const [id, url] of Object.entries(rasterized.images)) {
        if (url) images[id] = url;
      }
    } else {
      console.warn(`images rasterize returned HTTP ${rasterRes.status}.`);
    }
  }

  // Before: the raw Figma response.
  await writeFile(resolve(OUT_DIR, "01-figma-raw.json"), JSON.stringify(nodesResponse, null, 2), "utf8");

  // 3. Convert.
  const { screens, warnings, name } = figmaResponseToScreens(nodesResponse, { images });
  const screensHtml = await Promise.all(
    screens.map(async (s) => ({
      id: s.id,
      name: s.name,
      html: await irChildrenToHtml(s.nodes),
    })),
  );

  // After: canvas HTML per screen + a rendered preview doc.
  await writeFile(resolve(OUT_DIR, "02-canvas-screens.json"), JSON.stringify(screensHtml, null, 2), "utf8");
  const preview = [
    "<!doctype html>",
    "<html><head><meta charset='utf-8'>",
    "<style>",
    "body { margin:0; background:#f6f7fb; font-family: Inter, system-ui, sans-serif; }",
    ".stage { display:flex; gap:32px; padding:32px; flex-wrap:wrap; }",
    ".screen { position:relative; background:#fff; overflow:hidden; box-shadow:0 24px 70px rgba(15,23,42,0.18); }",
    ".label { color:#374151; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin:0 0 12px; }",
    ".col { display:flex; flex-direction:column; }",
    "</style></head><body>",
    `<div class="stage">`,
    ...screensHtml.map(
      (s) =>
        `<div class="col"><p class="label">${s.name}</p><div class="screen" data-screen="${s.id}" style="width:${nodesResponse.nodes[Object.keys(nodesResponse.nodes)[0]].document.width ?? 375}px; height:${nodesResponse.nodes[Object.keys(nodesResponse.nodes)[0]].document.height ?? 812}px">${s.html}</div></div>`,
    ),
    `</div>`,
    "</body></html>",
  ].join("\n");
  await writeFile(resolve(OUT_DIR, "03-preview.html"), preview, "utf8");

  const countNodes = (n: unknown): number => {
    if (!n || typeof n !== "object") return 0;
    const node = n as Record<string, unknown>;
    let c = 1;
    if (Array.isArray(node.children)) for (const ch of node.children) c += countNodes(ch);
    return c;
  };
  const total = Object.values(nodesResponse.nodes).reduce((a, e) => a + countNodes(e.document), 0);

  console.log("\n=== LIVE FIGMA IMPORT ===");
  console.log(`Source:      ${name}`);
  console.log(`Screens:     ${screens.length}`);
  console.log(`Figma nodes: ${total}`);
  console.log(`Images:      ${Object.keys(images).length} resolved`);
  console.log(`Warnings:    ${warnings.length}`);
  warnings.slice(0, 10).forEach((w) => console.log(`  - ${w}`));
  if (warnings.length > 10) console.log(`  …and ${warnings.length - 10} more`);
  console.log(`\nOutput:`);
  console.log(`  ${OUT_DIR}/01-figma-raw.json       (what Figma returned)`);
  console.log(`  ${OUT_DIR}/02-canvas-screens.json  (HTML that lands on canvas)`);
  console.log(`  ${OUT_DIR}/03-preview.html         (open in browser to compare to Figma)`);
  console.log(`\nNext: open 03-preview.html in a browser and compare it side-by-side`);
  console.log(`with the Figma frame. Any visible drift = a bug to file.`);
}

main().catch((e) => {
  console.error("Live test failed:", e);
  process.exit(1);
});
