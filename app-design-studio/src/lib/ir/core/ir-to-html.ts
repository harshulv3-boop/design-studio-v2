import type { IRChild, IRNode } from "../schema";
import { isElement, isText } from "../schema";
import { getDom } from "./dom";
import { serializeInlineStyle } from "./inline-style";

/**
 * IR children → canvas-ready HTML fragment.
 *
 * Serialization goes through a real DOM (createElement/setAttribute →
 * innerHTML) rather than string templating, so entity encoding, attribute
 * quoting and void-element handling are exactly what DOMParser/DOMPurify
 * produce — the roundtrip invariant domEqual(irToHtml(htmlToIr(h)),
 * sanitizeHtml(h)) holds by construction.
 *
 * `resolved` blocks are never serialized (they are resolve-pass data for
 * design targets only).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

export async function irChildrenToHtml(children: IRChild[]): Promise<string> {
  const dom = await getDom();
  const doc = dom.createDocument();
  const root = doc.createElement("div");
  appendChildren(doc, root, children);
  return root.innerHTML;
}

function appendChildren(doc: Document, parent: Element, children: IRChild[]): void {
  for (const child of children) {
    if (isText(child)) {
      parent.appendChild(doc.createTextNode(child.value));
    } else if (isElement(child)) {
      parent.appendChild(elementFromIr(doc, child));
    } else {
      parent.appendChild(doc.createComment(child.value));
    }
  }
}

function elementFromIr(doc: Document, node: IRNode): Element {
  const isSvg = node.tag === "svg";
  const el = isSvg ? doc.createElementNS(SVG_NS, "svg") : doc.createElement(node.tag);

  // data-mae-id first — matches the position ensureIds produces on fresh
  // elements and keeps attribute order stable across roundtrips.
  el.setAttribute("data-mae-id", node.id);
  for (const [name, value] of Object.entries(node.attrs)) {
    el.setAttribute(name, value);
  }
  if (node.classes.length) el.setAttribute("class", node.classes.join(" "));
  if (node.styleDecls.length) el.setAttribute("style", serializeInlineStyle(node.styleDecls));

  if (isSvg && node.svgInner != null) {
    el.innerHTML = node.svgInner;
  } else {
    appendChildren(doc, el, node.children);
  }
  return el;
}
