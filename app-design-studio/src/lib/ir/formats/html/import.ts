import { ensureIds, sanitizeHtml } from "@/lib/pro/htmlUtils";
import type { Project } from "@/lib/screen-schema";
import { assembleImportedProject } from "../../core/assemble";
import { HTML_EXPORT_MARKER, type HtmlExportMeta } from "./export";

/**
 * HTML → canvas project fields.
 *
 * Two cases:
 *  1. Our own export (marker comment present): reconstruct every screen with
 *     its original id/name/role and the exact design-system CSS — a full
 *     multi-screen, zero-drift roundtrip with no side manifest.
 *  2. Arbitrary HTML: callers keep using the existing single-screen pipeline
 *     (parseHtmlToArtifact → buildWebsiteProject); this module only handles
 *     detection + our-export parsing so that proven path stays untouched.
 */

export function isSleekHtmlExport(code: string): boolean {
  return code.includes(HTML_EXPORT_MARKER);
}

export type ParsedHtmlExport = {
  meta: HtmlExportMeta;
  screens: { id: string; name: string; role: string; html: string }[];
  designSystemCss: string;
};

export function parseSleekHtmlExport(code: string): ParsedHtmlExport {
  const markerMatch = code.match(
    new RegExp(
      `<!--\\s*${HTML_EXPORT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*({[\\s\\S]*?})\\s*-->`,
    ),
  );
  if (!markerMatch) throw new Error("Not a sleek.design HTML export.");
  const meta = JSON.parse(markerMatch[1].replace(/\\u002d/g, "-")) as HtmlExportMeta;

  const doc = new DOMParser().parseFromString(code, "text/html");

  // Design CSS = every <style> except the tagged viewer chrome.
  const designSystemCss = Array.from(doc.querySelectorAll("style"))
    .filter((s) => !s.hasAttribute("data-sleek-viewer"))
    .map((s) => s.textContent || "")
    .join("\n")
    .trim();

  const sections = Array.from(doc.querySelectorAll("section.sleek-screen[data-screen-id]"));
  if (!sections.length) throw new Error("The export contains no screens.");

  const screens = sections.map((section, i) => {
    const id = section.getAttribute("data-screen-id") || `screen-${i + 1}`;
    const declared = meta.screens.find((s) => s.id === id);
    return {
      id,
      name: declared?.name || `Screen ${i + 1}`,
      role: declared?.role || "screen",
      // Same canonicalization every canvas entry path applies.
      html: ensureIds(sanitizeHtml(section.innerHTML.trim())),
    };
  });

  return { meta, screens, designSystemCss };
}

/** Assemble a full Project from a parsed sleek HTML export. */
export function projectFromSleekHtmlExport(parsed: ParsedHtmlExport): Project {
  const { meta, screens, designSystemCss } = parsed;
  return assembleImportedProject({
    name: meta.name || "Imported HTML",
    idea: `Imported HTML export: ${meta.name || "Untitled"}`,
    screens,
    designSystemCss,
    artifactType: meta.artifactType,
    frame: meta.frame,
  });
}
