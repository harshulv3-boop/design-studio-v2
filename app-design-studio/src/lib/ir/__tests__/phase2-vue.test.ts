import { describe, expect, it } from "vitest";
import * as Vue from "vue";
import * as serverRenderer from "@vue/server-renderer";
import * as sfc from "@vue/compiler-sfc";
import { transform } from "sucrase";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { htmlToIrChildren } from "../core/html-to-ir";
import { buildVueScreenSfc, buildVueProjectExport } from "../formats/vue/export";
import { expectDomEqual } from "./dom-equal";
import { SCREEN_FIXTURES, makeProject } from "./fixtures";

/**
 * Phase 2 zero-drift proof: compile each generated SFC with the exact same
 * toolchain the import path uses (@vue/compiler-sfc → render fn →
 * @vue/server-renderer) and require SSR output DOM-equal to the canvas HTML.
 */

function evalModule(js: string): Record<string, unknown> {
  const moduleObj = { exports: {} as Record<string, unknown> };
  const requireShim = (id: string) => {
    if (id === "vue") return Vue;
    throw new Error(`Unexpected import in compiled template: ${id}`);
  };
  new Function("module", "exports", "require", js)(moduleObj, moduleObj.exports, requireShim);
  return moduleObj.exports;
}

async function ssrScreenSfc(source: string): Promise<string> {
  const { descriptor, errors } = sfc.parse(source, { filename: "Screen.vue" });
  expect(errors).toHaveLength(0);
  expect(descriptor.template, "SFC has a template").toBeTruthy();
  const tpl = sfc.compileTemplate({
    source: descriptor.template!.content,
    id: "test",
    filename: "Screen.vue",
    // Vue condenses whitespace by default — a zero-drift violation for
    // inline layout. Same option ships in the exported project's vite config.
    compilerOptions: { whitespace: "preserve" },
  });
  expect(tpl.errors).toHaveLength(0);
  const js = transform(tpl.code, { transforms: ["imports"], production: true }).code;
  const render = evalModule(js).render;
  const app = Vue.createSSRApp({ render: render as () => unknown });
  const html = await serverRenderer.renderToString(app);
  // Same hydration-marker strip as the real import path.
  return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, "");
}

describe("Vue export: SFC SSR DOM-equals canvas HTML", () => {
  for (const [name, rawHtml] of Object.entries(SCREEN_FIXTURES)) {
    it(`fixture: ${name}`, async () => {
      const canonical = ensureIds(rawHtml);
      const nodes = await htmlToIrChildren(canonical);
      const sfcSource = await buildVueScreenSfc(nodes, name);
      const rendered = await ssrScreenSfc(sfcSource);
      expectDomEqual(rendered, canonical, { ignoreComments: true });
    });
  }

  it("moustache text survives literally (v-pre), not as interpolation", async () => {
    const canonical = ensureIds(SCREEN_FIXTURES["edge-cases"]);
    const nodes = await htmlToIrChildren(canonical);
    const sfcSource = await buildVueScreenSfc(nodes, "edge");
    expect(sfcSource).toContain("v-pre");
    const rendered = await ssrScreenSfc(sfcSource);
    expect(rendered).toContain("{{handlebars}}");
  });

  it("project export ships manifest + one real SFC per screen", async () => {
    const project = makeProject();
    project.screens = project.screens.map((s) => ({ ...s, html: ensureIds(s.html) }));
    const files = await buildVueProjectExport(project);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("sleek-design/manifest.json");
    expect(paths).toContain("src/screens/HomeScreen.vue");
    expect(paths).toContain("src/screens/DetailScreen.vue");
    // No v-html anywhere — screens are real templates now.
    for (const file of files) {
      if (file.path.endsWith(".vue")) expect(file.content).not.toContain("v-html");
    }
    // Each screen SFC SSRs DOM-equal to its canvas screen.
    for (let i = 0; i < project.screens.length; i++) {
      const component = ["HomeScreen", "DetailScreen"][i];
      const file = files.find((f) => f.path === `src/screens/${component}.vue`)!;
      const rendered = await ssrScreenSfc(file.content);
      expectDomEqual(rendered, project.screens[i].html, { ignoreComments: true });
    }
  });
});
