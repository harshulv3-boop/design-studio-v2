import {
  parseTemplate,
  TmplAstElement,
  TmplAstText,
  TmplAstBoundText,
  TmplAstTemplate,
  ASTWithSource,
  Interpolation,
  LiteralPrimitive,
  Binary,
  PropertyRead,
  BindingType,
} from "@angular/compiler";
import type { AST, TmplAstNode } from "@angular/compiler";
import { getDom } from "../../core/dom";

/**
 * Angular template → static HTML via the REAL Angular compiler (replaces the
 * old regex-based extraction in /api/import-code). Handles what a static
 * import can honestly handle:
 *  - text, elements, static attributes;
 *  - constant expressions (our own exports: literal interpolations and
 *    [attr.x]="'…'" bindings) — resolved exactly;
 *  - simple {{ field }} reads resolved from literal class-field initializers;
 *  - structural directives (*ngIf/*ngFor …): directive stripped, children
 *    rendered once (previous best-effort behavior, now nesting-safe);
 *  - unresolvable bindings dropped with a warning instead of corrupting.
 */

export type AngularStaticResult = { html: string; warnings: string[] };

export async function angularTemplateToStaticHtml(
  template: string,
  fields: Record<string, string>,
): Promise<AngularStaticResult> {
  const parsed = parseTemplate(template, "import.component.html", {
    preserveWhitespaces: true,
  });
  if (parsed.errors?.length) {
    throw new Error(`Could not parse the Angular template: ${parsed.errors[0].msg}`);
  }

  const warnings = new Set<string>();

  const evalExpr = (ast: AST): string => {
    if (ast instanceof ASTWithSource) return evalExpr(ast.ast);
    if (ast instanceof Interpolation) {
      let out = "";
      for (let i = 0; i < ast.expressions.length; i++) {
        out += ast.strings[i] ?? "";
        out += evalExpr(ast.expressions[i]);
      }
      return out + (ast.strings[ast.expressions.length] ?? "");
    }
    if (ast instanceof LiteralPrimitive) return ast.value == null ? "" : String(ast.value);
    if (ast instanceof Binary && ast.operation === "+") {
      return evalExpr(ast.left) + evalExpr(ast.right);
    }
    if (ast instanceof PropertyRead) {
      if (ast.name in fields) return fields[ast.name];
      warnings.add(`Unresolved binding "${ast.name}" was blanked (no literal initializer found).`);
      return "";
    }
    warnings.add("A dynamic expression couldn't be evaluated statically and was blanked.");
    return "";
  };

  const dom = await getDom();
  const doc = dom.createDocument();
  const root = doc.createElement("div");
  const SVG_NS = "http://www.w3.org/2000/svg";

  const emit = (node: TmplAstNode, parent: Element, inSvg: boolean): void => {
    if (node instanceof TmplAstText) {
      parent.appendChild(doc.createTextNode(node.value));
      return;
    }
    if (node instanceof TmplAstBoundText) {
      parent.appendChild(doc.createTextNode(evalExpr(node.value)));
      return;
    }
    if (node instanceof TmplAstTemplate) {
      // Structural directive (*ngIf/*ngFor/...) — strip, render children once.
      warnings.add(
        "Structural directives (*ngIf/*ngFor) were stripped — their content renders once, statically.",
      );
      for (const child of node.children) emit(child, parent, inSvg);
      return;
    }
    if (node instanceof TmplAstElement) {
      const name = node.name.replace(/^:?svg:/, "");
      const nowSvg = inSvg || name === "svg";
      const el = nowSvg ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
      for (const attr of node.attributes) el.setAttribute(attr.name, attr.value);
      for (const input of node.inputs) {
        if (input.type === BindingType.Attribute) {
          try {
            el.setAttribute(input.name, evalExpr(input.value));
          } catch {
            warnings.add(`Attribute binding [attr.${input.name}] was dropped.`);
          }
        } else {
          warnings.add(`Property binding [${input.name}] was dropped (static import).`);
        }
      }
      if (node.outputs.length) {
        warnings.add(
          "Event bindings were stripped — interactivity doesn't survive a static import.",
        );
      }
      for (const child of node.children) emit(child, el, nowSvg);
      parent.appendChild(el);
      return;
    }
    // ng-content / defer / unknown nodes: nothing static to render.
  };

  for (const node of parsed.nodes) emit(node, root, false);
  return { html: root.innerHTML, warnings: [...warnings] };
}
