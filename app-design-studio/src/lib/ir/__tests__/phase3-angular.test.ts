import { describe, expect, it } from "vitest";
import {
  parseTemplate,
  TmplAstElement,
  TmplAstText,
  TmplAstBoundText,
  ASTWithSource,
  Interpolation,
  LiteralPrimitive,
  Binary,
  BindingType,
} from "@angular/compiler";
import type { AST, TmplAstNode } from "@angular/compiler";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { htmlToIrChildren } from "../core/html-to-ir";
import { angularScreenTemplate, buildAngularProjectExport } from "../formats/angular/export";
import { expectDomEqual } from "./dom-equal";
import { SCREEN_FIXTURES, makeProject } from "./fixtures";

/**
 * Phase 3 zero-drift proof: parse every generated template with Angular's
 * REAL compiler (parseTemplate), assert zero parse errors and zero bound
 * nodes (i.e. no text or attribute was misread as a binding/block), then
 * serialize the AST back to HTML and require DOM-equality with the canvas
 * screen. In-screen <style> hoisting to component styles is asserted
 * byte-exactly as the one structural transform.
 */

type Parsed = { nodes: TmplAstNode[] };

function parse(template: string): Parsed {
  const out = parseTemplate(template, "screen.html", { preserveWhitespaces: true });
  expect(out.errors ?? [], `template parses cleanly`).toEqual([]);
  return { nodes: out.nodes };
}

/**
 * The exporter deliberately emits two CONSTANT binding forms (literal-string
 * interpolations for {{-containing text, [attr.x]="'…'" for {{-containing
 * attribute values). Those must be constant-evaluable; anything else bound is
 * a corruption. evalConst returns the exact string or throws.
 */
function evalConst(ast: AST): string {
  if (ast instanceof ASTWithSource) return evalConst(ast.ast);
  if (ast instanceof Interpolation) {
    let out = "";
    for (let i = 0; i < ast.expressions.length; i++) {
      out += ast.strings[i] ?? "";
      out += evalConst(ast.expressions[i]);
    }
    out += ast.strings[ast.expressions.length] ?? "";
    return out;
  }
  if (ast instanceof LiteralPrimitive) return String(ast.value);
  if (ast instanceof Binary && ast.operation === "+") {
    return evalConst(ast.left) + evalConst(ast.right);
  }
  throw new Error(`non-constant expression in template: ${ast.constructor.name}`);
}

function assertOnlyConstBindings(nodes: TmplAstNode[], path = "root"): void {
  for (const node of nodes) {
    if (node instanceof TmplAstBoundText) {
      evalConst(node.value); // throws when not constant
    }
    if (node instanceof TmplAstElement) {
      if (node.outputs.length) {
        throw new Error(`${path}<${node.name}>: event binding leaked into template`);
      }
      for (const input of node.inputs) {
        if (input.type !== BindingType.Attribute) {
          throw new Error(`${path}<${node.name}>: unexpected binding [${input.name}]`);
        }
        evalConst(input.value);
      }
      assertOnlyConstBindings(node.children, `${path}<${node.name}>`);
    }
  }
}

function astToHtml(nodes: TmplAstNode[]): string {
  const doc = document.implementation.createHTMLDocument("ast");
  const root = doc.createElement("div");
  const SVG_NS = "http://www.w3.org/2000/svg";

  const emit = (node: TmplAstNode, parent: Element, inSvg: boolean): void => {
    if (node instanceof TmplAstText) {
      parent.appendChild(doc.createTextNode(node.value));
      return;
    }
    if (node instanceof TmplAstBoundText) {
      parent.appendChild(doc.createTextNode(evalConst(node.value)));
      return;
    }
    if (node instanceof TmplAstElement) {
      const name = node.name.replace(/^:?svg:/, "");
      const nowSvg = inSvg || name === "svg";
      const el = nowSvg ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
      for (const attr of node.attributes) {
        el.setAttribute(attr.name, attr.value);
      }
      for (const input of node.inputs) {
        if (input.type === BindingType.Attribute)
          el.setAttribute(input.name, evalConst(input.value));
      }
      for (const child of node.children) emit(child, el, nowSvg);
      parent.appendChild(el);
      return;
    }
    // Comments and anything else: ignored (compared with ignoreComments).
  };

  for (const node of nodes) emit(node, root, false);
  return root.innerHTML;
}

/** Canonical screen minus in-screen <style> nodes (hoisted by the exporter),
 * plus the removed CSS for the byte-exact hoist assertion. */
function stripStyles(html: string): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(`<div id="__s">${html}</div>`, "text/html");
  const root = doc.getElementById("__s")!;
  const cssParts: string[] = [];
  root.querySelectorAll("style").forEach((el) => {
    cssParts.push(el.textContent || "");
    el.remove();
  });
  return { html: root.innerHTML, css: cssParts.join("\n").trim() };
}

describe("Angular export: compiler AST DOM-equals canvas HTML", () => {
  for (const [name, rawHtml] of Object.entries(SCREEN_FIXTURES)) {
    it(`fixture: ${name}`, async () => {
      const canonical = ensureIds(rawHtml);
      const nodes = await htmlToIrChildren(canonical);
      const { template, css } = await angularScreenTemplate(nodes);

      const parsed = parse(template);
      assertOnlyConstBindings(parsed.nodes);

      const reference = stripStyles(canonical);
      expectDomEqual(astToHtml(parsed.nodes), reference.html, { ignoreComments: true });
      // The one structural transform: in-screen CSS hoists byte-exactly.
      expect(css).toBe(reference.css);
    });
  }

  it("braces and @ in text survive as literal text, never as blocks/bindings", async () => {
    const canonical = ensureIds(SCREEN_FIXTURES["edge-cases"]);
    const nodes = await htmlToIrChildren(canonical);
    const { template } = await angularScreenTemplate(nodes);
    // {{-containing text rides inside a literal interpolation; other braces
    // are entity-escaped ({tokens} in the same node goes with the literal,
    // ${expr} in the entity-only node stays &#123;…).
    expect(template).toContain("{{ '");
    expect(template).toContain("&#123;");
    const parsed = parse(template);
    assertOnlyConstBindings(parsed.nodes);
    const rendered = astToHtml(parsed.nodes);
    expect(rendered).toContain("{{handlebars}}");
    expect(rendered).toContain("@if and @for as text");
  });

  it("project export ships manifest + real template components, no innerHTML", async () => {
    const project = makeProject();
    project.screens = project.screens.map((s) => ({ ...s, html: ensureIds(s.html) }));
    const files = await buildAngularProjectExport(project);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("sleek-design/manifest.json");
    expect(paths).toContain("src/app/screens/home-screen.component.html");
    expect(paths).toContain("src/app/screens/detail-screen.component.ts");
    for (const file of files) {
      expect(file.content).not.toContain("bypassSecurityTrustHtml");
      if (file.path.startsWith("src/app/screens/")) {
        expect(file.content).not.toContain("[innerHTML]");
      }
    }
    const componentTs = files.find((f) => f.path === "src/app/screens/home-screen.component.ts")!;
    expect(componentTs.content).toContain("preserveWhitespaces: true");

    // Each screen template parses + DOM-equals its canvas screen.
    for (const [fileBase, index] of [
      ["home-screen", 0],
      ["detail-screen", 1],
    ] as const) {
      const tpl = files.find((f) => f.path === `src/app/screens/${fileBase}.component.html`)!;
      const parsed = parse(tpl.content);
      assertOnlyConstBindings(parsed.nodes);
      const reference = stripStyles(project.screens[index].html);
      expectDomEqual(astToHtml(parsed.nodes), reference.html, { ignoreComments: true });
    }
  });
});
