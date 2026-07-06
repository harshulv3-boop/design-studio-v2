import type { IRChild, IRNode } from "../../schema";
import { uid } from "../../core/html-to-ir";
import type {
  FigmaColorStop,
  FigmaEffect,
  FigmaImagesResponse,
  FigmaNode,
  FigmaNodeBase,
  FigmaNodesResponse,
  FigmaPaint,
  FigmaRGBA,
  FigmaTypeStyle,
} from "./api-types";

/**
 * Figma REST nodes → IR children (canvas HTML via irChildrenToHtml).
 *
 * The reverse of export-nodes.ts: instead of reading resolved CSS off a DOM,
 * we synthesize inline styles from Figma's resolved geometry + paints, so what
 * arrives on the canvas is positioned exactly like the Figma source.
 *
 * Layout strategy (mirrors the export's "pixel-frozen" backstop): every node
 * is absolutely positioned at its Figma rect, sized to its Figma dimensions.
 * Auto-layout in Figma is therefore reproduced as a faithful static layout —
 * no dependency on the canvas re-flowing Figma's auto-layout semantics. The
 * user can re-flex later; the import's job is to match the source, not infer a
 * different model.
 *
 * Images: Figma gives image fills as an `imageRef` only — bytes come from the
 * separate /v1/images endpoint. Callers pass the resolved {imageRef → url} map
 * so <img src> can be emitted at conversion time.
 */

/** 0..1 float → CSS color string. Alpha 1 → rgb(); else rgba(). */
function rgbaToCss(c: FigmaRGBA): string {
  const r = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
  const a = Math.min(1, Math.max(0, c.a));
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${round(a)})`;
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function px(n: number | undefined): string | undefined {
  return n == null || !Number.isFinite(n) ? undefined : `${round(n)}px`;
}

/** Figma's gradientTransform is a 2x3 affine; the rotation angle (deg) is the
 * principal axis. Derived from the same formula the plugin reverses (see
 * figma-plugin/src/code.ts gradientTransform), so a Figma-origin gradient
 * roundtrips back through our exporter to the same angle. */
function angleFromGradientTransform(
  t: [[number, number, number], [number, number, number]],
): number {
  // t = [[a,b,c],[d,e,f]]; rotation = atan2(d, a).
  const a = t[0][0];
  const d = t[1][0];
  let deg = (Math.atan2(d, a) * 180) / Math.PI;
  // Figma's gradient runs bottom→top at 0deg; CSS linear-gradient runs top→bottom.
  // Add 90 to map Figma space into CSS degrees (matches plugin's inverse).
  deg = (deg + 90 + 360) % 360;
  return Math.round(deg);
}

function paintToCss(
  paint: FigmaPaint,
  images: Record<string, string>,
): { background?: string; boxShadow?: string; tag?: string; src?: string } {
  if (paint.visible === false) return {};
  const opacity = paint.opacity ?? 1;

  if (paint.type === "SOLID") {
    const c = paint.color;
    const color = opacity < 1 ? { ...c, a: c.a * opacity } : c;
    return { background: rgbaToCss(color) };
  }

  if (paint.type === "GRADIENT_LINEAR") {
    const angle = angleFromGradientTransform(paint.gradientTransform as any);
    const stops = paint.gradientStops.map((s: FigmaColorStop) => {
      const a = opacity < 1 ? { ...s.color, a: s.color.a * opacity } : s.color;
      return `${rgbaToCss(a)} ${Math.round(s.position * 100)}%`;
    });
    return { background: `linear-gradient(${angle}deg, ${stops.join(", ")})` };
  }

  // GRADIENT_RADIAL/ANGULAR — approximate as a solid of the first stop; the
  // export path emits the same approximation, so the round-trip is stable.
  if (paint.type === "GRADIENT_RADIAL" || paint.type === "GRADIENT_ANGULAR") {
    const first = paint.gradientStops[0]?.color;
    if (first) return { background: rgbaToCss(first) };
    return {};
  }

  if (paint.type === "IMAGE" && paint.imageRef) {
    const url = images[paint.imageRef];
    if (url) {
      return {
        // Emit a real <img> instead of a background-image so the element stays
        // editable in the canvas (the editor treats <img> as a first-class
        // image layer; background-image fills are decorative).
        tag: "img",
        src: url,
      };
    }
  }
  return {};
}

function effectsToCss(effects: FigmaEffect[]): { boxShadow?: string; filter?: string } {
  const shadows: string[] = [];
  const blurs: string[] = [];
  for (const fx of effects) {
    if (fx.visible === false) continue;
    if (fx.type === "DROP_SHADOW" || fx.type === "INNER_SHADOW") {
      const inset = fx.type === "INNER_SHADOW" ? "inset " : "";
      // Figma omits `spread` when zero; default to 0 (NOT undefined → NaN).
      const spread = fx.spread ?? 0;
      shadows.push(
        `${inset}${round(fx.offset.x)}px ${round(fx.offset.y)}px ${round(fx.radius)}px ${round(spread)}px ${rgbaToCss(fx.color)}`,
      );
    } else if (fx.type === "LAYER_BLUR") {
      blurs.push(`blur(${round(fx.radius)}px)`);
    } else if (fx.type === "BACKGROUND_BLUR") {
      blurs.push(`backdrop-filter:blur(${round(fx.radius)}px)`); // handled separately
    }
  }
  const out: { boxShadow?: string; filter?: string } = {};
  if (shadows.length) out.boxShadow = shadows.join(", ");
  if (blurs.length) {
    // background-blur is a separate property; surface as filter for simplicity,
    // matching the export's effectsFromComputed fallback.
    out.filter = blurs.filter((b) => !b.startsWith("backdrop-filter:")).join(" ");
  }
  return out;
}

function radiusFromNode(node: FigmaNode): string | undefined {
  const r = "rectangleCornerRadii" in node ? node.rectangleCornerRadii : undefined;
  if (r) {
    const [tl, tr, br, bl] = r;
    if (tl === tr && tr === br && br === bl) return px(tl);
    return `${round(tl)}px ${round(tr)}px ${round(br)}px ${round(bl)}px`;
  }
  return "cornerRadius" in node && node.cornerRadius != null ? px(node.cornerRadius) : undefined;
}

/** Read a node's absolute rect from absoluteBoundingBox (preferred) or
 * absoluteRenderBounds. Falls back to the legacy x/y/width/height fields for
 * callers building nodes by hand (tests, etc.). Returns null if no geometry. */
function nodeRect(node: FigmaNode): { x: number; y: number; w: number; h: number } | null {
  const ab = "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null;
  if (ab && typeof ab.x === "number") return { x: ab.x, y: ab.y, w: ab.width, h: ab.height };
  const rb = "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null;
  if (rb && typeof rb.x === "number") return { x: rb.x, y: rb.y, w: rb.width, h: rb.height };
  const base = node as FigmaNodeBase;
  if (typeof base.x === "number" && typeof base.width === "number") {
    return { x: base.x, y: base.y ?? 0, w: base.width, h: base.height ?? 0 };
  }
  return null;
}

/** Build the inline-style declaration list for a node's box (fills + stroke +
 * radius + position + size + opacity + effects). Text nodes get typography on
 * top of this. `parentRect` is the parent's ABSOLUTE rect (or null at root);
 * positions are emitted relative to it. */
function boxStyle(
  node: FigmaNode,
  parentRect: { x: number; y: number } | null,
  images: Record<string, string>,
): { styleDecls: [string, string, boolean][]; tag: string; src?: string } {
  const decls: [string, string, boolean][] = [];
  let tag = "div";
  let src: string | undefined;

  const rect = nodeRect(node);
  if (rect) {
    // Absolute positioning — every node placed at its Figma rect, relative to
    // its parent. The root (parentRect null) is also absolute so the canvas
    // frame stays a positioned container.
    decls.push(["position", "absolute", false]);
    const parentX = parentRect?.x ?? 0;
    const parentY = parentRect?.y ?? 0;
    decls.push(["left", `${round(rect.x - parentX)}px`, false]);
    decls.push(["top", `${round(rect.y - parentY)}px`, false]);
    decls.push(["width", `${round(rect.w)}px`, false]);
    decls.push(["height", `${round(rect.h)}px`, false]);
  }

  if (node.opacity != null && node.opacity < 1) {
    decls.push(["opacity", String(round(node.opacity)), false]);
  }

  // Fills: first paint wins as the primary background (Figma paints first on
  // top, so we keep the most opaque solid; gradients override solids).
  const paints = (node.fills ?? []).filter((p) => p.visible !== false);
  let gradientSeen = false;
  for (const paint of paints) {
    const css = paintToCss(paint, images);
    if (css.tag === "img" && css.src) {
      tag = "img";
      src = css.src;
    } else if (css.background) {
      if (paint.type === "GRADIENT_LINEAR" && !gradientSeen) {
        decls.push(["background", css.background, false]);
        gradientSeen = true;
      } else if (!decls.some((d) => d[0] === "background") && !gradientSeen) {
        decls.push(["background", css.background, false]);
      }
    }
  }

  // Stroke — single-weight only (CSS borders can't easily express per-side
  // weights + radius without distortion; the common case is uniform).
  if (node.strokes && node.strokes.length) {
    const stroke = node.strokes.find((p) => p.visible !== false);
    if (stroke && stroke.type === "SOLID") {
      const w = node.individualStrokeWeights
        ? Math.max(
            node.individualStrokeWeights.top,
            node.individualStrokeWeights.right,
            node.individualStrokeWeights.bottom,
            node.individualStrokeWeights.left,
          )
        : node.strokeWeight ?? 1;
      if (w > 0) {
        decls.push(["border", `${round(w)}px solid ${rgbaToCss(stroke.color)}`, false]);
      }
    }
  }

  const radius = radiusFromNode(node);
  if (radius) decls.push(["border-radius", radius, false]);

  if (node.effects && node.effects.length) {
    const fx = effectsToCss(node.effects);
    if (fx.boxShadow) decls.push(["box-shadow", fx.boxShadow, false]);
    if (fx.filter) decls.push(["filter", fx.filter, false]);
  }

  // Ellipses: a 50% radius turns a rectangle into a circle.
  if (node.type === "ELLIPSE") {
    decls.push(["border-radius", "50%", false]);
  }

  return { styleDecls: decls, tag, src };
}

function typeStyleToCss(style: FigmaTypeStyle): [string, string, boolean][] {
  const out: [string, string, boolean][] = [];
  if (style.fontFamily) out.push(["font-family", style.fontFamily, false]);
  if (style.fontWeight != null) out.push(["font-weight", String(style.fontWeight), false]);
  if (style.fontSize != null) out.push(["font-size", `${round(style.fontSize)}px`, false]);
  if (style.lineHeightPx != null) out.push(["line-height", `${round(style.lineHeightPx)}px`, false]);
  if (style.letterSpacing != null) out.push(["letter-spacing", `${round(style.letterSpacing)}px`, false]);
  switch (style.textAlignHorizontal) {
    case "CENTER": out.push(["text-align", "center", false]); break;
    case "RIGHT": out.push(["text-align", "right", false]); break;
    case "JUSTIFIED": out.push(["text-align", "justify", false]); break;
    default: break;
  }
  switch (style.textDecoration) {
    case "UNDERLINE": out.push(["text-decoration", "underline", false]); break;
    case "STRIKETHROUGH": out.push(["text-decoration", "line-through", false]); break;
    default: break;
  }
  switch (style.textCase) {
    case "UPPER": out.push(["text-transform", "uppercase", false]); break;
    case "LOWER": out.push(["text-transform", "lowercase", false]); break;
    case "TITLE": out.push(["text-transform", "capitalize", false]); break;
    default: break;
  }
  // Text fills (color). Most text nodes carry a single SOLID fill = the color.
  if (style.fills && style.fills.length) {
    const solid = style.fills.find((f) => f.type === "SOLID" && f.visible !== false);
    if (solid && solid.type === "SOLID") out.push(["color", rgbaToCss(solid.color), false]);
  }
  return out;
}

/** Convert one Figma node → IRNode. Children recurse, receiving this node's
 * absolute rect as their parentRect so positions are emitted relative to it. */
function figmaNodeToIr(
  node: FigmaNode,
  parentRect: { x: number; y: number } | null,
  images: Record<string, string>,
  warnings: string[],
): IRNode | null {
  if (node.visible === false) return null;

  const myRect = nodeRect(node);
  const childParentRect = myRect ? { x: myRect.x, y: myRect.y } : parentRect;

  // GROUP: a transparent wrapper sized to the group's bounds. Children keep
  // their absolute→relative positioning against the group's origin.
  if (node.type === "GROUP" && "children" in node) {
    if (!node.children?.length) return null;
    const groupBox = boxStyle(node, parentRect, images);
    const children = node.children
      .map((c) => figmaNodeToIr(c, childParentRect, images, warnings))
      .filter((n): n is IRNode => n !== null);
    if (!children.length) return null;
    return {
      kind: "element",
      id: uid(),
      tag: "div",
      name: node.name,
      attrs: {},
      classes: [],
      styleDecls: groupBox.styleDecls,
      children,
    };
  }

  // TEXT — emit a <span> with characters + typography + positioning.
  if (node.type === "TEXT") {
    const baseStyle = typeStyleToCss(node.style ?? {});
    const box = boxStyle(node, parentRect, images);
    const decls = [...box.styleDecls, ...baseStyle];
    // Per-character style overrides → wrap ranges in <span> for fidelity.
    const characters = node.characters ?? "";
    const overrides = node.characterStyleOverrides ?? [];
    const table = node.styleOverrideTable ?? {};
    const children: IRChild[] = [];
    let i = 0;
    while (i < characters.length) {
      const start = i;
      const idx = overrides[i] ?? 0;
      i++;
      while (i < characters.length && (overrides[i] ?? 0) === idx) i++;
      const segment = characters.slice(start, i);
      if (idx === 0) {
        children.push({ kind: "text", value: segment });
      } else {
        const overrideStyle = table[String(idx)];
        const spanDecls = overrideStyle ? typeStyleToCss(overrideStyle) : [];
        children.push({
          kind: "element",
          id: uid(),
          tag: "span",
          name: "Text range",
          attrs: {},
          classes: [],
          styleDecls: spanDecls,
          children: [{ kind: "text", value: segment }],
        });
      }
    }
    return {
      kind: "element",
      id: uid(),
      tag: "span",
      name: node.name || "Text",
      attrs: {},
      classes: [],
      styleDecls: decls,
      children,
    };
  }

  // VECTOR/STAR/POLYGON/BOOLEAN_OPERATION → if a raster URL exists for this
  // node id (resolved via /v1/images), render an <img>; else warn.
  if (node.type !== "FRAME" && node.type !== "RECTANGLE" && node.type !== "ELLIPSE") {
    const box = boxStyle(node, parentRect, images);
    const url = images[node.id];
    if (url) {
      return {
        kind: "element",
        id: uid(),
        tag: "img",
        name: node.name,
        attrs: { src: url, alt: node.name },
        classes: [],
        styleDecls: box.styleDecls,
        children: [],
      };
    }
    warnings.push(`Vector "${node.name}" (${node.type}) has no raster URL — emitted as a sized box.`);
  }

  const box = boxStyle(node, parentRect, images);
  const isFrame = node.type === "FRAME" || "children" in node;
  const children: IRChild[] = [];

  if (isFrame && "children" in node) {
    const kids = (node.children ?? [])
      .map((c) => figmaNodeToIr(c, childParentRect, images, warnings))
      .filter((n): n is IRNode => n !== null);
    children.push(...kids);
    if (node.clipsContent) box.styleDecls.push(["overflow", "hidden", false]);
  }

  const attrs: Record<string, string> = {};
  if (box.tag === "img" && box.src) {
    attrs.src = box.src;
    attrs.alt = node.name;
  }

  return {
    kind: "element",
    id: uid(),
    tag: box.tag,
    name: node.name,
    attrs,
    classes: [],
    styleDecls: box.styleDecls,
    children: box.tag === "img" ? [] : children,
  };
}

export type FigmaImportOptions = {
  /** imageRef (from a node's IMAGE fill) → public URL (resolved via /v1/images). */
  images?: Record<string, string>;
};

/**
 * Convert a Figma REST `/nodes` response into one IR screen per top-level
 * requested node. Each frame becomes a canvas screen; its descendants become
 * absolutely-positioned children — pixel-faithful to the Figma source.
 */
export function figmaResponseToScreens(
  response: FigmaNodesResponse,
  opts: FigmaImportOptions = {},
): {
  screens: { id: string; name: string; role: string; nodes: IRChild[] }[];
  warnings: string[];
  name: string;
  /** The first screen's root frame dimensions (the Figma frame's real size).
   *  Callers thread this into format_config.frame so the canvas renders the
   *  design at its true size with no phone chrome. */
  frame?: { w: number; h: number };
} {
  const images = opts.images ?? {};
  const warnings: string[] = [];
  let frame: { w: number; h: number } | undefined;
  const screens = Object.values(response.nodes).map((entry) => {
    const doc = entry.document;
    // The top-level frame defines the canvas origin (0,0). Pass the frame's OWN
    // absolute rect as the parent so it positions itself at (0,0) — relative to
    // its own origin — while its children remain relative to the frame. Without
    // this, a frame sitting at e.g. (4762,5104) on Figma's infinite canvas would
    // be placed off the .screen container and everything would clip to blank.
    const rootRect = nodeRect(doc);
    const rootParent = rootRect ? { x: rootRect.x, y: rootRect.y } : null;
    if (rootRect && !frame) frame = { w: rootRect.w, h: rootRect.h };
    const children = figmaNodeToIr(doc, rootParent, images, warnings);
    return {
      id: doc.id.replace(/[^a-zA-Z0-9]/g, "-"),
      name: doc.name,
      role: "imported",
      nodes: children ? [children] : [],
    };
  });
  return { screens: screens.filter((s) => s.nodes.length), warnings, name: response.name, frame };
}

/** Convenience: convert straight to IRChild[] for a single Figma node tree
 * (used by tests and the standalone converter API). */
export function figmaNodeToIrChildren(
  node: FigmaNode,
  opts: FigmaImportOptions = {},
): { children: IRChild[]; warnings: string[] } {
  const warnings: string[] = [];
  const ir = figmaNodeToIr(node, null, opts.images ?? {}, warnings);
  return { children: ir ? [ir] : [], warnings };
}

export type { FigmaImagesResponse, FigmaNodesResponse };
