import { parseInlineStyle } from "../core/inline-style";

/**
 * DOM-equality — the roundtrip standard for "nothing changed".
 *
 * Compares two HTML fragments structurally: tag, attribute maps (style
 * compared as parsed declaration lists, class as token lists, everything else
 * verbatim), and text content with adjacent text nodes merged. Attribute
 * ORDER and entity-encoding differences are serialization noise, not drift.
 *
 * Returns null when equal, or a human-readable path + reason for the first
 * difference (used directly in test failure messages and evidence reports).
 */

export type DomDiffOptions = {
  /** Framework targets (React/Vue/Angular) cannot render HTML comments —
   * ignore them when comparing SSR output to canvas HTML. */
  ignoreComments?: boolean;
  /** Decls hoisted out of inline styles (e.g. !important → CSS rules for
   * React). Appended to the LEFT side's style before comparing. */
  augmentStyle?: (maeId: string) => [string, string, boolean][];
};

export function domDiff(htmlA: string, htmlB: string, opts: DomDiffOptions = {}): string | null {
  const a = parse(htmlA);
  const b = parse(htmlB);
  return diffChildren(a, b, "root", opts);
}

export function expectDomEqual(htmlA: string, htmlB: string, opts: DomDiffOptions = {}): void {
  const diff = domDiff(htmlA, htmlB, opts);
  if (diff) throw new Error(`DOM difference: ${diff}`);
}

function parse(html: string): Element {
  const doc = new DOMParser().parseFromString(`<div id="__cmp">${html}</div>`, "text/html");
  const root = doc.getElementById("__cmp");
  if (!root) throw new Error("domDiff: parse failed");
  return root;
}

type Item =
  | { kind: "el"; el: Element }
  | { kind: "text"; value: string }
  | { kind: "comment"; value: string };

function items(parent: Element, opts: DomDiffOptions): Item[] {
  const out: Item[] = [];
  parent.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const prev = out[out.length - 1];
      if (prev?.kind === "text") prev.value += node.nodeValue ?? "";
      else out.push({ kind: "text", value: node.nodeValue ?? "" });
    } else if (node.nodeType === 8) {
      if (!opts.ignoreComments) out.push({ kind: "comment", value: node.nodeValue ?? "" });
    } else if (node.nodeType === 1) {
      out.push({ kind: "el", el: node as Element });
    }
  });
  return out;
}

function diffChildren(a: Element, b: Element, path: string, opts: DomDiffOptions): string | null {
  const ia = items(a, opts);
  const ib = items(b, opts);
  if (ia.length !== ib.length) {
    return `${path}: child count ${ia.length} vs ${ib.length}`;
  }
  for (let i = 0; i < ia.length; i++) {
    const ca = ia[i];
    const cb = ib[i];
    if (ca.kind !== cb.kind) return `${path}[${i}]: node kind ${ca.kind} vs ${cb.kind}`;
    if (ca.kind === "text" || ca.kind === "comment") {
      const vb = (cb as { value: string }).value;
      if (ca.value !== vb) {
        return `${path}[${i}]: ${ca.kind} ${JSON.stringify(ca.value.slice(0, 80))} vs ${JSON.stringify(vb.slice(0, 80))}`;
      }
      continue;
    }
    const elDiff = diffElement(ca.el, (cb as { el: Element }).el, `${path}[${i}]`, opts);
    if (elDiff) return elDiff;
  }
  return null;
}

function diffElement(a: Element, b: Element, path: string, opts: DomDiffOptions): string | null {
  const tagA = a.tagName.toLowerCase();
  const tagB = b.tagName.toLowerCase();
  const label = `${path}<${tagA}${a.getAttribute("data-mae-id") ? ` ${a.getAttribute("data-mae-id")}` : ""}>`;
  if (tagA !== tagB) return `${path}: tag <${tagA}> vs <${tagB}>`;

  const attrsA = attrMap(a);
  const attrsB = attrMap(b);
  const names = new Set([...attrsA.keys(), ...attrsB.keys()]);
  for (const name of names) {
    const va = attrsA.get(name);
    const vb = attrsB.get(name);
    if (va === undefined || vb === undefined) {
      if (name === "style") {
        const maeId = a.getAttribute("data-mae-id") || "";
        const extra = opts.augmentStyle?.(maeId) ?? [];
        const da = JSON.stringify(normalizeDecls([...parseInlineStyle(va ?? ""), ...extra]));
        const db = JSON.stringify(normalizeDecls(parseInlineStyle(vb ?? "")));
        if (da === db) continue;
      }
      return `${label}: attribute "${name}" ${va === undefined ? "missing on left" : "missing on right"}`;
    }
    if (name === "style") {
      const maeId = a.getAttribute("data-mae-id") || "";
      const extra = opts.augmentStyle?.(maeId) ?? [];
      const da = JSON.stringify(normalizeDecls([...parseInlineStyle(va), ...extra]));
      const db = JSON.stringify(normalizeDecls(parseInlineStyle(vb)));
      if (da !== db)
        return `${label}: style ${JSON.stringify(va)}+hoisted vs ${JSON.stringify(vb)}`;
    } else if (name === "class") {
      const ta = va.split(/\s+/).filter(Boolean).join(" ");
      const tb = vb.split(/\s+/).filter(Boolean).join(" ");
      if (ta !== tb) return `${label}: class "${va}" vs "${vb}"`;
    } else if (va !== vb) {
      return `${label}: attr ${name}="${va.slice(0, 80)}" vs "${vb.slice(0, 80)}"`;
    }
  }

  return diffChildren(a, b, label, opts);
}

// Hoisted decls come back in rule order which may not match the original
// declaration position; compare as prop-sorted sets with last-wins semantics.
function normalizeDecls(decls: [string, string, boolean][]): [string, string, boolean][] {
  const map = new Map<string, [string, string, boolean]>();
  for (const [p, v, imp] of decls) map.set(p.toLowerCase(), [p.toLowerCase(), v, imp]);
  return [...map.values()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

function attrMap(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < el.attributes.length; i++) {
    map.set(el.attributes[i].name, el.attributes[i].value);
  }
  return map;
}
