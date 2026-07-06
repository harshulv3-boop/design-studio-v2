import type { IRChild, IRNode, StyleDecl } from "../../schema";
import { isElement, isText } from "../../schema";
import { getDom } from "../../core/dom";
import { HTML_ATTR_TO_PROP, SVG_ATTR_TO_PROP, SVG_PASSTHROUGH } from "./attr-map";

/**
 * IR → real JSX markup. Zero-drift contract: rendering the emitted JSX with
 * react-dom/server renderToStaticMarkup must be DOM-equal to the source
 * screen HTML (unit-tested per fixture).
 *
 * Traps handled here:
 *  - class→className etc. via vendored attr table; data- and aria- verbatim.
 *  - inline styles → style objects; custom properties keep string keys.
 *  - !important cannot live in a style object → hoisted to a companion CSS
 *    rule [data-mae-id="…"] { … !important } returned as `hoistedCss`.
 *  - controlled-input traps: value→defaultValue, checked→defaultChecked,
 *    <option selected> → defaultValue on the enclosing <select>.
 *  - text nodes: emitted raw only when JSX-inert; otherwise as {"…"} string
 *    expressions, preserving exact whitespace and metacharacters.
 *  - <svg> subtrees (atomic in IR) are re-parsed and emitted as real JSX with
 *    SVG attribute casing.
 *  - <style> children become <style>{`…`}</style> with template escaping.
 */

export type JsxResult = {
  jsx: string;
  /** CSS rules hoisted out of style objects (currently: !important decls). */
  hoistedCss: string;
};

/**
 * JSX attribute emitter. JSX string attribute values are HTML-like: they do
 * NOT process backslash escapes, and they DO decode HTML entities. Values
 * containing quotes, ampersands, backslashes or newlines therefore use the
 * expression form attr={"…"} where JS string escaping is well-defined.
 */
function jsxAttr(name: string, value: string): string {
  if (/^[^"&\\\n{}]*$/.test(value)) return `${name}="${value}"`;
  return `${name}={${JSON.stringify(value)}}`;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export async function irChildrenToJsx(children: IRChild[], indent = "      "): Promise<JsxResult> {
  const hoisted: string[] = [];
  const dom = await getDom();
  const parseSvg = (inner: string): Element => dom.parseFragment(inner);
  const jsx = children
    .map((child) => childToJsx(child, indent, hoisted, parseSvg))
    .filter((s) => s !== null)
    .join("\n");
  return { jsx, hoistedCss: hoisted.join("\n") };
}

function childToJsx(
  child: IRChild,
  indent: string,
  hoisted: string[],
  parseSvg: (inner: string) => Element,
): string | null {
  if (isText(child)) return textToJsx(child.value, indent);
  if (!isElement(child)) return `${indent}{/* ${child.value.replace(/\*\//g, "*​/")} */}`;
  return elementToJsx(child, indent, hoisted, parseSvg);
}

function textToJsx(value: string, indent: string): string | null {
  if (!value) return null;
  // Whitespace-only text is layout-relevant in inline contexts (space between
  // inline elements) — JSX would drop it, so emit it as an exact string
  // expression. Zero drift beats prettiness here.
  if (!value.trim()) {
    return `${indent}{${JSON.stringify(value)}}`;
  }
  // Raw text is safe only when JSX-inert: no braces/tags/entities-sensitive
  // chars, single-line, no leading/trailing or doubled whitespace.
  const inert = /^[^{}<>&\n]+$/.test(value) && value === value.trim() && !/\s{2,}/.test(value);
  return inert ? `${indent}${value}` : `${indent}{${JSON.stringify(value)}}`;
}

function elementToJsx(
  node: IRNode,
  indent: string,
  hoisted: string[],
  parseSvg: (inner: string) => Element,
): string {
  const inSvg = node.tag === "svg";
  const props: string[] = [jsxAttr("data-mae-id", node.id)];

  // <option selected> children → defaultValue on this select.
  let selectDefault: string | null = null;
  if (node.tag === "select") {
    selectDefault = findSelectedOptionValue(node);
  }

  for (const [name, rawValue] of Object.entries(node.attrs)) {
    const prop = mapAttr(name, node.tag, inSvg);
    if (!prop) continue;
    if (node.tag === "option" && name === "selected") continue; // handled on <select>
    if (prop.boolean) props.push(prop.name);
    else props.push(jsxAttr(prop.name, rawValue));
  }
  if (selectDefault != null) props.push(jsxAttr("defaultValue", selectDefault));
  if (node.classes.length) props.push(jsxAttr("className", node.classes.join(" ")));
  if (node.styleDecls.length) {
    const { styleObject, importantDecls } = splitStyle(node.styleDecls);
    if (styleObject) props.push(`style={${styleObject}}`);
    if (importantDecls.length) {
      hoisted.push(
        `[data-mae-id="${node.id}"] { ${importantDecls
          .map(([p, v]) => `${p}: ${v} !important;`)
          .join(" ")} }`,
      );
    }
  }

  const open = `<${node.tag}${props.length ? " " + props.join(" ") : ""}`;

  if (VOID_TAGS.has(node.tag)) return `${indent}${open} />`;

  if (node.tag === "svg" && node.svgInner != null) {
    const svgChildren = svgInnerToJsx(node.svgInner, indent + "  ", parseSvg);
    return svgChildren
      ? `${indent}${open}>\n${svgChildren}\n${indent}</${node.tag}>`
      : `${indent}${open} />`;
  }

  if (node.tag === "style") {
    const css = node.children.map((c) => (isText(c) ? c.value : "")).join("");
    return `${indent}${open}>{${templateLiteral(css)}}</style>`;
  }

  if (!node.children.length) return `${indent}${open} />`;

  const inner = node.children
    .map((child) => childToJsx(child, indent + "  ", hoisted, parseSvg))
    .filter((s) => s !== null)
    .join("\n");
  if (!inner) return `${indent}${open} />`;
  return `${indent}${open}>\n${inner}\n${indent}</${node.tag}>`;
}

function mapAttr(
  name: string,
  tag: string,
  inSvg: boolean,
): { name: string; boolean?: boolean } | null {
  const lower = name.toLowerCase();
  if (lower.startsWith("data-") || lower.startsWith("aria-")) return { name };
  if (lower.startsWith("on")) return null; // event handler attrs never survive sanitize anyway

  // Controlled-input traps: keep SSR output identical without freezing inputs.
  if (tag === "input" && lower === "value") return { name: "defaultValue" };
  if (tag === "input" && lower === "checked") return { name: "defaultChecked", boolean: true };
  if (tag === "textarea" && lower === "value") return { name: "defaultValue" };

  if (inSvg && SVG_ATTR_TO_PROP[name]) return { name: SVG_ATTR_TO_PROP[name] };
  if (inSvg && SVG_PASSTHROUGH.has(name)) return { name };
  if (HTML_ATTR_TO_PROP[lower]) return { name: HTML_ATTR_TO_PROP[lower] };
  // Unknown attributes pass through verbatim (React ≥16 renders them).
  return { name };
}

function findSelectedOptionValue(select: IRNode): string | null {
  for (const child of select.children) {
    if (!isElement(child) || child.tag !== "option") continue;
    if ("selected" in child.attrs) {
      const explicit = child.attrs["value"];
      if (explicit != null) return explicit;
      return child.children
        .filter(isText)
        .map((t) => t.value)
        .join("")
        .trim();
    }
  }
  return null;
}

function splitStyle(decls: StyleDecl[]): {
  styleObject: string | null;
  importantDecls: StyleDecl[];
} {
  const normal = decls.filter(([, , important]) => !important);
  const importantDecls = decls.filter(([, , important]) => important);
  if (!normal.length) return { styleObject: null, importantDecls };
  const entries = normal.map(([prop, value]) => {
    const key = prop.startsWith("--") ? JSON.stringify(prop) : camelCaseProp(prop);
    return `${key}: ${JSON.stringify(value)}`;
  });
  return { styleObject: `{ ${entries.join(", ")} }`, importantDecls };
}

function camelCaseProp(prop: string): string {
  // -webkit-x → WebkitX (React keeps the leading cap for vendor prefixes,
  // except -ms- which maps to lowercase ms).
  const camel = prop.toLowerCase().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  if (prop.startsWith("-ms-")) return camel.replace(/^Ms/, "ms");
  if (prop.startsWith("-")) return camel.charAt(0).toUpperCase() + camel.slice(1);
  return camel;
}

function templateLiteral(value: string): string {
  return "`" + value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
}

/** Parse atomic svg innerHTML and emit as JSX with SVG casing. */
function svgInnerToJsx(
  inner: string,
  indent: string,
  parseSvg: (inner: string) => Element,
): string {
  const root = parseSvg(`<svg>${inner}</svg>`);
  const svg = root.firstElementChild;
  if (!svg) return "";
  const lines: string[] = [];
  svg.childNodes.forEach((node) => {
    const line = svgDomToJsx(node, indent);
    if (line) lines.push(line);
  });
  return lines.join("\n");
}

function svgDomToJsx(node: Node, indent: string): string | null {
  if (node.nodeType === 3) return textToJsx(node.nodeValue ?? "", indent);
  if (node.nodeType !== 1) return null;
  const el = node as Element;
  const realTag = svgTagCase(el.tagName);
  const props: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const mapped =
      SVG_ATTR_TO_PROP[attr.name] || (SVG_PASSTHROUGH.has(attr.name) ? attr.name : null);
    const name =
      mapped ??
      (attr.name.startsWith("data-") || attr.name.startsWith("aria-")
        ? attr.name
        : HTML_ATTR_TO_PROP[attr.name.toLowerCase()] || attr.name);
    props.push(jsxAttr(name, attr.value));
  }
  const open = `<${realTag}${props.length ? " " + props.join(" ") : ""}`;
  const children: string[] = [];
  el.childNodes.forEach((child) => {
    const line = svgDomToJsx(child, indent + "  ");
    if (line) children.push(line);
  });
  if (!children.length) return `${indent}${open} />`;
  return `${indent}${open}>\n${children.join("\n")}\n${indent}</${realTag}>`;
}

// HTML parsers lowercase SVG camelCase tags in some backends; restore the
// canonical SVG element casing so React recognizes them.
const SVG_TAG_CASE: Record<string, string> = {
  altglyph: "altGlyph",
  altglyphdef: "altGlyphDef",
  altglyphitem: "altGlyphItem",
  animatecolor: "animateColor",
  animatemotion: "animateMotion",
  animatetransform: "animateTransform",
  clippath: "clipPath",
  feblend: "feBlend",
  fecolormatrix: "feColorMatrix",
  fecomponenttransfer: "feComponentTransfer",
  fecomposite: "feComposite",
  feconvolvematrix: "feConvolveMatrix",
  fediffuselighting: "feDiffuseLighting",
  fedisplacementmap: "feDisplacementMap",
  fedistantlight: "feDistantLight",
  fedropshadow: "feDropShadow",
  feflood: "feFlood",
  fefunca: "feFuncA",
  fefuncb: "feFuncB",
  fefuncg: "feFuncG",
  fefuncr: "feFuncR",
  fegaussianblur: "feGaussianBlur",
  feimage: "feImage",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  femorphology: "feMorphology",
  feoffset: "feOffset",
  fepointlight: "fePointLight",
  fespecularlighting: "feSpecularLighting",
  fespotlight: "feSpotLight",
  fetile: "feTile",
  feturbulence: "feTurbulence",
  foreignobject: "foreignObject",
  glyphref: "glyphRef",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  textpath: "textPath",
};

function svgTagCase(tagName: string): string {
  const lower = tagName.toLowerCase();
  return SVG_TAG_CASE[lower] || lower;
}
