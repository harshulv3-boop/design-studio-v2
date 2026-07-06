import { describe, expect, it } from "vitest";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "sucrase";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { parseInlineStyle } from "../core/inline-style";
import { buildReactTsx, REACT_EXPORT_MARKER, type ReactExportMeta } from "../formats/react/export";
import { expectDomEqual, type DomDiffOptions } from "./dom-equal";
import { SCREEN_FIXTURES, makeProject } from "./fixtures";

/**
 * Phase 1 zero-drift proof, in pure Node: generate the real-JSX export,
 * compile it with sucrase (the same transformer /api/import-code uses),
 * render every screen component with renderToStaticMarkup, and require the
 * output to be DOM-equal to the canvas screen HTML.
 */

type Rendered = { meta: ReactExportMeta; screens: Record<string, string>; hoistedCss: string };

function evalTsxModule(code: string): Record<string, unknown> {
  const js = transform(code, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "automatic",
    production: true,
  }).code;
  const moduleObj = { exports: {} as Record<string, unknown> };
  const requireShim = (id: string) => {
    if (id === "react") return React;
    if (id === "react/jsx-runtime") return jsxRuntime;
    throw new Error(`Unexpected import in generated code: ${id}`);
  };
  new Function("module", "exports", "require", js)(moduleObj, moduleObj.exports, requireShim);
  return moduleObj.exports;
}

async function renderExport(project: ReturnType<typeof makeProject>): Promise<Rendered> {
  const tsx = await buildReactTsx(project);
  const markerLine = tsx.split("\n").find((l) => l.includes(REACT_EXPORT_MARKER));
  expect(markerLine, "marker comment present").toBeTruthy();
  const meta = JSON.parse(markerLine!.slice(markerLine!.indexOf("{"))) as ReactExportMeta;

  const exports = evalTsxModule(tsx);
  const css = exports["DESIGN_SYSTEM_CSS"] as string;
  const screens: Record<string, string> = {};
  for (const screen of meta.screens) {
    const Component = exports[screen.export] as React.FC;
    expect(Component, `export ${screen.export} exists`).toBeTypeOf("function");
    screens[screen.id] = renderToStaticMarkup(React.createElement(Component));
  }
  return { meta, screens, hoistedCss: css };
}

/** Parse hoisted `[data-mae-id="…"] { … !important; }` rules into a map. */
function hoistedStyleAugment(css: string): DomDiffOptions["augmentStyle"] {
  const map = new Map<string, [string, string, boolean][]>();
  const ruleRe = /\[data-mae-id="([^"]+)"\]\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css))) {
    const decls = parseInlineStyle(m[2].replace(/!important/g, "!important")).map(
      ([p, v, imp]) => [p, v, imp] as [string, string, boolean],
    );
    map.set(m[1], [...(map.get(m[1]) ?? []), ...decls]);
  }
  return (maeId) => map.get(maeId) ?? [];
}

describe("React export: renderToStaticMarkup DOM-equals canvas HTML", () => {
  const screenEntries = Object.entries(SCREEN_FIXTURES);

  it("all fixtures roundtrip through real JSX", async () => {
    const canonical = screenEntries.map(([name, html]) => ({
      id: name,
      name,
      role: "screen",
      html: ensureIds(html),
    }));
    const project = makeProject({ screens: canonical });
    const rendered = await renderExport(project);

    expect(rendered.meta.screens).toHaveLength(canonical.length);
    const augment = hoistedStyleAugment(rendered.hoistedCss);
    for (const screen of canonical) {
      expectDomEqual(rendered.screens[screen.id], screen.html, {
        ignoreComments: true,
        augmentStyle: augment,
      });
    }
  });

  it("marker meta preserves screen identity for re-import", async () => {
    const project = makeProject();
    const rendered = await renderExport(project);
    expect(rendered.meta.screens.map((s) => [s.id, s.name, s.role])).toEqual([
      ["home", "Home", "home"],
      ["detail", "Detail", "detail"],
    ]);
    expect(rendered.meta.frame).toEqual({ w: 375, h: 812 });
  });

  it("design system CSS is carried byte-identical (plus hoisted rules)", async () => {
    const project = makeProject();
    const rendered = await renderExport(project);
    expect(rendered.hoistedCss.startsWith("\n" + project.designSystemCss)).toBe(true);
  });

  it("full import loop: export → SSR → assembled project DOM-equals original", async () => {
    const { assembleImportedProject } = await import("../core/assemble");
    // Canonicalize ids up front (as every real project already is) so the
    // exported and reference HTML share element identity.
    const project = makeProject();
    project.screens = project.screens.map((s) => ({ ...s, html: ensureIds(s.html) }));
    const rendered = await renderExport(project);

    const reimported = assembleImportedProject({
      name: rendered.meta.name,
      screens: rendered.meta.screens.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        html: rendered.screens[s.id],
      })),
      designSystemCss: rendered.hoistedCss,
      artifactType: rendered.meta.artifactType,
      frame: rendered.meta.frame,
    });

    expect(reimported.screens.map((s) => [s.id, s.name, s.role])).toEqual(
      project.screens.map((s) => [s.id, s.name, s.role]),
    );
    const augment = hoistedStyleAugment(rendered.hoistedCss);
    for (let i = 0; i < project.screens.length; i++) {
      expectDomEqual(reimported.screens[i].html, project.screens[i].html, {
        ignoreComments: true,
        augmentStyle: augment,
      });
    }
  });
});
