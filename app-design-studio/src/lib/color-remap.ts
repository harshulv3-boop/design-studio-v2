// Deterministic theme remapping for screen HTML.
//
// Problem: generated/imported screens hardcode dozens of inline hex colors
// (tints/shades of the palette) instead of using CSS variables, so changing the
// shared designSystemCss alone doesn't restyle them. This remaps EVERY color in
// a screen from the OLD palette to the NEW palette by:
//   1. finding the nearest old palette "anchor" for each color, then
//   2. re-applying that color's hue/saturation/lightness OFFSET from the anchor
//      onto the corresponding NEW anchor.
// A light tint of the old accent becomes a light tint of the new accent; a near
// -neutral background shade becomes the new background shade. When the new
// palette stays close to the old (harmonized restyle), shifts are subtle and
// nothing breaks; when it diverges, screens follow it consistently.

export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
};

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

function parseHex(hex: string): (RGB & { a?: number }) | null {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  else if (h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : undefined;
  return { r, g, b, a };
}

function toHex({ r, g, b }: RGB, a?: number): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a === undefined ? base : `${base}${h(a * 255)}`;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const dist = (a: RGB, b: RGB) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

// Colors farther than this (RGB Euclidean, max ≈441) from every anchor are left
// untouched — they're distinct/semantic (e.g. a success green, a brand purple),
// not palette tints, so remapping them would "break the original style".
const REMAP_THRESHOLD = 200;

type Anchor = { key: keyof Palette; oldRgb: RGB; oldHsl: HSL; newHsl: HSL };

function buildAnchors(oldP: Palette, newP: Palette): Anchor[] {
  const keys: (keyof Palette)[] = ["background", "surface", "text", "muted", "accent", "accentText"];
  const anchors: Anchor[] = [];
  for (const key of keys) {
    const o = parseHex(oldP[key]); const n = parseHex(newP[key]);
    if (!o || !n) continue;
    anchors.push({ key, oldRgb: o, oldHsl: rgbToHsl(o), newHsl: rgbToHsl(n) });
  }
  return anchors;
}

function remapColor(rgb: RGB & { a?: number }, anchors: Anchor[]): string | null {
  let best: Anchor | null = null;
  let bestD = Infinity;
  for (const a of anchors) {
    const d = dist(rgb, a.oldRgb);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best || bestD > REMAP_THRESHOLD) return null; // keep distinct colors as-is

  const c = rgbToHsl(rgb);
  const dL = c.l - best.oldHsl.l;
  const dS = c.s - best.oldHsl.s;
  const l = clamp(best.newHsl.l + dL);
  const s = clamp(best.newHsl.s + dS);
  let h: number;
  if (c.s < 0.12) {
    // Near-neutral: keep it neutral in the new theme (don't inject a hue).
    h = best.newHsl.h;
  } else {
    const dH = c.h - best.oldHsl.h;
    h = (best.newHsl.h + dH + 360) % 360;
  }
  return toHex(hslToRgb({ h, s, l }), rgb.a);
}

// Matches #rgb, #rgba, #rrggbb, #rrggbbaa and rgb()/rgba() color values.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g;

/**
 * Remap every color in an HTML string from the old palette to the new one.
 * Returns the html unchanged if palettes are missing/equal.
 */
export function remapHtmlColors(html: string, oldP?: Palette | null, newP?: Palette | null): string {
  if (!html || !oldP || !newP) return html;
  const anchors = buildAnchors(oldP, newP);
  if (anchors.length === 0) return html;

  let out = html.replace(HEX_RE, (m) => {
    const rgb = parseHex(m);
    if (!rgb) return m;
    const mapped = remapColor(rgb, anchors);
    return mapped ?? m;
  });
  out = out.replace(RGB_RE, (m, r, g, b, a) => {
    const rgb: RGB & { a?: number } = { r: +r, g: +g, b: +b, a: a !== undefined ? +a : undefined };
    const mapped = remapColor(rgb, anchors);
    if (!mapped) return m;
    const p = parseHex(mapped)!;
    return rgb.a !== undefined ? `rgba(${Math.round(p.r)}, ${Math.round(p.g)}, ${Math.round(p.b)}, ${rgb.a})` : `rgb(${Math.round(p.r)}, ${Math.round(p.g)}, ${Math.round(p.b)})`;
  });
  return out;
}
