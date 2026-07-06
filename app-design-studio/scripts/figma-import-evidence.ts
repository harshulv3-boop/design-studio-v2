/**
 * Figma import evidence report.
 *
 * Feeds a realistic Figma REST /nodes response (the exact wire format Figma
 * returns) through the full converter and produces before/after proof:
 *   - 01-figma-source.json  (what Figma's API gave us)
 *   - 02-canvas.html        (what lands on your canvas)
 *
 * No token needed — this validates the converter (the hard part), not the
 * upstream fetch (which is just an authenticated GET). A live test with a
 * real token is the user's final acceptance step via the UI.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { figmaResponseToScreens } from "@/lib/ir";
import { irChildrenToHtml } from "@/lib/ir/core/ir-to-html";
import type { FigmaNodesResponse } from "@/lib/ir/formats/figma/api-types";

const OUT_DIR = resolve(process.cwd(), "scripts/.evidence/figma-import");

// A realistic Figma file: a mobile dashboard screen with the elements a real
// designer would build — gradient hero, shadowed card, CTA button with a bold
// word, an avatar image, a 2-column grid. Mirrors what Figma's REST API
// actually returns (0..1 colors, gradientTransform, characterStyleOverrides,
// imageRef for image fills).
const figmaResponse: FigmaNodesResponse = {
  name: "Mobile Dashboard",
  lastModified: "2024-06-10T12:00:00Z",
  version: "1234567890",
  nodes: {
    "1:0": {
      document: {
        id: "1:0",
        name: "Dashboard",
        type: "FRAME",
        x: 0,
        y: 0,
        width: 375,
        height: 812,
        fills: [{ type: "SOLID", color: { r: 0.965, g: 0.969, b: 0.984, a: 1 } }],
        clipsContent: true,
        children: [
          // H1 title
          {
            id: "1:1",
            name: "Title",
            type: "TEXT",
            x: 20,
            y: 56,
            width: 335,
            height: 36,
            characters: "Dashboard",
            style: {
              fontFamily: "Inter",
              fontWeight: 800,
              fontSize: 30,
              lineHeightPx: 36,
              letterSpacing: -0.6,
              textAlignHorizontal: "LEFT",
              fills: [{ type: "SOLID", color: { r: 0.063, g: 0.075, b: 0.102, a: 1 } }],
            },
            characterStyleOverrides: [],
          },
          // Gradient hero card with drop shadow
          {
            id: "1:2",
            name: "Hero Card",
            type: "RECTANGLE",
            x: 20,
            y: 112,
            width: 335,
            height: 140,
            cornerRadius: 18,
            fills: [
              {
                type: "GRADIENT_LINEAR",
                gradientStops: [
                  { position: 0, color: { r: 0.427, g: 0.369, b: 0.949, a: 1 } },
                  { position: 1, color: { r: 0.655, g: 0.545, b: 0.980, a: 1 } },
                ],
                // Matches our export's 135deg → atan2(1,0)=90 → +90 = 180... let's
                // use Figma's actual representation of 135deg.
                gradientTransform: [[0.707, 0.707, 0], [-0.707, 0.707, 0]],
              },
            ],
            effects: [
              {
                type: "DROP_SHADOW",
                color: { r: 0.118, g: 0.106, b: 0.294, a: 0.4 },
                offset: { x: 0, y: 10 },
                radius: 30,
                spread: 0,
              },
            ],
          },
          // CTA button "Buy now" with "now" bold via style override
          {
            id: "1:3",
            name: "Buy CTA",
            type: "TEXT",
            x: 20,
            y: 280,
            width: 335,
            height: 48,
            characters: "Buy now",
            style: {
              fontFamily: "Inter",
              fontWeight: 600,
              fontSize: 15,
              lineHeightPx: 22,
              textAlignHorizontal: "CENTER",
              fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
            },
            characterStyleOverrides: [0, 0, 0, 0, 1, 1, 1],
            styleOverrideTable: { "1": { fontWeight: 700 } },
          },
          // Button background (rectangle behind the text)
          {
            id: "1:4",
            name: "Button BG",
            type: "RECTANGLE",
            x: 20,
            y: 280,
            width: 335,
            height: 48,
            cornerRadius: 12,
            fills: [{ type: "SOLID", color: { r: 0.427, g: 0.369, b: 0.949, a: 1 } }],
          },
          // Avatar image (resolved via /v1/images → imageRef maps to URL)
          {
            id: "1:5",
            name: "Avatar",
            type: "RECTANGLE",
            x: 20,
            y: 360,
            width: 40,
            height: 40,
            cornerRadius: 20,
            fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "img-avatar" }],
          },
          // A 2-column grid as nested frames
          {
            id: "1:6",
            name: "Stats Row",
            type: "FRAME",
            x: 20,
            y: 430,
            width: 335,
            height: 64,
            children: [
              {
                id: "1:7",
                name: "Card A",
                type: "RECTANGLE",
                x: 0,
                y: 0,
                width: 160,
                height: 64,
                cornerRadius: 12,
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                strokes: [{ type: "SOLID", color: { r: 0.902, g: 0.91, b: 0.925, a: 1 } }],
                strokeWeight: 1,
              },
              {
                id: "1:8",
                name: "Card B",
                type: "RECTANGLE",
                x: 175,
                y: 0,
                width: 160,
                height: 64,
                cornerRadius: 12,
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                strokes: [{ type: "SOLID", color: { r: 0.902, g: 0.91, b: 0.925, a: 1 } }],
                strokeWeight: 1,
              },
            ],
          },
        ],
      },
    },
  },
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Before: the Figma source.
  await writeFile(
    resolve(OUT_DIR, "01-figma-source.json"),
    JSON.stringify(figmaResponse, null, 2),
    "utf8",
  );

  // Run the converter with a resolved image URL for the avatar.
  const { screens, warnings, name } = figmaResponseToScreens(figmaResponse, {
    images: { "img-avatar": "https://placehold.co/40x40/6d5ef2/ffffff.png" },
  });

  // After: canvas HTML per screen.
  const screensHtml = await Promise.all(
    screens.map(async (s) => ({
      id: s.id,
      name: s.name,
      html: await irChildrenToHtml(s.nodes),
    })),
  );

  // Render a standalone preview doc (open in browser to eyeball parity).
  const preview = [
    "<!doctype html>",
    "<html><head><meta charset='utf-8'>",
    "<style>",
    "body { margin:0; background:#f6f7fb; font-family: Inter, system-ui, sans-serif; }",
    ".stage { display:flex; gap:32px; padding:32px; flex-wrap:wrap; }",
    ".screen { position:relative; width:375px; height:812px; background:#f6f7fb; overflow:hidden; border-radius:32px; box-shadow:0 24px 70px rgba(15,23,42,0.18); }",
    "</style></head><body>",
    `<div class="stage">`,
    ...screensHtml.map(
      (s) => `<div class="screen" data-screen="${s.id}">${s.html}</div>`,
    ),
    `</div>`,
    "</body></html>",
  ].join("\n");

  await writeFile(resolve(OUT_DIR, "02-canvas.html"), preview, "utf8");
  await writeFile(
    resolve(OUT_DIR, "03-screens.json"),
    JSON.stringify(screensHtml, null, 2),
    "utf8",
  );

  const nodeCount = (n: unknown): number => {
    if (!n || typeof n !== "object") return 0;
    const node = n as Record<string, unknown>;
    let count = 1;
    if (Array.isArray(node.children)) {
      for (const c of node.children) count += nodeCount(c);
    }
    return count;
  };
  const figmaCount = Object.values(figmaResponse.nodes).reduce(
    (a, e) => a + nodeCount(e.document),
    0,
  );

  console.log("=== FIGMA IMPORT EVIDENCE ===");
  console.log(`Source:        ${name}`);
  console.log(`Screens:       ${screens.length}`);
  console.log(`Figma nodes:   ${figmaCount}`);
  console.log(`Warnings:      ${warnings.length}`);
  warnings.slice(0, 5).forEach((w) => console.log(`  - ${w}`));
  console.log(`\nOutput:`);
  console.log(`  ${OUT_DIR}/01-figma-source.json  (what Figma gave us)`);
  console.log(`  ${OUT_DIR}/02-canvas.html        (rendered preview — open in browser)`);
  console.log(`  ${OUT_DIR}/03-screens.json       (HTML that lands in the canvas)`);
}

main().catch((e) => {
  console.error("Evidence run failed:", e);
  process.exit(1);
});
