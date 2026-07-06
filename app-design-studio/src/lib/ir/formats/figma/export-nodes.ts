import type { Project } from "@/lib/screen-schema";
import { getEffects, getMaeType } from "../../core/attrs";
import { serializeInlineStyle } from "../../core/inline-style";
import { projectToIr } from "../../core/project-bridge";
import { attachResolvedData, type ResolveOptions } from "../../resolve/client";
import { isElement, isText, type IRChild, type IRNode, type Resolved } from "../../schema";
import {
  cornerRadiusFromComputed,
  effectsFromComputed,
  effectsFromMae,
  fillsFromComputed,
  firstFontFamily,
  fontWeight,
  parseColor,
  px,
  strokeFromComputed,
  textAlign,
} from "./style-map";
import type {
  AutoLayoutSpec,
  FigmaExportDocument,
  FigmaNodeSpec,
  FrameNodeSpec,
  TextNodeSpec,
  TextRangeSpec,
} from "./types";

/**
 * IR (+resolved geometry/styles from the resolve pass) → sleek.figma-nodes.
 *
 * Layout strategy (the fidelity backstop): every child is positioned by its
 * RESOLVED rect relative to its parent — pixel-true no matter what CSS
 * produced it. When the parent is a clean flex row/column, auto-layout is
 * ALSO emitted so the Figma output stays editable; anything auto-layout
 * can't express (grid, wrap, floats, absolute children) simply stays
 * absolute — "pixel-frozen, never wrong".
 */

const INLINE_TEXT_TAGS = new Set(["span", "b", "strong", "i", "em", "a", "u", "s", "small", "sub", "sup", "code"]);

type Ctx = { warnings: string[] };

function autoLayoutFromComputed(
  node: IRNode,
  children: IRNode[],
  ctx: Ctx,
): AutoLayoutSpec | undefined {
  const c = node.resolved?.computed;
  if (!c || c["display"] !== "flex") return undefined;
  const direction = c["flex-direction"] || "row";
  if (direction.includes("reverse")) {
    ctx.warnings.push(`${node.name}: flex-direction ${direction} kept absolute (no auto-layout).`);
    return undefined;
  }
  const wrap = c["flex-wrap"] === "wrap";
  if (wrap) {
    ctx.warnings.push(`${node.name}: flex-wrap kept absolute (auto-layout wrap differs).`);
    return undefined;
  }
  // Absolute-positioned children break auto-layout flow — keep frame absolute.
  if (children.some((child) => child.resolved?.computed["position"] === "absolute")) {
    return undefined;
  }
  const primary = ((): AutoLayoutSpec["primaryAxisAlignItems"] => {
    switch (c["justify-content"]) {
      case "center":
        return "CENTER";
      case "flex-end":
      case "end":
        return "MAX";
      case "space-between":
        return "SPACE_BETWEEN";
      case "space-around":
      case "space-evenly":
        return "SPACE_BETWEEN";
      default:
        return "MIN";
    }
  })();
  const counter = ((): AutoLayoutSpec["counterAxisAlignItems"] => {
    switch (c["align-items"]) {
      case "center":
        return "CENTER";
      case "flex-end":
      case "end":
        return "MAX";
      default:
        return "MIN";
    }
  })();
  return {
    mode: direction === "column" ? "VERTICAL" : "HORIZONTAL",
    itemSpacing: px(c["column-gap"] || c["gap"]) || px(c["row-gap"]),
    padding: {
      top: px(c["padding-top"]),
      right: px(c["padding-right"]),
      bottom: px(c["padding-bottom"]),
      left: px(c["padding-left"]),
    },
    primaryAxisAlignItems: primary,
    counterAxisAlignItems: counter,
    wrap: false,
  };
}

function textContentOf(children: IRChild[]): string {
  let out = "";
  for (const child of children) {
    if (isText(child)) out += child.value;
    else if (isElement(child)) out += textContentOf(child.children);
  }
  return out;
}

/** True when the element renders as a single text block (only text and inline
 * styled spans inside). */
function isTextLike(node: IRNode): boolean {
  if (getMaeType(node) === "text") return true;
  if (node.tag === "img" || node.tag === "svg") return false;
  if (!node.children.length) return false;
  return node.children.every((child) => {
    if (isText(child)) return true;
    if (!isElement(child)) return true; // comments
    return (
      INLINE_TEXT_TAGS.has(child.tag) &&
      child.children.every((grand) => !isElement(grand) || INLINE_TEXT_TAGS.has(grand.tag))
    );
  });
}

function baseSpec(node: IRNode, parentResolved: Resolved | undefined, ctx: Ctx) {
  const r = node.resolved;
  const rect = r?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const parentRect = parentResolved?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
  const computed = r?.computed ?? {};
  const maeEffects = getEffects(node);
  const opacity = parseFloat(computed["opacity"] || "1");

  return {
    id: node.id,
    name: node.name,
    x: rect.x - parentRect.x,
    y: rect.y - parentRect.y,
    width: Math.max(rect.w, 0.01),
    height: Math.max(rect.h, 0.01),
    opacity: Number.isFinite(opacity) && opacity !== 1 ? opacity : undefined,
    cornerRadius: cornerRadiusFromComputed(computed),
    fills: fillsFromComputed(computed, ctx.warnings),
    stroke: strokeFromComputed(computed) ?? undefined,
    effects: maeEffects.length ? effectsFromMae(maeEffects) : effectsFromComputed(computed, ctx.warnings),
  };
}

function textSpec(node: IRNode, parentResolved: Resolved | undefined, ctx: Ctx): TextNodeSpec {
  const base = baseSpec(node, parentResolved, ctx);
  const c = node.resolved?.computed ?? {};
  const characters = textContentOf(node.children);

  // Ranges from direct inline children with their own resolved styles.
  const ranges: TextRangeSpec[] = [];
  let offset = 0;
  for (const child of node.children) {
    if (isText(child)) {
      offset += child.value.length;
      continue;
    }
    if (!isElement(child)) continue;
    const len = textContentOf(child.children).length;
    const cc = child.resolved?.computed;
    if (cc && len > 0) {
      const range: TextRangeSpec = { start: offset, end: offset + len };
      if (cc["font-family"] !== c["font-family"]) range.fontFamily = firstFontFamily(cc["font-family"]);
      if (cc["font-weight"] !== c["font-weight"]) range.fontWeight = fontWeight(cc["font-weight"]);
      if (cc["font-size"] !== c["font-size"]) range.fontSize = px(cc["font-size"]);
      if (cc["color"] !== c["color"]) range.color = parseColor(cc["color"]) ?? undefined;
      if (cc["letter-spacing"] !== c["letter-spacing"] && cc["letter-spacing"] !== "normal") {
        range.letterSpacing = px(cc["letter-spacing"]);
      }
      if (cc["text-decoration-line"]?.includes("underline")) range.textDecoration = "UNDERLINE";
      else if (cc["text-decoration-line"]?.includes("line-through")) range.textDecoration = "STRIKETHROUGH";
      if (Object.keys(range).length > 2) ranges.push(range);
    }
    offset += len;
  }

  const lineHeight = c["line-height"];
  return {
    ...base,
    type: "TEXT",
    // Text carries its own color; background fills (rare on text) retained.
    characters,
    fontFamily: firstFontFamily(c["font-family"]),
    fontWeight: fontWeight(c["font-weight"]),
    fontSize: px(c["font-size"]) || 16,
    lineHeightPx: lineHeight && lineHeight !== "normal" ? px(lineHeight) : undefined,
    letterSpacing: c["letter-spacing"] && c["letter-spacing"] !== "normal" ? px(c["letter-spacing"]) : 0,
    textAlign: textAlign(c["text-align"]),
    color: parseColor(c["color"]) ?? { r: 0, g: 0, b: 0, a: 1 },
    ranges: ranges.length ? ranges : undefined,
  };
}

function svgOuter(node: IRNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${v.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  const cls = node.classes.length ? ` class="${node.classes.join(" ")}"` : "";
  const style = node.styleDecls.length ? ` style="${serializeInlineStyle(node.styleDecls).replace(/"/g, "&quot;")}"` : "";
  return `<svg${attrs}${cls}${style}>${node.svgInner ?? ""}</svg>`;
}

function nodeToSpec(node: IRNode, parentResolved: Resolved | undefined, ctx: Ctx): FigmaNodeSpec | null {
  const computed = node.resolved?.computed;
  if (computed && (computed["display"] === "none" || computed["visibility"] === "hidden")) {
    return null;
  }
  if (!node.resolved) {
    ctx.warnings.push(`${node.name} (${node.id}): no resolved geometry — skipped.`);
    return null;
  }

  const maeType = getMaeType(node);

  if (node.tag === "svg") {
    return { ...baseSpec(node, parentResolved, ctx), type: "SVG", svg: svgOuter(node) };
  }

  if (node.tag === "img") {
    const base = baseSpec(node, parentResolved, ctx);
    const src = node.attrs["src"];
    if (src) {
      base.fills = [
        ...(base.fills ?? []),
        { type: "IMAGE", url: src, scaleMode: computed?.["object-fit"] === "contain" ? "FIT" : "FILL" },
      ];
    }
    return { ...base, type: "RECTANGLE" };
  }

  if (maeType === "ellipse") {
    return { ...baseSpec(node, parentResolved, ctx), type: "ELLIPSE" };
  }

  if (isTextLike(node)) {
    const base = baseSpec(node, parentResolved, ctx);
    const hasBox = (base.fills?.length ?? 0) > 0 || base.stroke || base.cornerRadius;
    if (!hasBox) return textSpec(node, parentResolved, ctx);
    // Text with its own box (button/badge): frame + centered text child.
    const text = textSpec(node, node.resolved, ctx);
    text.x = 0;
    text.y = 0;
    text.fills = undefined;
    const frame: FrameNodeSpec = {
      ...base,
      type: "FRAME",
      clipsContent: computed?.["overflow-x"] === "hidden",
      layout: autoLayoutFromComputed(node, [], ctx),
      children: [text],
    };
    return frame;
  }

  const elementChildren = node.children.filter(isElement);
  if (!elementChildren.length && !textContentOf(node.children).trim()) {
    // Leaf box (decorative div, spacer, chart bar, …).
    return { ...baseSpec(node, parentResolved, ctx), type: "RECTANGLE" };
  }

  const children: FigmaNodeSpec[] = [];
  for (const child of elementChildren) {
    const spec = nodeToSpec(child, node.resolved, ctx);
    if (spec) children.push(spec);
  }
  // Loose text among element children (mixed content): synthesize a text node.
  const looseText = node.children.filter(isText).map((t) => t.value).join("").trim();
  if (looseText && elementChildren.length) {
    ctx.warnings.push(`${node.name}: mixed text+element content — loose text emitted as its own layer.`);
    children.push({
      id: `${node.id}-text`,
      name: `${node.name} text`,
      type: "TEXT",
      x: 0,
      y: 0,
      width: node.resolved.rect.w,
      height: node.resolved.rect.h,
      characters: looseText,
      fontFamily: firstFontFamily(computed?.["font-family"]),
      fontWeight: fontWeight(computed?.["font-weight"]),
      fontSize: px(computed?.["font-size"]) || 16,
      letterSpacing: 0,
      textAlign: textAlign(computed?.["text-align"]),
      color: parseColor(computed?.["color"]) ?? { r: 0, g: 0, b: 0, a: 1 },
    });
  }

  return {
    ...baseSpec(node, parentResolved, ctx),
    type: "FRAME",
    clipsContent: computed?.["overflow-x"] === "hidden" || computed?.["overflow-y"] === "hidden",
    layout: autoLayoutFromComputed(node, elementChildren, ctx),
    children,
  };
}

export type FigmaExportOptions = ResolveOptions;

export async function buildFigmaExport(
  project: Project,
  opts: FigmaExportOptions = {},
): Promise<FigmaExportDocument> {
  const ir = await projectToIr(project);
  const warnings = await attachResolvedData(ir, project, opts);
  const ctx: Ctx = { warnings };

  const frames: FigmaExportDocument["frames"] = [];
  for (const screen of ir.screens) {
    const elementRoots = screen.nodes.filter(isElement);
    // The screen frame: sized to the design frame, children = screen roots.
    const rootResolved: Resolved = {
      rect: {
        x: 0,
        y: 0,
        w: ir.meta.frame.w,
        h: ir.meta.frame.h ?? Math.max(...elementRoots.map((n) => n.resolved?.rect.h ?? 0), 812),
      },
      computed: {},
    };
    const children: FigmaNodeSpec[] = [];
    for (const root of elementRoots) {
      const spec = nodeToSpec(root, rootResolved, ctx);
      if (spec) children.push(spec);
    }
    frames.push({
      screenId: screen.id,
      screenName: screen.name,
      id: `screen-${screen.id}`,
      name: screen.name,
      type: "FRAME",
      x: 0,
      y: 0,
      width: rootResolved.rect.w,
      height: rootResolved.rect.h,
      clipsContent: true,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
      children,
    });
  }

  return {
    schema: "sleek.figma-nodes",
    version: 1,
    name: project.name,
    frames,
    warnings: ctx.warnings,
  };
}
