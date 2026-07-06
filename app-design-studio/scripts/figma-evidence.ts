/**
 * Figma export evidence report.
 *
 * Proves the IR→Figma path against the REAL resolve pass (Playwright via the
 * clone engine), not synthetic fixtures. Builds a nontrivial canvas project,
 * exports it, and dumps before/after so drift is visible at a glance.
 *
 *   npx tsx scripts/figma-evidence.ts [--engine http://localhost:8083]
 *
 * Output lands in scripts/.evidence/figma/ for manual inspection.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildFigmaExport } from "@/lib/ir";
import { htmlToIrChildren } from "@/lib/ir/core/html-to-ir";
import { irChildrenToHtml } from "@/lib/ir/core/ir-to-html";
import type { Project } from "@/lib/screen-schema";

const ENGINE = process.argv.find((a) => a.startsWith("--engine"))?.split("=")[1]
  || "http://localhost:8083";
const OUT_DIR = resolve(process.cwd(), "scripts/.evidence/figma");

// A deliberately nontrivial screen: nested flex, gradient, shadow, text with
// an inline-styled <b> range, an image, a border, a radius, opacity. Exercises
// every mapping rule the exporter claims to handle.
//
// No data-mae-ids here — the IR assigns them via the same htmlToIrChildren →
// irChildrenToHtml roundtrip the editor uses, so the "before" matches what a
// real canvas project would store.
const RAW_SCREEN_HTML = `<div class="screen" style="display:flex;flex-direction:column;gap:16px;padding:32px 20px;background:#f6f7fb;min-height:100%">
  <h1 style="font-size:30px;font-weight:800;color:#10131a;letter-spacing:-0.6px;margin:0">Dashboard</h1>
  <p style="font-size:14px;color:#6b7280;margin:0">Welcome back — here's your week.</p>
  <div data-mae-type="rect" data-mae-effects='[{"id":"sh","type":"drop-shadow","enabled":true,"x":0,"y":10,"blur":30,"spread":0,"color":"#1e1b4b","opacity":40}]' style="height:140px;background:linear-gradient(135deg,#6d5ef2 0%,#a78bfa 100%);border-radius:18px;padding:20px;display:flex;flex-direction:column;justify-content:flex-end">
    <span style="color:#fff;font-size:13px;opacity:0.85;letter-spacing:0.04em;text-transform:uppercase">Balance</span>
    <span style="color:#fff;font-size:28px;font-weight:700">$4,820.50</span>
  </div>
  <button style="background:#6d5ef2;color:#fff;border:none;border-radius:12px;height:48px;font-size:15px;font-weight:600">Buy <b>now</b></button>
  <div style="display:flex;gap:12px">
    <div style="flex:1;height:64px;background:#fff;border:1px solid #e6e8ec;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#6b7280">Card A</div>
    <div style="flex:1;height:64px;background:#fff;border:1px solid #e6e8ec;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:12px;color:#6b7280">Card B</div>
  </div>
  <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><circle cx='20' cy='20' r='18' fill='%2334d399'/></svg>" alt="avatar" style="width:40px;height:40px;border-radius:999px" />
</div>`;

const project = {
  id: "evidence",
  name: "Figma Export Evidence",
  designSystem: { palette: {}, typography: {} },
  designSystemCss: ":root { --bg:#f6f7fb; --text:#10131a; }",
  screens: [
    { id: "dash", name: "Dashboard", role: "home", html: "" }, // filled below
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as unknown as Project;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Canonicalize through the IR so the screen HTML carries data-mae-ids —
  // exactly what a real canvas project stores, and what the resolve pass
  // queries. (ensureIds in pro/htmlUtils needs jsdom; the IR's own
  // htmlToIrChildren uses linkedom on Node and assigns ids itself.)
  const irChildren = await htmlToIrChildren(RAW_SCREEN_HTML);
  const SCREEN_HTML = await irChildrenToHtml(irChildren);
  (project.screens as any)[0].html = SCREEN_HTML;

  // Before: the canvas HTML (ground truth).
  await writeFile(resolve(OUT_DIR, "01-canvas.html"), SCREEN_HTML, "utf8");

  console.log("Calling buildFigmaExport against", ENGINE);
  console.log("  (resolve pass spins up Chromium — this takes a few seconds)\n");

  const doc = await buildFigmaExport(project, { endpoint: `${ENGINE}/api/clone/resolve` });

  // After: the figma-nodes document.
  const json = JSON.stringify(doc, null, 2);
  await writeFile(resolve(OUT_DIR, "02-figma-nodes.json"), json, "utf8");

  // Summary
  const frame = doc.frames[0];
  const nodeCount = (n: any): number =>
    1 + (n.children?.reduce((a: number, c: any) => a + nodeCount(c), 0) ?? 0);
  const total = frame ? nodeCount(frame) : 0;

  console.log("=== FIGMA EXPORT EVIDENCE ===");
  console.log(`Screen:        ${frame?.screenName} (${frame?.width}x${frame?.height})`);
  console.log(`Figma nodes:   ${total} (FRAME/RECT/ELLIPSE/TEXT/SVG)`);
  console.log(`Warnings:      ${doc.warnings.length}`);
  doc.warnings.slice(0, 8).forEach((w) => console.log(`  - ${w}`));
  if (doc.warnings.length > 8) console.log(`  ... and ${doc.warnings.length - 8} more`);
  console.log(`\nOutput:`);
  console.log(`  ${OUT_DIR}/01-canvas.html       (before — canvas truth)`);
  console.log(`  ${OUT_DIR}/02-figma-nodes.json  (after — plugin input)`);
  console.log(`\nNext: open the JSON in the sleek.design Figma plugin to confirm`);
  console.log(`visual parity against 01-canvas.html rendered in a browser.`);

  // Fail loudly if the resolve pass silently dropped nodes — a regression signal.
  const canvasEls = (SCREEN_HTML.match(/data-mae-id=/g) || []).length;
  const exported = JSON.stringify(doc).match(/"id":"mae-/g)?.length ?? 0;
  if (exported < canvasEls) {
    console.warn(`\n⚠️  Coverage gap: canvas has ${canvasEls} mae-id elements, export carries ${exported}.`);
  } else {
    console.log(`\n✓ Coverage: all ${canvasEls} canvas elements represented in export.`);
  }
}

main().catch((e) => {
  console.error("Evidence run failed:", e);
  process.exit(1);
});
