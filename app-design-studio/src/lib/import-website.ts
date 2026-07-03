import type { Project } from "./screen-schema";
import { ensureIds } from "./pro/htmlUtils";

/** Editable artifact returned by the clone engine (see /api/clone/:id/editable). */
export type EditableArtifact = {
  sourceUrl: string;
  title: string;
  frameWidth: number;
  pageHeight?: number;
  html: string;
  css: string;
  warnings?: string[];
  capturedAt?: number;
};

/**
 * Build a studio Project from a clone-engine editable artifact.
 *
 * Single page in v1 → one screen. The shape is multi-page-ready by design:
 * a future crawl returns pages[] and each page becomes one more entry in
 * `screens` (+ its URL in format_config.pages) — no schema change needed.
 */
export function buildWebsiteProject(editable: EditableArtifact): Project {
  let hostname = "website";
  try {
    hostname = new URL(editable.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    /* keep default */
  }
  const screenId = "home";
  // The engine rewrote html/body/:root selectors to .screen — this wrapper is
  // therefore the page root, styled exactly like the original <body>.
  const wrapped = `<div class="screen" data-screen-id="${screenId}">${editable.html}</div>`;

  const project = {
    id: crypto.randomUUID(),
    name: editable.title || hostname,
    idea: `Website import: ${editable.sourceUrl}`,
    platform: "ios" as const, // unused for websites (no phone chrome is rendered)
    designSystem: {
      // Required by the schema; cosmetic-only for websites (the Theme panel's
      // palette editor is hidden for website projects).
      palette: {
        background: "#ffffff",
        surface: "#f6f9fc",
        text: "#0a2540",
        muted: "#425466",
        accent: "#635bff",
        accentText: "#ffffff",
      },
      radius: "md" as const,
      font: "inherit",
    },
    designSystemCss: editable.css,
    screens: [
      {
        id: screenId,
        name: editable.title || hostname,
        role: "page",
        html: ensureIds(wrapped),
      },
    ],
    format_config: {
      artifactType: "website" as const,
      frame: {
        width: editable.frameWidth || 1440,
        ...(editable.pageHeight ? { height: editable.pageHeight } : {}),
      },
      source: {
        url: editable.sourceUrl,
        ...(editable.capturedAt ? { capturedAt: editable.capturedAt } : {}),
      },
      pages: [{ screenId, url: editable.sourceUrl }],
    },
  };
  return project as Project;
}
