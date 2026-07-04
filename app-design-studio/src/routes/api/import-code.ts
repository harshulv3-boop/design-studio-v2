import { createFileRoute } from "@tanstack/react-router";
import { transform } from "sucrase";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Import Code — server render step for sources that aren't already HTML.
 * Each handler produces { html, css } that flows into the same canvas pipeline
 * as every other import. Untrusted code runs in an isolated function scope with
 * a locked-down `require` (only the framework runtime resolves — any other
 * import means an external dependency we can't satisfy).
 *
 *  - react : sucrase transpiles JSX/TSX, evaluate the module, renderToStaticMarkup.
 *  - vue   : @vue/compiler-sfc parses the SFC; template → render fn, script → options
 *            (options API or <script setup>), then SSR renderToString.
 *  - angular: best-effort — full Angular SSR needs the whole runtime (compiler, DI,
 *            platform-server, zone.js), so instead extract the inline @Component
 *            template + styles, resolve simple {{field}} text, and strip Angular
 *            bindings/directives so structure + styling come through as HTML.
 *
 * Only self-contained components render (no required props / external data /
 * context / third-party imports). Interactivity doesn't survive a static render,
 * so results are "best-effort" — a warning is returned; structure + styling kept.
 *
 * Extensible: add a `case "…"` and flip its LANGUAGES flag in lib/import-code.ts;
 * the client and canvas paths need no changes.
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

// --- Vue ------------------------------------------------------------------
// Parse the SFC, compile the <template> to a render function and evaluate the
// <script> (options API or <script setup>) with the same locked-down require as
// React, then SSR-render to real HTML. Scoped <style> blocks become the CSS.
async function renderVue(code: string): Promise<{ html: string; css: string; warnings: string[] }> {
  const src = (code || "").trim();
  if (!src) throw new HttpError(400, "Nothing to import — the code is empty.");

  const [Vue, serverRenderer, sfc] = await Promise.all([
    import("vue"),
    import("@vue/server-renderer"),
    import("@vue/compiler-sfc"),
  ]);

  let descriptor: import("@vue/compiler-sfc").SFCDescriptor;
  try {
    const parsed = sfc.parse(src, { filename: "import.vue" });
    if (parsed.errors.length) throw new Error(parsed.errors[0].message);
    descriptor = parsed.descriptor;
  } catch (e) {
    throw new HttpError(422, `Could not parse the Vue component: ${errMsg(e)}`);
  }

  const css = descriptor.styles.map((s) => s.content).join("\n").trim();

  const evalModule = (js: string, what: string): Record<string, unknown> => {
    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const requireShim = (name: string) => {
      if (name === "vue") return Vue;
      throw new HttpError(422, `Can't resolve import "${name}". Import Code renders self-contained components only — remove external dependencies.`);
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function("module", "exports", "require", js)(moduleObj, moduleObj.exports, requireShim);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, `The Vue ${what} couldn't be evaluated: ${errMsg(e)}`);
    }
    return moduleObj.exports;
  };

  const id = "importvue";
  let component: Record<string, unknown> = {};
  try {
    if (descriptor.scriptSetup) {
      // <script setup> — compile it (with the template inlined) into a component.
      const compiled = sfc.compileScript(descriptor, { id, inlineTemplate: true });
      const js = transform(compiled.content, { transforms: ["typescript", "imports"], production: true }).code;
      component = (evalModule(js, "script setup").default as Record<string, unknown>) || {};
    } else {
      // Options API (or template-only): eval <script>, compile <template> → render.
      if (descriptor.script) {
        const js = transform(descriptor.script.content, { transforms: ["typescript", "imports"], production: true }).code;
        component = (evalModule(js, "script").default as Record<string, unknown>) || {};
      }
      if (descriptor.template && !component.render) {
        const tpl = sfc.compileTemplate({ source: descriptor.template.content, id, filename: "import.vue" });
        if (tpl.errors.length) throw new HttpError(422, `Could not compile the Vue template: ${String(tpl.errors[0])}`);
        const tjs = transform(tpl.code, { transforms: ["imports"], production: true }).code;
        component.render = evalModule(tjs, "template").render;
      }
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, `Could not build the Vue component: ${errMsg(e)}`);
  }

  if (!component.render && !component.template && !component.setup) {
    throw new HttpError(422, "No renderable Vue component found (need a <template> or a render/setup).");
  }

  let html: string;
  try {
    const app = Vue.createSSRApp(component);
    html = await serverRenderer.renderToString(app);
  } catch (e) {
    throw new HttpError(
      422,
      `The Vue component threw while rendering: ${errMsg(e)}. Import Code supports components that render standalone — without required props, external data, or stores.`,
    );
  }
  if (!html.replace(/\s+/g, "")) throw new HttpError(422, "The Vue component rendered nothing (empty output).");

  // Strip Vue's SSR fragment/anchor comments (hydration markers) — we import a
  // static snapshot, so they're just noise.
  html = html.replace(/<!--\[-->|<!--\]-->|<!---->/g, "");

  return {
    html,
    css,
    warnings: ["Best-effort import: interactivity (event handlers, watchers, transitions) was stripped — structure and styling are preserved."],
  };
}

// --- Angular --------------------------------------------------------------
// Full Angular SSR would need the entire Angular runtime (compiler, DI,
// platform-server, zone.js) to JIT-compile and bootstrap a component — far too
// heavy and fragile for a paste import. Instead do a best-effort extraction:
// pull the inline @Component template + styles, resolve simple {{field}}
// interpolations from string/number class fields, and strip Angular-only
// bindings/directives so the structure and styling come through as clean HTML.
function extractString(src: string, key: string): string | null {
  // key: `...` | '...' | "..."
  const re = new RegExp(key + "\\s*:\\s*(`([\\s\\S]*?)`|'([^']*)'|\"([^\"]*)\")");
  const m = src.match(re);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
}
function renderAngular(code: string): { html: string; css: string; warnings: string[] } {
  const src = (code || "").trim();
  if (!src) throw new HttpError(400, "Nothing to import — the code is empty.");
  if (!/@Component\s*\(/.test(src)) {
    throw new HttpError(422, "No @Component found. Paste an Angular component with an inline `template`.");
  }
  if (/templateUrl\s*:/.test(src) && extractString(src, "template") === null) {
    throw new HttpError(422, "This Angular component uses an external templateUrl — paste one with an inline `template` so it can be rendered.");
  }
  let template = extractString(src, "template");
  if (template === null) throw new HttpError(422, "No inline Angular `template` found to render.");

  // styles: [`...`, '...'] — collect every string in the array.
  let css = "";
  const stylesBlock = src.match(/styles\s*:\s*\[([\s\S]*?)\]/);
  if (stylesBlock) {
    css = [...stylesBlock[1].matchAll(/`([\s\S]*?)`|'([^']*)'|"([^"]*)"/g)]
      .map((m) => m[1] ?? m[2] ?? m[3] ?? "").join("\n").trim();
  }

  // Resolve simple {{ field }} from `field = 'value'` / `field = 42` initializers.
  const fields: Record<string, string> = {};
  for (const m of src.matchAll(/(\w+)\s*(?::\s*[^=;{]+)?=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|(\d+(?:\.\d+)?))\s*[;\n]/g)) {
    fields[m[1]] = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
  }
  template = template
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, name) => (name in fields ? fields[name] : ""))
    // Strip Angular-only attributes/directives so they don't leak into the HTML.
    .replace(/\s\*ng[A-Za-z]+="[^"]*"/g, "")
    .replace(/\s\[\(?[\w.@-]+\)?\]="[^"]*"/g, "")
    .replace(/\s\([\w.@-]+\)="[^"]*"/g, "")
    .replace(/\s#[\w-]+(=("[^"]*"|'[^']*'))?/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .trim();

  if (!template.replace(/\s+/g, "")) throw new HttpError(422, "The Angular template was empty after extraction.");

  return {
    html: template,
    css,
    warnings: [
      "Best-effort Angular import: the inline template and styles were extracted, and simple {{field}} text was filled in, but bindings, directives, and dynamic data are not evaluated (Angular needs its full runtime to render).",
    ],
  };
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
            case "vue": {
              const out = await renderVue(body.code || "");
              return Response.json({ html: out.html, css: out.css, warnings: out.warnings });
            }
            case "angular": {
              const out = renderAngular(body.code || "");
              return Response.json({ html: out.html, css: out.css, warnings: out.warnings });
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
