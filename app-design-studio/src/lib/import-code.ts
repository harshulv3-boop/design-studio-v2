import { buildWebsiteProject, type EditableArtifact } from "./import-website";
import type { Project } from "./screen-schema";

// ---------------------------------------------------------------------------
// Import Code — paste/upload existing code and load it into the canvas editor,
// reusing the exact same pipeline as the url-to-code / clone import:
//   parse → EditableArtifact → buildWebsiteProject() (sanitize + ensureIds) →
//   saveProject() → open in workspace.
//
// Two source kinds:
//   - "html"  : raw HTML/CSS, parsed client-side (no render step needed).
//   - "react" : JSX/TSX, rendered to static HTML by /api/import-code (a render
//               step is required since React is not HTML).
//
// The LANGUAGES registry is the single place to add more sources later
// (Vue, Angular, Flutter, SwiftUI, …): give them a client parser or a server
// handler and they slot into the same load path with no UI/plumbing changes.
// ---------------------------------------------------------------------------

export type LanguageId = "html" | "react" | "vue" | "angular" | "flutter" | "swiftui";

export type LanguageDef = {
  id: LanguageId;
  label: string;
  /** File extensions that map to this language on upload. */
  exts: string[];
  /** "client" parses in the browser; "server" needs a render step via the API. */
  kind: "client" | "server";
  /** Available now, or listed as coming-soon in the UI. */
  available: boolean;
};

export const LANGUAGES: LanguageDef[] = [
  { id: "html", label: "HTML / CSS", exts: [".html", ".htm"], kind: "client", available: true },
  { id: "react", label: "React (JSX/TSX)", exts: [".jsx", ".tsx"], kind: "server", available: true },
  { id: "vue", label: "Vue", exts: [".vue"], kind: "server", available: true },
  { id: "angular", label: "Angular", exts: [".component.ts"], kind: "server", available: true },
  // Coming soon — wire a parser (client) or an /api/import-code handler (server)
  // and flip `available` to true; nothing else needs to change.
  { id: "flutter", label: "Flutter", exts: [".dart"], kind: "server", available: false },
  { id: "swiftui", label: "SwiftUI", exts: [".swift"], kind: "server", available: false },
];

export function languageForFile(filename: string): LanguageId | null {
  const lower = filename.toLowerCase();
  for (const l of LANGUAGES) {
    if (l.exts.some((ext) => lower.endsWith(ext))) return l.id;
  }
  return null;
}

/** Best-effort content sniff so paste can preselect the right language. */
export function detectLanguage(code: string): LanguageId {
  const t = code.trim();
  if (!t) return "html";
  // Angular: the @Component decorator is unambiguous.
  if (/@Component\s*\(/.test(t)) return "angular";
  // Vue SFC: a <template> block paired with a <script>.
  if (/<template[\s>]/.test(t) && /<script[\s>]/.test(t)) return "vue";
  // React signals: JSX imports/exports, hooks, or a component returning JSX.
  const reactHints = [
    /import\s+.*from\s+['"]react['"]/,
    /export\s+default\s+(function|class|\(|[A-Z])/,
    /\buseState\b|\buseEffect\b|\buseRef\b|\buseMemo\b/,
    /className\s*=/,
    /=>\s*\(?\s*</, // arrow returning JSX
  ];
  const looksHtml = /^\s*(<!doctype html|<html|<head|<body)/i.test(t);
  if (!looksHtml && reactHints.some((re) => re.test(t))) return "react";
  return "html";
}

export class ImportError extends Error {}

// Extract <style> CSS from a pasted document and return the editable body HTML
// + collected CSS. Mirrors what the clone engine produces (separate html/css)
// so the result flows through buildWebsiteProject unchanged.
export function parseHtmlToArtifact(code: string): { html: string; css: string } {
  const trimmed = (code || "").trim();
  if (!trimmed) throw new ImportError("Nothing to import — the code is empty.");

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  // A hard parser error yields a <parsererror> node; DOMParser is lenient with
  // HTML so this is rare, but guard anyway.
  if (doc.querySelector("parsererror")) {
    throw new ImportError("Could not parse the HTML. Check for malformed tags.");
  }

  // Collect every <style> block (head or body) into one CSS string.
  const styleEls = Array.from(doc.querySelectorAll("style"));
  let css = styleEls.map((s) => s.textContent || "").join("\n").trim();
  styleEls.forEach((s) => s.remove());

  // Root-scoped selectors won't match anything once html/body become the
  // .screen wrapper, so rewrite them — same trick the clone capture uses.
  if (css) css = css.replace(/(^|[\s,{}])(:root|html|body)\b/gi, "$1.screen");

  // Prefer the body; fall back to the whole document for bare fragments.
  const bodyHtml = doc.body ? doc.body.innerHTML.trim() : "";
  const html = bodyHtml || trimmed;
  if (!html.replace(/\s+/g, "")) {
    throw new ImportError("No renderable content found in the HTML.");
  }
  return { html, css };
}

/** Build a canvas Project from imported html/css, via the shared website path. */
export function buildImportedProject(opts: { html: string; css: string; title: string }): Project {
  const artifact: EditableArtifact = {
    sourceUrl: "", // no origin URL for pasted/uploaded code
    title: opts.title,
    frameWidth: 1440,
    html: opts.html,
    css: opts.css,
  };
  const project = buildWebsiteProject(artifact);
  // Same project shape as a URL clone (so it loads identically), just relabel
  // the origin — there's no source URL for pasted/uploaded code.
  (project as { idea: string }).idea = `Imported code: ${opts.title || "Untitled"}`;
  return project;
}
