/**
 * Figma REST API node shapes — a typed subset of what
 *   GET https://api.figma.com/v1/files/:key/nodes?ids=…
 * returns. Only the fields the importer reads; unknown fields are passed
 * through untouched.
 *
 * Reference: https://www.figma.com/developers/api#files-endpoints
 *
 * Color values are 0..1 floats (Figma's wire format); the importer converts
 * them to CSS rgb()/rgba() strings at the conversion boundary, so the IR
 * never carries Figma-native values.
 */

export type FigmaRGBA = { r: number; g: number; b: number; a: number };

export type FigmaColorStop = { position: number; color: FigmaRGBA };

export type FigmaPaint =
  | { type: "SOLID"; color: FigmaRGBA; visible?: boolean; opacity?: number }
  | {
      type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR";
      gradientStops: FigmaColorStop[];
      gradientTransform: [[number, number, number], [number, number, number]];
      visible?: boolean;
      opacity?: number;
    }
  | { type: "IMAGE"; scaleMode: "FILL" | "FIT" | "CROP" | "TILE"; imageRef?: string; visible?: boolean; opacity?: number };

export type FigmaIndividualStrokeWeights = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type FigmaEffect =
  | {
      type: "DROP_SHADOW" | "INNER_SHADOW";
      color: FigmaRGBA;
      offset: { x: number; y: number };
      radius: number;
      spread: number;
      visible?: boolean;
    }
  | { type: "LAYER_BLUR" | "BACKGROUND_BLUR"; radius: number; visible?: boolean };

export type FigmaTypeStyle = {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
  textDecoration?: "NONE" | "STRIKETHROUGH" | "UNDERLINE";
  fills?: FigmaPaint[];
};

export type FigmaRect = { x: number; y: number; width: number; height: number };

export type FigmaNodeBase = {
  id: string;
  name: string;
  /**
   * NOTE: Figma's /nodes endpoint does NOT populate the top-level x/y/width/
   * height fields — those come back null. Geometry lives in
   * `absoluteBoundingBox` (absolute page coordinates). The importer reads from
   * there and converts to parent-relative coords.
   */
  x?: number | null;
  y?: number | null;
  width?: number | null;
  height?: number | null;
  /** Absolute page-coords rect — the actual source of geometry. */
  absoluteBoundingBox?: FigmaRect | null;
  /** Absolute render bounds (clip-aware); preferred when present. */
  absoluteRenderBounds?: FigmaRect | null;
  visible?: boolean;
  opacity?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  individualStrokeWeights?: FigmaIndividualStrokeWeights;
  cornerRadius?: number;
  /** [topLeft, topRight, bottomRight, bottomLeft] when per-corner. */
  rectangleCornerRadii?: [number, number, number, number];
  effects?: FigmaEffect[];
  clipsContent?: boolean;
  blendMode?: string;
};

export type FigmaFrameNode = FigmaNodeBase & {
  type: "FRAME" | "GROUP" | "COMPONENT" | "COMPONENT_SET" | "INSTANCE";
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  children?: FigmaNode[];
};

export type FigmaRectangleNode = FigmaNodeBase & { type: "RECTANGLE" };
export type FigmaEllipseNode = FigmaNodeBase & { type: "ELLIPSE" };
export type FigmaVectorNode = FigmaNodeBase & { type: "VECTOR" | "LINE" | "STAR" | "POLYGON" | "BOOLEAN_OPERATION" | "REGULAR_POLYGON" };

export type FigmaTextNode = FigmaNodeBase & {
  type: "TEXT";
  characters: string;
  style?: FigmaTypeStyle;
  /** Per-character indices into styleOverrideTable; length === characters.length. */
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
};

export type FigmaNode =
  | FigmaFrameNode
  | FigmaRectangleNode
  | FigmaEllipseNode
  | FigmaVectorNode
  | FigmaTextNode;

/** Single node entry from GET /v1/files/:key/nodes. */
export type FigmaNodesResponse = {
  name: string;
  lastModified: string;
  version: string;
  nodes: Record<string, { document: FigmaNode }>;
};

/** GET /v1/images/:key — rasterizes nodes to PNG/SVG URLs. */
export type FigmaImagesResponse = {
  images: Record<string, string | null>;
};

/** GET /v1/files/:key/images — resolves image fill imageRefs to URLs. */
export type FigmaFileImagesResponse = {
  meta: { images: Record<string, string> };
};

/**
 * Parse a Figma share URL into { fileKey, nodeId }.
 *
 *   https://www.figma.com/design/<KEY>/<title>?node-id=<id>
 *   https://www.figma.com/file/<KEY>/<title>?node-id=<id>
 *
 * node-id may be encoded as "1:2" or "1-2"; we normalize to Figma's wire
 * format "1:2" (used both by the nodes endpoint and the images endpoint).
 */
export function parseFigmaUrl(
  url: string,
): { fileKey: string; nodeId: string } | null {
  const m = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/i);
  if (!m) return null;
  const fileKey = m[1];
  const idParam = new URL(url, "https://x.test").searchParams.get("node-id");
  if (!idParam) return null;
  // URL form uses "-" (e.g. "1-2"); wire form uses ":".
  const nodeId = idParam.includes("-") ? idParam.replace(/-/g, ":") : idParam;
  return { fileKey, nodeId };
}
