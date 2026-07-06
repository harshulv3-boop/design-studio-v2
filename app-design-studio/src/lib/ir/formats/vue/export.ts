import { ROUNDTRIP_MANIFEST_PATH, createRoundtripManifest } from "@/lib/roundtrip-manifest";
import { sharedStyles, type ProjectExportFile } from "@/lib/project-export";
import { prettyCss } from "@/lib/format-export";
import type { Project } from "@/lib/screen-schema";
import type { IRChild, IRNode } from "../../schema";
import { isElement, isText } from "../../schema";
import { projectToIr } from "../../core/project-bridge";
import { irChildrenToHtml } from "../../core/ir-to-html";

/**
 * Canvas → real Vue SFCs (via IR). Vue templates accept plain HTML including
 * string style attributes, so screen markup is emitted near-verbatim — the
 * only corruption risk is Vue's template syntax itself:
 *
 *  - `{{ …` in text would be parsed as interpolation → the nearest element
 *    gets `v-pre` (compile-time only; renders nothing, output identical).
 *  - Attribute NAMES shaped like directives (v-*, :x, @x, #x) → `v-pre` too.
 *    (Attribute VALUES containing {{ are safe — Vue 3 has no attribute
 *    interpolation.)
 *  - Root-level bare text with `{{` (no element to carry v-pre) is entity-
 *    escaped via a serialize-time sentinel.
 *
 * SSR of every emitted SFC is DOM-equal to the canvas screen (unit-tested
 * with @vue/compiler-sfc + @vue/server-renderer).
 */

const MOUSTACHE_SENTINEL = "SLEEK_LBRACES";
const WS_OPEN = "SLEEK_WS_OPEN";
const WS_CLOSE = "SLEEK_WS_CLOSE";
const DIRECTIVE_ATTR = /^(v-|[:@#])/;

function needsVPre(node: IRNode): boolean {
  for (const name of Object.keys(node.attrs)) {
    if (DIRECTIVE_ATTR.test(name)) return true;
  }
  for (const child of node.children) {
    if (isText(child) && child.value.includes("{{")) return true;
  }
  return false;
}

/** Clone IR children, tagging elements with v-pre where Vue would misparse. */
function protectForVue(children: IRChild[], atRoot: boolean): IRChild[] {
  return children.map((child) => {
    if (isText(child)) {
      // Vue's parser drops whitespace-only text nodes at element edges and
      // collapses interior ones to " " EVEN in whitespace:"preserve" mode
      // (compiler-core condenseWhitespace). Interpolation expressions bypass
      // that pass entirely, so whitespace-only nodes become {{"\n  "}} via a
      // serialize-time sentinel. Pure whitespace has no entity/quoting risk.
      if (child.value && !child.value.trim()) {
        return { ...child, value: `${WS_OPEN}${child.value}${WS_CLOSE}` };
      }
      // Root-level text can't carry v-pre — sentinel it for entity escaping.
      if (atRoot && child.value.includes("{{")) {
        return { ...child, value: child.value.replaceAll("{{", MOUSTACHE_SENTINEL) };
      }
      return child;
    }
    if (!isElement(child)) return child;
    // Vue's compiler DROPS <style> tags inside templates ("tags with side
    // effect"). Website clones legitimately carry them — emit as a dynamic
    // component that resolves back to a real <style> element at render time,
    // with any {{ in the CSS entity-escaped (it compiles as normal template
    // text, so moustaches would otherwise interpolate).
    if (child.tag === "style") {
      return {
        ...child,
        tag: "component",
        attrs: { is: "style", ...child.attrs },
        children: child.children.map((c) =>
          isText(c) ? { ...c, value: c.value.replaceAll("{{", MOUSTACHE_SENTINEL) } : c,
        ),
      };
    }
    // Vue condenses whitespace inside <svg> subtrees too; svgInner is a raw
    // string, so sentinel whitespace-only runs between tags (and at the
    // edges) directly in the markup. Pure whitespace can't collide with
    // attribute content (a raw "<" can never appear inside a serialized attr).
    if (child.tag === "svg" && child.svgInner != null) {
      const guarded = child.svgInner
        .replace(/>(\s+)</g, (_, ws: string) => `>${WS_OPEN}${ws}${WS_CLOSE}<`)
        .replace(/^(\s+)/, (_, ws: string) => `${WS_OPEN}${ws}${WS_CLOSE}`)
        .replace(/(\s+)$/, (_, ws: string) => `${WS_OPEN}${ws}${WS_CLOSE}`);
      return { ...child, svgInner: guarded };
    }
    const protectedNode: IRNode = {
      ...child,
      attrs: needsVPre(child) ? { "v-pre": "", ...child.attrs } : child.attrs,
      children: needsVPre(child) ? child.children : protectForVue(child.children, false),
    };
    return protectedNode;
  });
}

export async function vueScreenTemplate(nodes: IRChild[]): Promise<string> {
  const html = await irChildrenToHtml(protectForVue(nodes, true));
  return html
    .replaceAll(MOUSTACHE_SENTINEL, "&#123;&#123;")
    .replace(
      new RegExp(`${WS_OPEN}([\\s\\S]*?)${WS_CLOSE}`, "g"),
      (_, ws: string) => `{{${JSON.stringify(ws)}}}`,
    )
    .replace(/ v-pre=""/g, " v-pre");
}

/** Template-only SFC for one screen. The template is emitted EXACTLY (no
 * pretty-printing) — Prettier's HTML formatter reflows whitespace, which is
 * drift in inline-text layout. */
export async function buildVueScreenSfc(nodes: IRChild[], screenName: string): Promise<string> {
  const template = await vueScreenTemplate(nodes);
  return `<!-- ${screenName} — generated by sleek.design -->\n<template>\n${template}\n</template>\n`;
}

function componentName(name: string, index: number, used: Set<string>): string {
  const pascal =
    name
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || `Screen${index + 1}`;
  const base = /^[A-Za-z]/.test(pascal) ? `${pascal}Screen` : `Screen${index + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}${n++}`;
  used.add(candidate);
  return candidate;
}

export async function buildVueProjectExport(project: Project): Promise<ProjectExportFile[]> {
  const ir = await projectToIr(project);
  const styles = await sharedStyles(project);
  const title = project.name.replace(/[<>]/g, "").trim() || "Design Export";
  const pkgName = `${
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design-export"
  }-vue`.slice(0, 214);
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  const used = new Set<string>();
  const screens = await Promise.all(
    ir.screens.map(async (screen, i) => {
      const component = componentName(screen.name || screen.role, i, used);
      return {
        id: screen.id,
        name: screen.name,
        component,
        sfc: await buildVueScreenSfc(screen.nodes, screen.name),
      };
    }),
  );

  const appVue = `<script setup lang="ts">
import { computed, ref } from "vue";
${screens.map((s) => `import ${s.component} from "./screens/${s.component}.vue";`).join("\n")}

const screens = [
${screens.map((s) => `  { id: ${JSON.stringify(s.id)}, name: ${JSON.stringify(s.name)}, component: ${s.component} },`).join("\n")}
];
const activeScreenId = ref(screens[0]?.id ?? "");
const activeScreen = computed(() => screens.find((s) => s.id === activeScreenId.value) ?? screens[0]);
</script>

<template>
  <main class="export-workspace">
    <nav v-if="screens.length > 1" class="export-toolbar" aria-label="Screens">
      <button
        v-for="screen in screens"
        :key="screen.id"
        type="button"
        class="export-tab"
        :class="{ active: screen.id === activeScreenId }"
        @click="activeScreenId = screen.id"
      >
        {{ screen.name }}
      </button>
    </nav>

    <section v-if="activeScreen" class="export-stage">
      <article class="export-screen-shell">
        <h1 class="export-screen-title">{{ activeScreen.name }}</h1>
        <div class="mobile-screen">
          <component :is="activeScreen.component" />
        </div>
      </article>
    </section>
  </main>
</template>
`;

  return [
    {
      path: ROUNDTRIP_MANIFEST_PATH,
      content: `${json(createRoundtripManifest(project, "vue"))}\n`,
    },
    {
      path: "package.json",
      content: `${json({
        name: pkgName,
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: {
          dev: "vite --host 0.0.0.0",
          build: "vue-tsc -b && vite build",
          preview: "vite preview",
        },
        dependencies: { vue: "^3.5.18" },
        devDependencies: {
          "@vitejs/plugin-vue": "^5.2.4",
          typescript: "~5.8.3",
          vite: "^6.3.6",
          "vue-tsc": "^2.2.12",
        },
      })}\n`,
    },
    {
      path: "index.html",
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${title}</title>\n  </head>\n  <body>\n    <div id="app"></div>\n    <script type="module" src="/src/main.ts"></script>\n  </body>\n</html>\n`,
    },
    {
      path: "src/main.ts",
      content: `import { createApp } from "vue";\nimport App from "./App.vue";\nimport "./styles.css";\n\ncreateApp(App).mount("#app");\n`,
    },
    { path: "src/App.vue", content: appVue },
    ...screens.map((s) => ({ path: `src/screens/${s.component}.vue`, content: s.sfc })),
    { path: "src/styles.css", content: await prettyCss(styles) },
    {
      path: "tsconfig.json",
      content: `${json({
        compilerOptions: {
          target: "ES2020",
          useDefineForClassFields: true,
          module: "ESNext",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          skipLibCheck: true,
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          isolatedModules: true,
          moduleDetection: "force",
          noEmit: true,
          jsx: "preserve",
          strict: true,
        },
        include: ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"],
      })}\n`,
    },
    {
      path: "vite.config.ts",
      content: `import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\n\nexport default defineConfig({\n  plugins: [\n    // whitespace: "preserve" keeps text nodes exactly as designed — Vue's\n    // default condensing would subtly change inline-text layout.\n    vue({ template: { compilerOptions: { whitespace: "preserve" } } }),\n  ],\n});\n`,
    },
    {
      path: "README.md",
      content: `# ${title}\n\nVue export generated by sleek.design — every screen is a real SFC template.\n\n## Run locally\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
    },
  ];
}
