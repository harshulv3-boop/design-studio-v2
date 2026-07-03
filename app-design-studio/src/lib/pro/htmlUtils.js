// HTML parsing / id assignment / tree building utilities.
import DOMPurify from "dompurify";

// Strip dangerous markup (scripts, event handlers, javascript: urls) while
// preserving inline styles, classes and data-* attributes used by the editor.
// This is the single choke point for any HTML entering the canvas/export,
// which neutralizes prompt-injection -> XSS from AI-generated output.
//
// FORCE_BODY: true — makes DOMPurify treat the input as a body fragment even
// when given a full HTML document (<!DOCTYPE html>...). Without this, the
// entire <head> (including <style> blocks) is silently dropped.
// ADD_TAGS: ["style"] — DOMPurify's default allowlist excludes <style>;
// we need it to carry captured website CSS into the canvas.
export function sanitizeHtml(html) {
  return DOMPurify.sanitize(html || "", {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "link", "meta", "base", "form"],
    FORBID_ATTR: ["srcdoc", "formaction", "ping"],
    ALLOW_DATA_ATTR: true,
    ADD_TAGS: ["style"],
    FORCE_BODY: true,
  });
}

let _counter = 0;
function uid() {
  _counter += 1;
  return `mae-${Date.now().toString(36)}-${_counter}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

// Ensure every element in the fragment has a stable data-mae-id.
// SVG children (path, circle, rect, etc.) are intentionally skipped — the
// parent <svg> is treated as a single atomic unit in the editor.
export function ensureIds(html) {
  const doc = new DOMParser().parseFromString(
    `<div id="__mae_root">${sanitizeHtml(html)}</div>`,
    "text/html"
  );
  const root = doc.getElementById("__mae_root");
  root.querySelectorAll("*").forEach((el) => {
    const isSvgChild = el.tagName.toUpperCase() !== "SVG" && el.closest("svg");
    if (isSvgChild) return;
    if (!el.getAttribute("data-mae-id")) {
      el.setAttribute("data-mae-id", uid());
    }
  });
  return root.innerHTML;
}

// Ensure ids on a live DOM subtree (e.g. after AI edit inserts new nodes).
export function ensureIdsOnElement(el) {
  if (!el) return;
  const all = [el, ...el.querySelectorAll("*")];
  all.forEach((node) => {
    if (node.nodeType === 1 && !node.getAttribute("data-mae-id")) {
      node.setAttribute("data-mae-id", uid());
    }
  });
}

export function classifyElement(el) {
  const tag = (el.tagName || "").toUpperCase();

  // Explicit type set by the editor tool takes priority
  const maeType = el.dataset?.maeType;
  if (maeType === "text")      return "Text";
  if (maeType === "rect")      return "Rectangle";
  if (maeType === "frame")     return "Frame";
  if (maeType === "ellipse")   return "Ellipse";
  if (maeType === "image")     return "Image";

  if (tag === "IMG") return "Image";
  if (tag === "SVG") return "SVG";
  if (tag === "BUTTON") return "Button";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return "Input";
  if (tag === "VIDEO") return "Video";
  if (tag === "A") return "Link";
  if (["UL", "OL"].includes(tag)) return "List";
  if (tag === "LI") return "List item";
  if (tag === "NAV") return "Navigation";
  if (tag === "HEADER") return "Header";
  if (tag === "FOOTER") return "Footer";
  if (tag === "SECTION") return "Section";
  if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(tag)) return "Heading";
  if (["P", "SPAN", "LABEL"].includes(tag)) return "Text";

  const st = el.style || {};
  const br = st.borderRadius || "";
  if (br === "50%" || parseFloat(br) >= 9999) return "Ellipse";
  const bgImg = st.backgroundImage || "";
  if (bgImg.startsWith("url(") && !bgImg.includes("<svg")) return "Image";
  const hasBg = st.backgroundColor && st.backgroundColor !== "transparent" && st.backgroundColor !== "rgba(0, 0, 0, 0)";
  if (!hasBg && !bgImg && el.children && el.children.length > 0) return "Group";
  return "Frame";
}

const TEXT_TAGS = new Set(["P", "SPAN", "BUTTON", "A", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "LABEL"]);

export function defaultName(el) {
  const type = classifyElement(el);
  const text = (el.textContent || "").trim().slice(0, 18);
  if (TEXT_TAGS.has((el.tagName || "").toUpperCase()) && text) return `${type} · ${text}`;
  return type;
}

// Build a hierarchical tree of elements that carry a data-mae-id.
// SVG children are excluded — the <svg> element itself is the layer node.
export function buildTree(rootEl) {
  if (!rootEl) return [];
  const walk = (el) => {
    const children = [];
    const isSvg = el.tagName.toUpperCase() === "SVG";
    if (!isSvg) {
      el.childNodes.forEach((child) => {
        if (child.nodeType === 1 && child.getAttribute("data-mae-id")) {
          children.push(walk(child));
        }
      });
    }
    return {
      id: el.getAttribute("data-mae-id"),
      tag: el.tagName,
      type: classifyElement(el),
      label: defaultName(el),
      children,
    };
  };
  const tree = [];
  rootEl.childNodes.forEach((child) => {
    if (child.nodeType === 1 && child.getAttribute("data-mae-id")) {
      // Skip bare SVG child elements (path, circle, etc.) that somehow ended
      // up at the top level — they're not valid standalone layer nodes.
      const tag = child.tagName.toUpperCase();
      const svgOnlyTags = new Set(["PATH", "CIRCLE", "RECT", "LINE", "POLYLINE", "POLYGON", "ELLIPSE", "G", "DEFS", "USE", "SYMBOL"]);
      if (svgOnlyTags.has(tag)) return;
      tree.push(walk(child));
    }
  });
  return tree;
}

export function findEl(rootEl, id) {
  if (!rootEl || !id) return null;
  return rootEl.querySelector(`[data-mae-id="${id}"]`);
}
