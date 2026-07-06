/**
 * sleek.figma-nodes — the versioned node JSON our Figma plugin consumes.
 * Deliberately Figma-shaped but plugin-agnostic: geometry is resolved
 * absolute-per-parent, colors are 0..1 RGBA, gradients carry angle+stops
 * (the plugin computes gradientTransform), images carry URLs/data-URIs
 * (the plugin fetches bytes in its UI thread).
 */

export type RGBA = { r: number; g: number; b: number; a: number };

export type FillSpec =
  | { type: "SOLID"; color: RGBA }
  | {
      type: "GRADIENT_LINEAR";
      angleDeg: number;
      stops: { position: number; color: RGBA }[];
    }
  | { type: "IMAGE"; url: string; scaleMode: "FILL" | "FIT" | "TILE" };

export type StrokeSpec = {
  color: RGBA;
  weights: { top: number; right: number; bottom: number; left: number };
  dashed: boolean;
};

export type EffectSpec =
  | { type: "DROP_SHADOW" | "INNER_SHADOW"; color: RGBA; offset: { x: number; y: number }; radius: number; spread: number }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number };

export type AutoLayoutSpec = {
  mode: "HORIZONTAL" | "VERTICAL";
  itemSpacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  primaryAxisAlignItems: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems: "MIN" | "CENTER" | "MAX";
  wrap: boolean;
};

export type TextRangeSpec = {
  start: number;
  end: number;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  color?: RGBA;
  letterSpacing?: number;
  textDecoration?: "UNDERLINE" | "STRIKETHROUGH";
};

type BaseNode = {
  /** data-mae-id — layer identity across roundtrips. */
  id: string;
  name: string;
  /** Position relative to the parent node. */
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  cornerRadius?: { tl: number; tr: number; br: number; bl: number };
  fills?: FillSpec[];
  stroke?: StrokeSpec;
  effects?: EffectSpec[];
  visible?: boolean;
};

export type FrameNodeSpec = BaseNode & {
  type: "FRAME";
  clipsContent: boolean;
  layout?: AutoLayoutSpec;
  children: FigmaNodeSpec[];
};

export type RectangleNodeSpec = BaseNode & { type: "RECTANGLE" };
export type EllipseNodeSpec = BaseNode & { type: "ELLIPSE" };

export type TextNodeSpec = BaseNode & {
  type: "TEXT";
  characters: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  lineHeightPx?: number;
  letterSpacing: number;
  textAlign: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  color: RGBA;
  ranges?: TextRangeSpec[];
};

export type SvgNodeSpec = BaseNode & { type: "SVG"; svg: string };

export type FigmaNodeSpec =
  | FrameNodeSpec
  | RectangleNodeSpec
  | EllipseNodeSpec
  | TextNodeSpec
  | SvgNodeSpec;

export type FigmaExportDocument = {
  schema: "sleek.figma-nodes";
  version: 1;
  name: string;
  frames: (FrameNodeSpec & { screenId: string; screenName: string })[];
  warnings: string[];
};
