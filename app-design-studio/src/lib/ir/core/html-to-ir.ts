import type { IRChild, IRNode } from "../schema";
import { getDom } from "./dom";
import { parseInlineStyle } from "./inline-style";
import { defaultNodeName } from "./naming";

/**
 * Sanitized screen-HTML fragment → IR children.
 *
 * Input MUST already be canvas-canonical HTML (i.e. passed through
 * sanitizeHtml — the DOMPurify choke point in src/lib/pro/htmlUtils.js — and
 * ensureIds). The IR pipeline never re-sanitizes: the sanitizer is the single
 * normalization authority, keeping "zero drift" a measurable DOM-equality.
 *
 * ID handling mirrors ensureIds: elements missing data-mae-id get one
 * assigned; SVG subtrees are atomic (children captured verbatim as svgInner).
 */

let counter = 0;
/** Public so other format converters (e.g. figma import) can mint IRNode ids
 * that match the editor's id shape. */
export function uid(): string {
  counter += 1;
  return `mae-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

export async function htmlToIrChildren(html: string): Promise<IRChild[]> {
  const dom = await getDom();
  const root = dom.parseFragment(html || "");
  return childrenToIr(root);
}

function childrenToIr(parent: Element): IRChild[] {
  const out: IRChild[] = [];
  parent.childNodes.forEach((node) => {
    if (node.nodeType === TEXT_NODE) {
      out.push({ kind: "text", value: node.nodeValue ?? "" });
    } else if (node.nodeType === COMMENT_NODE) {
      out.push({ kind: "comment", value: node.nodeValue ?? "" });
    } else if (node.nodeType === ELEMENT_NODE) {
      out.push(elementToIr(node as Element));
    }
    // Other node types (CDATA, PI) cannot survive sanitizeHtml; ignore.
  });
  return out;
}

function elementToIr(el: Element): IRNode {
  const tag = el.tagName.toLowerCase();
  const attrs: Record<string, string> = {};
  let id = "";
  let classes: string[] = [];
  let styleDecls = parseInlineStyle(null);

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    const name = attr.name;
    if (name === "data-mae-id") id = attr.value;
    else if (name === "class") classes = attr.value.split(/\s+/).filter(Boolean);
    else if (name === "style") styleDecls = parseInlineStyle(attr.value);
    else attrs[name] = attr.value;
  }
  if (!id) id = uid();

  const node: IRNode = {
    kind: "element",
    id,
    tag,
    name: "",
    attrs,
    classes,
    styleDecls,
    children: [],
  };

  if (tag === "svg") {
    node.svgInner = el.innerHTML;
  } else {
    node.children = childrenToIr(el);
  }

  node.name = defaultNodeName(node);
  return node;
}
