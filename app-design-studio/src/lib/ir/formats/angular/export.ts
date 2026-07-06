import { ROUNDTRIP_MANIFEST_PATH, createRoundtripManifest } from "@/lib/roundtrip-manifest";
import { sharedStyles, type ProjectExportFile } from "@/lib/project-export";
import { prettyCss } from "@/lib/format-export";
import type { Project } from "@/lib/screen-schema";
import type { IRChild, IRNode } from "../../schema";
import { isElement, isText } from "../../schema";
import { projectToIr } from "../../core/project-bridge";
import { irChildrenToHtml } from "../../core/ir-to-html";

/**
 * Canvas → real Angular components (via IR) — actual templates, no
 * [innerHTML]/bypassSecurityTrustHtml.
 *
 * Angular-specific fidelity traps handled:
 *  - `{{ }}` interpolates in TEXT and in ATTRIBUTE VALUES (unlike Vue) —
 *    braces are entity-escaped (&#123;/&#125;) via serialize-time sentinels.
 *  - Angular 17+ block syntax: a literal `@` in text starts a control-flow
 *    block → escaped as &#64;.
 *  - Whitespace: Angular collapses/removes whitespace by default —
 *    `preserveWhitespaces: true` on every generated component.
 *  - In-template <style> tags are stripped by the compiler (no dynamic-element
 *    escape hatch like Vue's <component is>) — in-screen styles hoist to the
 *    component's styleUrls with ViewEncapsulation.None. Same global CSS
 *    semantics (in-screen <style> was never scoped); the one structural
 *    transform in this exporter, tested as such.
 *
 * Proof: @angular/compiler parseTemplate of every emitted template yields
 * zero errors, zero bound nodes (nothing misread as a binding), and its AST
 * serialized back is DOM-equal to the canvas screen.
 */

const ESC = {
  lbrace: "SLEEK_LB",
  rbrace: "SLEEK_RB",
  at: "SLEEK_AT",
  bindOpen: "SLEEK_TBIND_OPEN",
  bindClose: "SLEEK_TBIND_CLOSE",
} as const;

/**
 * Angular's lexer decodes character references BEFORE interpolation scanning
 * (in text AND attributes), so &#123;&#123; does NOT prevent `{{` from being
 * parsed as interpolation. Text containing `{{` therefore becomes an
 * interpolation of a literal string — {{ 'exact text' }} — which renders the
 * text verbatim. `}}` inside the literal would close the interpolation, so
 * every `}}` is split via string concatenation: 'a}' + '}b'.
 * Text without `{{` only needs single { } and @ entity-escaped (block syntax).
 */
function escapeText(value: string): string {
  if (value.includes("{{")) {
    const literal = jsSingleQuote(value).replace(/\}\}/g, "}' + '}");
    return `${ESC.bindOpen}'${literal}'${ESC.bindClose}`;
  }
  return value.replaceAll("{", ESC.lbrace).replaceAll("}", ESC.rbrace).replaceAll("@", ESC.at);
}

/**
 * Attribute values containing `{{` cannot be entity-escaped (Angular's lexer
 * decodes character references in attribute values BEFORE interpolation
 * scanning). Instead such attributes become literal-string attribute
 * bindings: [attr.name]="'value'" — rendered DOM gets the exact original
 * string. Emitted via a sentinel attribute name because the DOM serializer
 * cannot carry "[attr.x]" as an attribute name.
 */
const BIND_PREFIX = "sleekbind-";

function jsSingleQuote(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

type AngularScreen = { template: string; css: string };

function protectForAngular(children: IRChild[], collectedCss: string[]): IRChild[] {
  const out: IRChild[] = [];
  for (const child of children) {
    if (isText(child)) {
      out.push({ ...child, value: escapeText(child.value) });
      continue;
    }
    if (!isElement(child)) {
      out.push(child);
      continue;
    }
    if (child.tag === "style") {
      collectedCss.push(
        child.children
          .filter(isText)
          .map((t) => t.value)
          .join(""),
      );
      continue; // hoisted to component styles
    }
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(child.attrs)) {
      if (value.includes("{{")) attrs[`${BIND_PREFIX}${name}`] = jsSingleQuote(value);
      else attrs[name] = value;
    }
    out.push({
      ...child,
      attrs,
      styleDecls: child.styleDecls, // style attr never interpolates braces-free CSS; {{ can't appear in parsed decls meaningfully
      children:
        child.tag === "svg" ? child.children : protectForAngular(child.children, collectedCss),
    });
  }
  return out;
}

const SENTINELS: [string, string][] = [
  [ESC.lbrace, "&#123;"],
  [ESC.rbrace, "&#125;"],
  [ESC.at, "&#64;"],
  [ESC.bindOpen, "{{ "],
  [ESC.bindClose, " }}"],
];

export async function angularScreenTemplate(nodes: IRChild[]): Promise<AngularScreen> {
  const collected: string[] = [];
  let html = await irChildrenToHtml(protectForAngular(nodes, collected));
  for (const [sentinel, entity] of SENTINELS) {
    html = html.replaceAll(sentinel, entity);
  }
  html = html.replace(
    new RegExp(`${BIND_PREFIX}([^=\\s"]+)="([^"]*)"`, "g"),
    (_, name: string, value: string) => `[attr.${name}]="'${value}'"`,
  );
  return { template: html, css: collected.join("\n").trim() };
}

function classCase(name: string, index: number, used: Set<string>): string {
  const pascal =
    name
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") || `Screen${index + 1}`;
  const base = /^[A-Za-z]/.test(pascal) ? pascal : `Screen${index + 1}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}${n++}`;
  used.add(candidate);
  return candidate;
}

function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function buildAngularProjectExport(project: Project): Promise<ProjectExportFile[]> {
  const ir = await projectToIr(project);
  const styles = await sharedStyles(project);
  const title = project.name.replace(/[<>]/g, "").trim() || "Design Export";
  const pkgName = `${
    project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "design-export"
  }-angular`.slice(0, 214);
  const json = (v: unknown) => JSON.stringify(v, null, 2);

  const used = new Set<string>();
  const screens = await Promise.all(
    ir.screens.map(async (screen, i) => {
      const className = classCase(screen.name || screen.role, i, used);
      const fileBase = `${kebab(className) || `screen-${i + 1}`}-screen`;
      const { template, css } = await angularScreenTemplate(screen.nodes);
      return { id: screen.id, name: screen.name, className, fileBase, template, css };
    }),
  );

  const screenFiles: ProjectExportFile[] = screens.flatMap((screen) => {
    const files: ProjectExportFile[] = [
      {
        path: `src/app/screens/${screen.fileBase}.component.html`,
        // No trailing newline: with preserveWhitespaces it would become a
        // real text node in the rendered DOM.
        content: screen.template,
      },
      {
        path: `src/app/screens/${screen.fileBase}.component.ts`,
        content: `import { Component, ViewEncapsulation } from "@angular/core";

@Component({
  selector: "screen-${kebab(screen.className)}",
  standalone: true,
  templateUrl: "./${screen.fileBase}.component.html",${
    screen.css ? `\n  styleUrls: ["./${screen.fileBase}.component.css"],` : ""
  }
  // In-screen styles are global by design; whitespace is design content.
  encapsulation: ViewEncapsulation.None,
  preserveWhitespaces: true,
})
export class ${screen.className}ScreenComponent {}
`,
      },
    ];
    if (screen.css) {
      files.push({
        path: `src/app/screens/${screen.fileBase}.component.css`,
        content: `${screen.css}\n`,
      });
    }
    return files;
  });

  const appComponentTs = `import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
${screens.map((s) => `import { ${s.className}ScreenComponent } from "./screens/${s.fileBase}.component";`).join("\n")}

type ScreenRef = { id: string; name: string };

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, ${screens.map((s) => `${s.className}ScreenComponent`).join(", ")}],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
  readonly screens: ScreenRef[] = ${JSON.stringify(
    screens.map((s) => ({ id: s.id, name: s.name })),
  )};
  activeScreenId = this.screens[0]?.id ?? "";
}
`;

  const appComponentHtml = `<main class="export-workspace">
  <nav *ngIf="screens.length > 1" class="export-toolbar" aria-label="Screens">
    <button
      *ngFor="let screen of screens"
      type="button"
      class="export-tab"
      [class.active]="screen.id === activeScreenId"
      (click)="activeScreenId = screen.id"
    >
      {{ screen.name }}
    </button>
  </nav>

  <section class="export-stage">
    <article class="export-screen-shell">
      <div class="mobile-screen">
${screens
  .map(
    (s) =>
      `        <screen-${kebab(s.className)} *ngIf="activeScreenId === ${JSON.stringify(s.id).replace(/"/g, "'")}" />`,
  )
  .join("\n")}
      </div>
    </article>
  </section>
</main>
`;

  return [
    {
      path: ROUNDTRIP_MANIFEST_PATH,
      content: `${json(createRoundtripManifest(project, "angular"))}\n`,
    },
    {
      path: "package.json",
      content: `${json({
        name: pkgName,
        version: "1.0.0",
        private: true,
        scripts: {
          ng: "ng",
          start: "ng serve --host 0.0.0.0",
          build: "ng build",
          watch: "ng build --watch --configuration development",
        },
        dependencies: {
          "@angular/animations": "^19.2.14",
          "@angular/common": "^19.2.14",
          "@angular/compiler": "^19.2.14",
          "@angular/core": "^19.2.14",
          "@angular/forms": "^19.2.14",
          "@angular/platform-browser": "^19.2.14",
          "@angular/router": "^19.2.14",
          rxjs: "~7.8.2",
          tslib: "^2.8.1",
          "zone.js": "~0.15.1",
        },
        devDependencies: {
          "@angular-devkit/build-angular": "^19.2.15",
          "@angular/cli": "^19.2.15",
          "@angular/compiler-cli": "^19.2.14",
          typescript: "~5.8.3",
        },
      })}\n`,
    },
    {
      path: "angular.json",
      content: `${json({
        version: 1,
        newProjectRoot: "projects",
        projects: {
          app: {
            projectType: "application",
            schematics: {},
            root: "",
            sourceRoot: "src",
            prefix: "app",
            architect: {
              build: {
                builder: "@angular-devkit/build-angular:application",
                options: {
                  outputPath: "dist/app",
                  index: "src/index.html",
                  browser: "src/main.ts",
                  polyfills: ["zone.js"],
                  tsConfig: "tsconfig.app.json",
                  assets: ["src/favicon.ico", "src/assets"],
                  styles: ["src/styles.css"],
                  scripts: [],
                },
                configurations: {
                  production: {
                    budgets: [
                      { type: "initial", maximumWarning: "1mb", maximumError: "2mb" },
                      { type: "anyComponentStyle", maximumWarning: "48kb", maximumError: "96kb" },
                    ],
                    outputHashing: "all",
                  },
                  development: { optimization: false, extractLicenses: false, sourceMap: true },
                },
                defaultConfiguration: "production",
              },
              serve: {
                builder: "@angular-devkit/build-angular:dev-server",
                configurations: {
                  production: { buildTarget: "app:build:production" },
                  development: { buildTarget: "app:build:development" },
                },
                defaultConfiguration: "development",
              },
            },
          },
        },
      })}\n`,
    },
    {
      path: "src/index.html",
      content: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${title}</title>\n    <base href="/" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n  </head>\n  <body>\n    <app-root></app-root>\n  </body>\n</html>\n`,
    },
    {
      path: "src/main.ts",
      content: `import { bootstrapApplication } from "@angular/platform-browser";\nimport { AppComponent } from "./app/app.component";\n\nbootstrapApplication(AppComponent).catch((err) => console.error(err));\n`,
    },
    { path: "src/app/app.component.ts", content: appComponentTs },
    { path: "src/app/app.component.html", content: appComponentHtml },
    { path: "src/app/app.component.css", content: ":host { display: block; }\n" },
    ...screenFiles,
    { path: "src/styles.css", content: await prettyCss(styles) },
    { path: "src/favicon.ico", content: "" },
    { path: "src/assets/.gitkeep", content: "" },
    {
      path: "tsconfig.json",
      content: `${json({
        compileOnSave: false,
        compilerOptions: {
          outDir: "./dist/out-tsc",
          strict: true,
          noImplicitOverride: true,
          noPropertyAccessFromIndexSignature: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
          skipLibCheck: true,
          isolatedModules: true,
          esModuleInterop: true,
          sourceMap: true,
          declaration: false,
          experimentalDecorators: true,
          moduleResolution: "bundler",
          importHelpers: true,
          target: "ES2022",
          module: "ES2022",
          lib: ["ES2022", "dom"],
        },
        angularCompilerOptions: {
          enableI18nLegacyMessageIdFormat: false,
          strictInjectionParameters: true,
          strictInputAccessModifiers: true,
          strictTemplates: true,
        },
      })}\n`,
    },
    {
      path: "tsconfig.app.json",
      content: `${json({
        extends: "./tsconfig.json",
        compilerOptions: { outDir: "./out-tsc/app", types: [] },
        files: ["src/main.ts"],
        include: ["src/**/*.d.ts"],
      })}\n`,
    },
    {
      path: "README.md",
      content: `# ${title}\n\nAngular export generated by sleek.design — every screen is a real template component.\n\n## Run locally\n\n\`\`\`bash\nnpm install\nnpm start\n\`\`\`\n`,
    },
  ];
}
