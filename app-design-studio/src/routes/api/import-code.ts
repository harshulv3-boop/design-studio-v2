import { createFileRoute } from "@tanstack/react-router";
import { transform } from "sucrase";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Import Code — server render step for sources that aren't already HTML.
 *
 * Currently handles React (JSX/TSX): transpile with sucrase, evaluate the
 * module in an isolated function scope with a locked-down `require` (only React
 * resolves — any other import means an external dependency we can't satisfy),
 * then renderToStaticMarkup to real HTML that flows into the same canvas
 * pipeline as every other import.
 *
 * Only self-contained components render: no required props, no external data /
 * context, no third-party imports. Event handlers and effects don't survive a
 * static render, so the result is explicitly "best-effort" (a warning is
 * returned) — interactivity is dropped, structure and styling are kept.
 *
 * Extensible: add a `case "vue"` etc. below (and flip its LANGUAGES flag in
 * lib/import-code.ts) — the client and canvas paths need no changes.
 */

type Body = { code?: string; language?: string };

const REACT_MODULES: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": undefined, // filled lazily below
  "react/jsx-dev-runtime": undefined,
};

async function renderReact(code: string): Promise<{ html: string; warnings: string[] }> {
  const src = (code || "").trim();
  if (!src) throw new HttpError(400, "Nothing to import — the code is empty.");

  // If the snippet declares a component but never exports it, export the last
  // top-level PascalCase component so a bare paste still renders.
  const withExport = ensureDefaultExport(src);

  // Transpile JSX + TS + ESM→CJS. Automatic runtime pulls jsx from
  // "react/jsx-runtime", which our require shim resolves to the real one.
  let js: string;
  try {
    js = transform(withExport, {
      transforms: ["jsx", "typescript", "imports"],
      jsxRuntime: "automatic",
      production: true,
    }).code;
  } catch (e) {
    throw new HttpError(422, `Could not parse the component (invalid JSX/TSX): ${errMsg(e)}`);
  }

  // Lazily resolve the jsx runtimes (React 19 ships them as subpaths).
  if (!REACT_MODULES["react/jsx-runtime"]) {
    REACT_MODULES["react/jsx-runtime"] = await import("react/jsx-runtime");
    REACT_MODULES["react/jsx-dev-runtime"] = REACT_MODULES["react/jsx-runtime"];
  }

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const requireShim = (name: string) => {
    if (name in REACT_MODULES && REACT_MODULES[name]) return REACT_MODULES[name];
    if (name === "react-dom" || name === "react-dom/server") {
      throw new HttpError(422, `"${name}" can't be imported — Import Code renders a single component, not a full app.`);
    }
    throw new HttpError(
      422,
      `Can't resolve import "${name}". Import Code renders self-contained components only — remove external dependencies (UI kits, CSS-in-JS, icon packs, other files).`,
    );
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function("module", "exports", "require", js) as (
      m: typeof moduleObj,
      e: Record<string, unknown>,
      r: typeof requireShim,
    ) => void;
    factory(moduleObj, moduleObj.exports, requireShim);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, `The component couldn't be evaluated: ${errMsg(e)}`);
  }

  // Collect EVERY exported component, not just the first. Our own React (TSX)
  // export emits one `export function XScreen()` per screen, so a multi-screen
  // project round-trips only if we render them all and stitch them together.
  const components: { name: string; fn: React.FC }[] = [];
  if (typeof moduleObj.exports.default === "function") {
    components.push({ name: "default", fn: moduleObj.exports.default as React.FC });
  }
  for (const [name, val] of Object.entries(moduleObj.exports)) {
    // Named PascalCase exports are components by convention; skip helpers/consts.
    if (name !== "default" && typeof val === "function" && /^[A-Z]/.test(name)) {
      components.push({ name, fn: val as React.FC });
    }
  }
  if (components.length === 0) {
    const any = Object.values(moduleObj.exports).find((v) => typeof v === "function");
    if (any) components.push({ name: "default", fn: any as React.FC });
  }
  if (components.length === 0) {
    throw new HttpError(
      422,
      "No React component found. Export one, e.g. `export default function App() { return <div/> }`.",
    );
  }

  // Render each; keep the ones that render, note the ones that don't. Only fail
  // outright if NOTHING renders — one bad screen shouldn't drop the rest.
  const rendered: string[] = [];
  const skipped: string[] = [];
  let firstError = "";
  for (const { name, fn } of components) {
    try {
      const out = renderToStaticMarkup(React.createElement(fn));
      if (out.replace(/\s+/g, "")) rendered.push(out);
      else skipped.push(name);
    } catch (e) {
      if (!firstError) firstError = errMsg(e);
      skipped.push(name);
    }
  }

  if (rendered.length === 0) {
    throw new HttpError(
      422,
      `The component ${firstError ? `threw while rendering: ${firstError}. ` : "rendered nothing. "}` +
        "Import Code supports components that render standalone — without required props, external data, or context providers.",
    );
  }

  const warnings = [
    "Best-effort import: interactivity (event handlers, effects, state changes) was stripped — the static structure and styling are preserved.",
  ];
  if (components.length > 1) {
    warnings.push(`Rendered ${rendered.length} component${rendered.length === 1 ? "" : "s"} into one canvas.`);
  }
  if (skipped.length) {
    warnings.push(`Skipped ${skipped.length} component(s) that couldn't render standalone: ${skipped.join(", ")}.`);
  }

  return { html: rendered.join("\n"), warnings };
}

// Append `export default <Name>` when the snippet has no export but does define
// a PascalCase component. Conservative: skips if any export already exists.
function ensureDefaultExport(src: string): string {
  if (/\bexport\s+(default|\{|const|function|class)\b/.test(src)) return src;
  const names = [...src.matchAll(/(?:function|const|class)\s+([A-Z][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  const last = names[names.length - 1];
  return last ? `${src}\nexport default ${last};` : src;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const Route = createFileRoute("/api/import-code")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        const language = body.language || "react";
        try {
          switch (language) {
            case "react": {
              const out = await renderReact(body.code || "");
              return Response.json({ html: out.html, css: "", warnings: out.warnings });
            }
            default:
              return Response.json(
                { error: `"${language}" import isn't supported yet.` },
                { status: 501 },
              );
          }
        } catch (e) {
          const status = e instanceof HttpError ? e.status : 500;
          return Response.json({ error: errMsg(e) }, { status });
        }
      },
    },
  },
});
