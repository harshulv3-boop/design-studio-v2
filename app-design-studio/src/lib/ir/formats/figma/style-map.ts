import type { EffectSpec, FillSpec, RGBA, StrokeSpec } from "./types";
import type { MaeEffect } from "../../core/attrs";
import { splitTop } from "../../core/inline-style";

/** Computed-style → Figma spec conversions. Colors arrive as rgb()/rgba()
 * (Chromium computed values); gradients as normalized linear-gradient(). */

export function parseColor(value: string | undefined): RGBA | null {
  if (!value) return null;
  const v = value.trim();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length >= 3) {
      return {
        r: Math.min(255, parts[0]) / 255,
        g: Math.min(255, parts[1]) / 255,
        b: Math.min(255, parts[2]) / 255,
        a: parts.length > 3 ? Math.max(0, Math.min(1, parts[3])) : 1,
      };
    }
  }
  const hex = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      r: ((n >> 16) & 255) / 255,
      g: ((n >> 8) & 255) / 255,
      b: (n & 255) / 255,
      a: hex[2] ? parseInt(hex[2], 16) / 255 : 1,
    };
  }
  return null;
}

export function px(value: string | undefined): number {
  const n = parseFloat(value || "0");
  return Number.isFinite(n) ? n : 0;
}

export function hexA(hex: string, opacityPct: number): RGBA {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return { ...c, a: Math.max(0, Math.min(1, opacityPct / 100)) };
}

/** background-image layers → fills. CSS paints first-layer-on-top; Figma
 * paints last-fill-on-top, so the returned array is reversed by the caller
 * after appending the background-color fill. */
export function parseBackgroundImageLayer(layer: string, warnings: string[]): FillSpec | null {
  const trimmed = layer.trim();
  if (!trimmed || trimmed === "none") return null;

  const urlMatch = trimmed.match(/^url\((['"]?)(.*)\1\)$/s);
  if (urlMatch) {
    return { type: "IMAGE", url: urlMatch[2], scaleMode: "FILL" };
  }

  const gradMatch = trimmed.match(/^(repeating-)?linear-gradient\((.*)\)$/s);
  if (gradMatch) {
    const inner = gradMatch[2];
    const parts = splitTop(inner, ",").map((p) => p.trim());
    let angleDeg = 180; // CSS default: to bottom
    let stopParts = parts;
    const first = parts[0] || "";
    if (/deg$|grad$|rad$|turn$/.test(first)) {
      angleDeg = parseFloat(first);
      if (first.endsWith("turn")) angleDeg = parseFloat(first) * 360;
      if (first.endsWith("rad")) angleDeg = (parseFloat(first) * 180) / Math.PI;
      stopParts = parts.slice(1);
    } else if (first.startsWith("to ")) {
      const dir = first.slice(3).trim();
      const map: Record<string, number> = {
        top: 0, right: 90, bottom: 180, left: 270,
        "top right": 45, "right top": 45,
        "bottom right": 135, "right bottom": 135,
        "bottom left": 225, "left bottom": 225,
        "top left": 315, "left top": 315,
      };
      angleDeg = map[dir] ?? 180;
      stopParts = parts.slice(1);
    }

    const stops: { position: number; color: RGBA }[] = [];
    for (const stop of stopParts) {
      // "<color> <pos>?" — color may contain commas inside rgb().
      const posMatch = stop.match(/\s([\d.]+)%\s*$/);
      const colorStr = posMatch ? stop.slice(0, posMatch.index).trim() : stop.trim();
      const color = parseColor(colorStr);
      if (!color) {
        warnings.push(`Unparseable gradient stop "${stop.slice(0, 40)}" — skipped.`);
        continue;
      }
      stops.push({
        position: posMatch ? Math.max(0, Math.min(1, parseFloat(posMatch[1]) / 100)) : NaN,
        color,
      });
    }
    // Distribute positionless stops evenly (CSS behavior).
    const n = stops.length;
    stops.forEach((s, i) => {
      if (Number.isNaN(s.position)) s.position = n === 1 ? 0 : i / (n - 1);
    });
    if (stops.length >= 2) return { type: "GRADIENT_LINEAR", angleDeg, stops };
    if (stops.length === 1) return { type: "SOLID", color: stops[0].color };
    return null;
  }

  if (/^(radial|conic)-gradient/.test(trimmed)) {
    // Approximate as a solid of the first stop; enumerate in warnings.
    const color = trimmed.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
    warnings.push(
      `${trimmed.split("(")[0]} approximated as a solid fill (Figma spec v1 carries linear gradients only).`,
    );
    const parsed = color ? parseColor(color[0]) : null;
    return parsed ? { type: "SOLID", color: parsed } : null;
  }

  warnings.push(`Unsupported background layer "${trimmed.slice(0, 60)}" — skipped.`);
  return null;
}

export function fillsFromComputed(
  computed: Record<string, string>,
  warnings: string[],
): FillSpec[] {
  const fills: FillSpec[] = [];
  const bg = parseColor(computed["background-color"]);
  if (bg && bg.a > 0) fills.push({ type: "SOLID", color: bg });

  const image = computed["background-image"];
  if (image && image !== "none") {
    const layers = splitTop(image, ",")
      .map((layer) => parseBackgroundImageLayer(layer, warnings))
      .filter((f): f is FillSpec => f !== null);
    // CSS: first layer on top. Figma: last fill on top → reverse.
    fills.push(...layers.reverse());
  }
  return fills;
}

export function strokeFromComputed(computed: Record<string, string>): StrokeSpec | null {
  const weights = {
    top: px(computed["border-top-width"]),
    right: px(computed["border-right-width"]),
    bottom: px(computed["border-bottom-width"]),
    left: px(computed["border-left-width"]),
  };
  if (!weights.top && !weights.right && !weights.bottom && !weights.left) return null;
  const style = computed["border-top-style"];
  if (style === "none" || style === "hidden") return null;
  const color = parseColor(computed["border-top-color"]);
  if (!color || color.a === 0) return null;
  return { color, weights, dashed: style === "dashed" || style === "dotted" };
}

export function cornerRadiusFromComputed(computed: Record<string, string>) {
  const tl = px(computed["border-top-left-radius"]);
  const tr = px(computed["border-top-right-radius"]);
  const br = px(computed["border-bottom-right-radius"]);
  const bl = px(computed["border-bottom-left-radius"]);
  if (!tl && !tr && !br && !bl) return undefined;
  return { tl, tr, br, bl };
}

/** Editor effects (data-mae-effects) map 1:1 — exact roundtrip, no reverse-
 * parsing of compiled box-shadow strings. */
export function effectsFromMae(effects: MaeEffect[]): EffectSpec[] {
  const out: EffectSpec[] = [];
  for (const fx of effects) {
    if (fx.enabled === false) continue;
    switch (fx.type) {
      case "drop-shadow":
      case "inner-shadow":
        out.push({
          type: fx.type === "drop-shadow" ? "DROP_SHADOW" : "INNER_SHADOW",
          color: hexA(String(fx.color ?? "#000000"), Number(fx.opacity ?? 30)),
          offset: { x: Number(fx.x ?? 0), y: Number(fx.y ?? 0) },
          radius: Number(fx.blur ?? 0),
          spread: Number(fx.spread ?? 0),
        });
        break;
      case "layer-blur":
        out.push({ type: "LAYER_BLUR", radius: Number(fx.blur ?? 0) });
        break;
      case "background-blur":
      case "glass":
        out.push({ type: "BACKGROUND_BLUR", radius: Number(fx.blur ?? 0) });
        break;
      // noise/texture are background-image layers — carried by fills.
      default:
        break;
    }
  }
  return out;
}

/** Fallback: parse computed box-shadow / filter when no data-mae-effects. */
export function effectsFromComputed(
  computed: Record<string, string>,
  warnings: string[],
): EffectSpec[] {
  const out: EffectSpec[] = [];
  const boxShadow = computed["box-shadow"];
  if (boxShadow && boxShadow !== "none") {
    for (const shadow of splitTop(boxShadow, ",")) {
      const inset = /\binset\b/.test(shadow);
      const colorMatch = shadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
      const nums = shadow
        .replace(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|inset/g, "")
        .trim()
        .split(/\s+/)
        .map(parseFloat)
        .filter((n) => Number.isFinite(n));
      const color = colorMatch ? parseColor(colorMatch[0]) : null;
      if (!color) {
        warnings.push(`Unparseable box-shadow segment "${shadow.trim().slice(0, 40)}".`);
        continue;
      }
      out.push({
        type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
        color,
        offset: { x: nums[0] ?? 0, y: nums[1] ?? 0 },
        radius: nums[2] ?? 0,
        spread: nums[3] ?? 0,
      });
    }
  }
  const filter = computed["filter"];
  const blur = filter?.match(/blur\(([\d.]+)px\)/);
  if (blur) out.push({ type: "LAYER_BLUR", radius: parseFloat(blur[1]) });
  const backdrop = computed["backdrop-filter"];
  const bblur = backdrop?.match(/blur\(([\d.]+)px\)/);
  if (bblur) out.push({ type: "BACKGROUND_BLUR", radius: parseFloat(bblur[1]) });
  return out;
}

const WEIGHT_NAMES: Record<string, number> = {
  normal: 400,
  bold: 700,
  lighter: 300,
  bolder: 700,
};

export function fontWeight(value: string | undefined): number {
  if (!value) return 400;
  return WEIGHT_NAMES[value] ?? (parseFloat(value) || 400);
}

export function firstFontFamily(value: string | undefined): string {
  if (!value) return "Inter";
  const first = splitTop(value, ",")[0]?.trim() ?? "Inter";
  return first.replace(/^['"]|['"]$/g, "");
}

export function textAlign(value: string | undefined): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  switch (value) {
    case "center":
      return "CENTER";
    case "right":
    case "end":
      return "RIGHT";
    case "justify":
      return "JUSTIFIED";
    default:
      return "LEFT";
  }
}
