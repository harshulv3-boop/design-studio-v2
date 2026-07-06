import type { Project } from "@/lib/screen-schema";
import { projectToIr } from "../../core/project-bridge";
import { irChildrenToHtml } from "../../core/ir-to-html";

/**
 * Canvas → standalone HTML document, via IR.
 *
 * The document is fully re-importable with zero drift and no side manifest:
 * a marker comment carries screen/frame metadata (names, roles, frame size),
 * and each screen is emitted as a top-level section keyed by data-screen-id.
 * All editor conventions (data-mae-*, data-nav-*) ride along in the markup
 * itself, so import reconstructs the exact same project.
 */

export const HTML_EXPORT_MARKER = "sleek.design html export v1";

export type HtmlExportMeta = {
  name: string;
  artifactType: "app" | "website" | "figma";
  frame: { w: number; h?: number };
  screens: { id: string; name: string; role: string }[];
};

export async function buildHtmlExport(project: Project): Promise<string> {
  const ir = await projectToIr(project);
  const meta: HtmlExportMeta = {
    name: ir.meta.name,
    artifactType: ir.meta.artifactType,
    frame: ir.meta.frame,
    screens: ir.screens.map((s) => ({ id: s.id, name: s.name, role: s.role })),
  };

  const sections = await Promise.all(
    ir.screens.map(
      async (screen) =>
        `<section class="sleek-screen" data-screen-id="${escapeAttr(screen.id)}">\n${await irChildrenToHtml(screen.nodes)}\n</section>`,
    ),
  );

  const frameWidth = ir.meta.frame.w;
  return [
    "<!doctype html>",
    `<!-- ${HTML_EXPORT_MARKER} ${JSON.stringify(meta).replace(/--/g, "\\u002d\\u002d")} -->`,
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeText(ir.meta.name)}</title>`,
    "<style>",
    ir.stylesheet.raw,
    "</style>",
    `<style data-sleek-viewer="1">`,
    // Viewer chrome only — tagged so import strips it, and namespaced so it
    // can never collide with design CSS.
    `body{margin:0;background:#f4f5f7}` +
      `.sleek-screen{width:${frameWidth}px;margin:32px auto;overflow:hidden;background:#fff;box-shadow:0 24px 70px rgba(15,23,42,.18)}`,
    "</style>",
    "</head>",
    "<body>",
    sections.join("\n"),
    "</body>",
    "</html>",
  ].join("\n");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
