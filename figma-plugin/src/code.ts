/// <reference types="@figma/plugin-typings" />

/**
 * sleek.design import — plugin main thread.
 * Receives a sleek.figma-nodes document (+ pre-fetched image bytes) from the
 * UI, loads every needed font (with weight-aware fallbacks), then builds real
 * Figma layers. Substitutions/skips are reported back to the UI.
 */

/** Spec color (8-bit RGBA). Renamed from RGBA to avoid collision with Figma's
 * global RGB-based RGBA type (which carries alpha on the paint, not the color). */
type RGBA8 = { r: number; g: number; b: number; a: number };
type FillSpec =
  | { type: "SOLID"; color: RGBA8 }
  | { type: "GRADIENT_LINEAR"; angleDeg: number; stops: { position: number; color: RGBA8 }[] }
  | { type: "IMAGE"; url: string; scaleMode: "FILL" | "FIT" | "Tile" };
type StrokeSpec = {
  color: RGBA8;
  weights: { top: number; right: number; bottom: number; left: number };
  dashed: boolean;
};
type EffectSpec =
  | { type: "DROP_SHADOW" | "INNER_SHADOW"; color: RGBA8; offset: { x: number; y: number }; radius: number; spread: number }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number };
type AutoLayoutSpec = {
  mode: "HORIZONTAL" | "VERTICAL";
  itemSpacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX";
};
type TextRangeSpec = {
  start: number;
  end: number;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  letterSpacing?: number;
  textDecoration?: "UNDERLINE" | "STRIKETHROUGH";
  color?: RGBA8;
};
type NodeSpec = {
  id: string;
  name: string;
  type: "FRAME" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "SVG";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  cornerRadius?: { tl: number; tr: number; br: number; bl: number };
  fills?: FillSpec[];
  stroke?: StrokeSpec;
  effects?: EffectSpec[];
  layout?: AutoLayoutSpec;
  clipsContent?: boolean;
  children?: NodeSpec[];
  characters?: string;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlign?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  color?: RGBA8;
  ranges?: TextRangeSpec[];
  svg?: string;
};
type ExportDoc = {
  schema: "sleek.figma-nodes";
  version: 1;
  name: string;
  frames: (NodeSpec & { screenId: string; screenName: string })[];
  warnings: string[];
};

figma.showUI(__html__, { width: 380, height: 420 });

const WEIGHT_STYLES: Record<number, string[]> = {
  100: ["Thin", "Hairline"],
  200: ["ExtraLight", "Extra Light", "UltraLight"],
  300: ["Light"],
  400: ["Regular", "Normal", "Book"],
  500: ["Medium"],
  600: ["SemiBold", "Semi Bold", "Demibold", "DemiBold"],
  700: ["Bold"],
  800: ["ExtraBold", "Extra Bold", "UltraBold"],
  900: ["Black", "Heavy"],
};

const loadedFonts = new Map<string, FontName>();
let availableFonts: Font[] | null = null;
const substitutions = new Set<string>();

async function resolveFont(family: string, weight: number): Promise<FontName> {
  const key = `${family}#${weight}`;
  const cached = loadedFonts.get(key);
  if (cached) return cached;

  const styles = WEIGHT_STYLES[Math.round(weight / 100) * 100] ?? ["Regular"];
  const candidates: FontName[] = styles.map((style) => ({ family, style }));
  for (const candidate of candidates) {
    try {
      await figma.loadFontAsync(candidate);
      loadedFonts.set(key, candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }

  if (!availableFonts) availableFonts = await figma.listAvailableFontsAsync();
  const sameFamily = availableFonts.filter((f) => f.fontName.family === family);
  if (sameFamily.length) {
    // Closest weight by style-name lookup order.
    const ordered = Object.entries(WEIGHT_STYLES).sort(
      (a, b) => Math.abs(Number(a[0]) - weight) - Math.abs(Number(b[0]) - weight),
    );
    for (const [, names] of ordered) {
      const hit = sameFamily.find((f) => names.includes(f.fontName.style));
      if (hit) {
        await figma.loadFontAsync(hit.fontName);
        substitutions.add(`${family} ${weight} → ${hit.fontName.family} ${hit.fontName.style}`);
        loadedFonts.set(key, hit.fontName);
        return hit.fontName;
      }
    }
    await figma.loadFontAsync(sameFamily[0].fontName);
    substitutions.add(`${family} ${weight} → ${sameFamily[0].fontName.style}`);
    loadedFonts.set(key, sameFamily[0].fontName);
    return sameFamily[0].fontName;
  }

  const fallback: FontName = { family: "Inter", style: "Regular" };
  await figma.loadFontAsync(fallback);
  substitutions.add(`${family} ${weight} → Inter Regular (family unavailable)`);
  loadedFonts.set(key, fallback);
  return fallback;
}

function rgb(c: RGBA8): RGB {
  return { r: c.r, g: c.g, b: c.b };
}

function gradientTransform(angleDeg: number): Transform {
  const r = ((angleDeg - 90) * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [
    [cos, sin, 0.5 - 0.5 * cos - 0.5 * sin],
    [-sin, cos, 0.5 + 0.5 * sin - 0.5 * cos],
  ];
}

function toPaints(fills: FillSpec[] | undefined, images: Map<string, Uint8Array>): Paint[] {
  if (!fills) return [];
  const paints: Paint[] = [];
  for (const fill of fills) {
    if (fill.type === "SOLID") {
      paints.push({ type: "SOLID", color: rgb(fill.color), opacity: fill.color.a });
    } else if (fill.type === "GRADIENT_LINEAR") {
      paints.push({
        type: "GRADIENT_LINEAR",
        gradientTransform: gradientTransform(fill.angleDeg),
        gradientStops: fill.stops.map((s) => ({
          position: s.position,
          color: { ...rgb(s.color), a: s.color.a },
        })),
      });
    } else if (fill.type === "IMAGE") {
      const bytes = images.get(fill.url);
      if (bytes) {
        const image = figma.createImage(bytes);
        // Studio IR uses "Tile" (mixed case); Figma's PaintScaleMode is "TILE".
        const scaleMode = fill.scaleMode === "Tile" ? "TILE" : fill.scaleMode;
        paints.push({ type: "IMAGE", imageHash: image.hash, scaleMode });
      }
    }
  }
  return paints;
}

function toEffects(effects: EffectSpec[] | undefined): Effect[] {
  if (!effects) return [];
  return effects.map((fx): Effect => {
    if (fx.type === "DROP_SHADOW" || fx.type === "INNER_SHADOW") {
      return {
        type: fx.type,
        color: { ...rgb(fx.color), a: fx.color.a },
        offset: fx.offset,
        radius: fx.radius,
        spread: fx.spread,
        visible: true,
        blendMode: "NORMAL",
      } as Effect;
    }
    // LAYER_BLUR | BACKGROUND_BLUR
    return { type: fx.type, radius: fx.radius, visible: true } as Effect;
  });
}

function applyBox(
  node: FrameNode | RectangleNode | EllipseNode | TextNode,
  spec: NodeSpec,
  images: Map<string, Uint8Array>,
): void {
  node.name = spec.name;
  node.x = spec.x;
  node.y = spec.y;
  if (spec.opacity != null) node.opacity = spec.opacity;
  if (spec.type !== "TEXT") {
    node.fills = toPaints(spec.fills, images);
  }
  if (spec.cornerRadius && "topLeftRadius" in node) {
    node.topLeftRadius = spec.cornerRadius.tl;
    node.topRightRadius = spec.cornerRadius.tr;
    node.bottomRightRadius = spec.cornerRadius.br;
    node.bottomLeftRadius = spec.cornerRadius.bl;
  }
  if (spec.stroke && "strokes" in node) {
    node.strokes = [{ type: "SOLID", color: rgb(spec.stroke.color), opacity: spec.stroke.color.a }];
    node.strokeAlign = "INSIDE";
    if (spec.stroke.dashed && "dashPattern" in node) node.dashPattern = [4, 4];
    const w = spec.stroke.weights;
    if ("strokeTopWeight" in node) {
      node.strokeTopWeight = w.top;
      node.strokeRightWeight = w.right;
      node.strokeBottomWeight = w.bottom;
      node.strokeLeftWeight = w.left;
    } else {
      node.strokeWeight = Math.max(w.top, w.right, w.bottom, w.left);
    }
  }
  node.effects = toEffects(spec.effects);
}

async function buildText(spec: NodeSpec, images: Map<string, Uint8Array>): Promise<TextNode> {
  const text = figma.createText();
  const font = await resolveFont(spec.fontFamily || "Inter", spec.fontWeight || 400);
  text.fontName = font;
  text.characters = spec.characters ?? "";
  text.fontSize = spec.fontSize || 16;
  if (spec.lineHeightPx) text.lineHeight = { value: spec.lineHeightPx, unit: "PIXELS" };
  text.letterSpacing = { value: spec.letterSpacing ?? 0, unit: "PIXELS" };
  text.textAlignHorizontal = spec.textAlign ?? "LEFT";
  if (spec.color) text.fills = [{ type: "SOLID", color: rgb(spec.color), opacity: spec.color.a }];
  text.textAutoResize = "NONE";
  text.resize(Math.max(spec.width, 1), Math.max(spec.height, 1));
  applyBox(text, spec, images);

  for (const range of spec.ranges ?? []) {
    if (range.end <= range.start || range.end > text.characters.length) continue;
    if (range.fontFamily || range.fontWeight) {
      const rangeFont = await resolveFont(
        range.fontFamily || spec.fontFamily || "Inter",
        range.fontWeight || spec.fontWeight || 400,
      );
      text.setRangeFontName(range.start, range.end, rangeFont);
    }
    if (range.fontSize) text.setRangeFontSize(range.start, range.end, range.fontSize);
    if (range.color) {
      text.setRangeFills(range.start, range.end, [
        { type: "SOLID", color: rgb(range.color), opacity: range.color.a },
      ]);
    }
    if (range.letterSpacing != null) {
      text.setRangeLetterSpacing(range.start, range.end, { value: range.letterSpacing, unit: "PIXELS" });
    }
    if (range.textDecoration) text.setRangeTextDecoration(range.start, range.end, range.textDecoration);
  }
  return text;
}

async function buildNode(spec: NodeSpec, images: Map<string, Uint8Array>): Promise<SceneNode | null> {
  switch (spec.type) {
    case "TEXT":
      return buildText(spec, images);
    case "RECTANGLE": {
      const rect = figma.createRectangle();
      rect.resize(Math.max(spec.width, 0.01), Math.max(spec.height, 0.01));
      applyBox(rect, spec, images);
      return rect;
    }
    case "ELLIPSE": {
      const ellipse = figma.createEllipse();
      ellipse.resize(Math.max(spec.width, 0.01), Math.max(spec.height, 0.01));
      applyBox(ellipse, spec, images);
      return ellipse;
    }
    case "SVG": {
      try {
        const node = figma.createNodeFromSvg(spec.svg ?? "<svg/>");
        node.name = spec.name;
        node.x = spec.x;
        node.y = spec.y;
        node.resize(Math.max(spec.width, 0.01), Math.max(spec.height, 0.01));
        return node;
      } catch {
        substitutions.add(`SVG "${spec.name}" could not be parsed — skipped.`);
        return null;
      }
    }
    case "FRAME": {
      const frame = figma.createFrame();
      frame.resize(Math.max(spec.width, 0.01), Math.max(spec.height, 0.01));
      applyBox(frame, spec, images);
      frame.clipsContent = spec.clipsContent ?? false;
      for (const child of spec.children ?? []) {
        const built = await buildNode(child, images);
        if (built) frame.appendChild(built);
      }
      if (spec.layout) {
        frame.layoutMode = spec.layout.mode;
        frame.primaryAxisSizingMode = "FIXED";
        frame.counterAxisSizingMode = "FIXED";
        frame.itemSpacing = spec.layout.itemSpacing;
        frame.paddingTop = spec.layout.padding.top;
        frame.paddingRight = spec.layout.padding.right;
        frame.paddingBottom = spec.layout.padding.bottom;
        frame.paddingLeft = spec.layout.padding.left;
        frame.primaryAxisAlignItems = spec.layout.primaryAxisAlignItems;
        frame.counterAxisAlignItems = spec.layout.counterAxisAlignItems;
      }
      return frame;
    }
    default:
      return null;
  }
}

figma.ui.onmessage = async (msg: {
  type: string;
  doc?: ExportDoc;
  images?: Record<string, number[]>;
}) => {
  if (msg.type !== "import" || !msg.doc) return;
  const doc = msg.doc;
  if (doc.schema !== "sleek.figma-nodes" || doc.version !== 1) {
    figma.ui.postMessage({ type: "error", message: "Not a sleek.figma-nodes v1 document." });
    return;
  }
  substitutions.clear();

  const images = new Map<string, Uint8Array>();
  for (const [url, bytes] of Object.entries(msg.images ?? {})) {
    images.set(url, new Uint8Array(bytes));
  }

  try {
    const container = figma.createFrame();
    container.name = doc.name || "sleek.design import";
    container.fills = [];
    container.clipsContent = false;

    let offsetX = 0;
    let maxH = 0;
    for (const frameSpec of doc.frames) {
      const built = await buildNode({ ...frameSpec, x: offsetX, y: 0 }, images);
      if (built) {
        container.appendChild(built);
        offsetX += frameSpec.width + 80;
        maxH = Math.max(maxH, frameSpec.height);
      }
    }
    container.resize(Math.max(offsetX - 80, 1), Math.max(maxH, 1));
    container.x = figma.viewport.center.x - container.width / 2;
    container.y = figma.viewport.center.y - container.height / 2;
    figma.currentPage.appendChild(container);
    figma.viewport.scrollAndZoomIntoView([container]);

    figma.ui.postMessage({
      type: "done",
      screens: doc.frames.length,
      warnings: [...doc.warnings, ...substitutions],
    });
  } catch (e) {
    figma.ui.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
