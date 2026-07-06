import { z } from "zod";

/**
 * Intermediate Representation (IR) — the single conversion layer between the
 * canvas's HTML truth and every external format (HTML / React / Vue / Angular /
 * Figma / Flutter).
 *
 * HARD RULE: the IR exists only at the import/export boundary. It is built on
 * demand from Project HTML and discarded after conversion. It is never stored
 * in zustand, localStorage, or any persisted payload — the canvas HTML remains
 * the only live source of truth.
 *
 * Losslessness strategy: the IR is DOM-faithful. Every attribute (including
 * all data-mae-* / data-nav-* editor conventions) is kept verbatim in `attrs`;
 * inline styles are kept as an ordered declaration list preserving unknown
 * properties, order, case and !important. Typed views needed by narrow targets
 * (Figma, Flutter) are DERIVED by pure functions (typed-style.ts, attrs.ts),
 * never stored, so the IR cannot grow a second style truth.
 */

export const IR_VERSION = 1 as const;

/** One inline-style declaration: [property, value, important]. Order matters. */
export const StyleDeclSchema = z.tuple([z.string(), z.string(), z.boolean()]);
export type StyleDecl = z.infer<typeof StyleDeclSchema>;

export const IRTextSchema = z.object({
  kind: z.literal("text"),
  /** Decoded text content, verbatim including whitespace-only nodes. */
  value: z.string(),
});
export type IRText = z.infer<typeof IRTextSchema>;

export const IRCommentSchema = z.object({
  kind: z.literal("comment"),
  value: z.string(),
});
export type IRComment = z.infer<typeof IRCommentSchema>;

/** Resolved geometry/computed style, populated only by the resolve pass and
 * consumed only by design targets (Figma/Flutter). Never serialized to HTML. */
export const ResolvedSchema = z.object({
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  computed: z.record(z.string(), z.string()),
  imageNatural: z.object({ w: z.number(), h: z.number() }).optional(),
});
export type Resolved = z.infer<typeof ResolvedSchema>;

export type IRNode = {
  kind: "element";
  /** data-mae-id — stable element identity across every conversion. */
  id: string;
  /** Exact HTML tag, lowercase. The fidelity anchor for code targets. */
  tag: string;
  /** Derived layer name (naming.ts port of classifyElement/defaultName). */
  name: string;
  /**
   * Every attribute verbatim EXCEPT: style (→ styleDecls), class (→ classes),
   * data-mae-id (→ id). Includes all other data-mae-… and data-nav-… attrs;
   * typed accessors live in core/attrs.ts.
   */
  attrs: Record<string, string>;
  classes: string[];
  /** Ordered, lossless parse of the inline style attribute. */
  styleDecls: StyleDecl[];
  /**
   * For <svg> only: innerHTML verbatim. SVG children are atomic in the editor
   * (no mae-ids); the root svg element itself still has attrs/styleDecls.
   */
  svgInner?: string;
  children: IRChild[];
  resolved?: Resolved;
};
export type IRChild = IRNode | IRText | IRComment;

export const IRNodeSchema: z.ZodType<IRNode> = z.lazy(() =>
  z.object({
    kind: z.literal("element"),
    id: z.string(),
    tag: z.string(),
    name: z.string(),
    attrs: z.record(z.string(), z.string()),
    classes: z.array(z.string()),
    styleDecls: z.array(StyleDeclSchema),
    svgInner: z.string().optional(),
    children: z.array(z.union([IRNodeSchema, IRTextSchema, IRCommentSchema])),
    resolved: ResolvedSchema.optional(),
  }),
);

export const IRScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  /**
   * Top-level children of the screen's HTML fragment, order-preserving.
   * (Website screens have a single `.screen` wrapper element; app screens may
   * be bare fragments — the IR does not invent wrappers.)
   */
  nodes: z.array(z.union([IRNodeSchema, IRTextSchema, IRCommentSchema])),
});
export type IRScreen = z.infer<typeof IRScreenSchema>;

export const IRStylesheetSchema = z.object({
  /** designSystemCss VERBATIM — ground truth, emitted unchanged by code targets. */
  raw: z.string(),
  /** Advisory parse (css-tree): custom properties from :root/.screen blocks. */
  variables: z.record(z.string(), z.string()),
  /** Advisory: font families referenced by @font-face/@import. */
  fonts: z.array(
    z.object({ family: z.string(), weights: z.array(z.string()), src: z.string().optional() }),
  ),
});
export type IRStylesheet = z.infer<typeof IRStylesheetSchema>;

export const IRAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(["data-uri", "url"]),
  value: z.string(),
  mime: z.string().optional(),
});
export type IRAsset = z.infer<typeof IRAssetSchema>;

export const IRDocumentSchema = z.object({
  version: z.literal(IR_VERSION),
  meta: z.object({
    name: z.string(),
    sourceFormat: z.enum(["canvas", "html", "react", "vue", "angular", "figma", "flutter", "repo"]),
    artifactType: z.enum(["app", "website", "figma"]),
    frame: z.object({ w: z.number(), h: z.number().optional() }),
  }),
  screens: z.array(IRScreenSchema),
  stylesheet: IRStylesheetSchema,
  assets: z.array(IRAssetSchema),
});
export type IRDocument = z.infer<typeof IRDocumentSchema>;

export function isElement(child: IRChild): child is IRNode {
  return (child as IRNode).kind === "element";
}
export function isText(child: IRChild): child is IRText {
  return (child as IRText).kind === "text";
}
