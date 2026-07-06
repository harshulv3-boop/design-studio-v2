import type { IRChild, IRNode } from "../schema";
import { isElement, isText } from "../schema";
import { getDecl } from "./inline-style";

/**
 * Pure IR port of classifyElement/defaultName from src/lib/pro/htmlUtils.js —
 * same rules, but reading IRNode fields instead of a live DOM element, so
 * layer names in exports (Figma/Flutter) match what the editor's LayersPanel
 * shows for the same element.
 */

const TEXT_TAGS = new Set([
  "p",
  "span",
  "button",
  "a",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "label",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function classifyNode(node: IRNode): string {
  const tag = node.tag.toLowerCase();

  const maeType = node.attrs["data-mae-type"];
  if (maeType === "text") return "Text";
  if (maeType === "rect") return "Rectangle";
  if (maeType === "frame") return "Frame";
  if (maeType === "ellipse") return "Ellipse";
  if (maeType === "image") return "Image";

  if (tag === "img") return "Image";
  if (tag === "svg") return "SVG";
  if (tag === "button") return "Button";
  if (["input", "textarea", "select"].includes(tag)) return "Input";
  if (tag === "video") return "Video";
  if (tag === "a") return "Link";
  if (["ul", "ol"].includes(tag)) return "List";
  if (tag === "li") return "List item";
  if (tag === "nav") return "Navigation";
  if (tag === "header") return "Header";
  if (tag === "footer") return "Footer";
  if (tag === "section") return "Section";
  if (HEADINGS.has(tag)) return "Heading";
  if (["p", "span", "label"].includes(tag)) return "Text";

  const br = getDecl(node.styleDecls, "border-radius") || "";
  if (br === "50%" || parseFloat(br) >= 9999) return "Ellipse";
  const bgImg = getDecl(node.styleDecls, "background-image") || "";
  if (bgImg.startsWith("url(") && !bgImg.includes("<svg")) return "Image";
  const bg = getDecl(node.styleDecls, "background-color");
  const hasBg = !!bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
  const elementChildren = node.children.filter(isElement);
  if (!hasBg && !bgImg && elementChildren.length > 0) return "Group";
  return "Frame";
}

export function textContent(children: IRChild[]): string {
  let out = "";
  for (const child of children) {
    if (isText(child)) out += child.value;
    else if (isElement(child)) out += textContent(child.children);
  }
  return out;
}

export function defaultNodeName(node: IRNode): string {
  const type = classifyNode(node);
  const text = textContent(node.children).trim().slice(0, 18);
  if (TEXT_TAGS.has(node.tag.toLowerCase()) && text) return `${type} · ${text}`;
  return type;
}
