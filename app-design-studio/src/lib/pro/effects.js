// Figma-style layered effects. Effects are serialized as JSON on the element
// (data-mae-effects) — HTML stays the single source of truth — and compiled to
// CSS (box-shadow / filter / backdrop-filter / background-image).

export const EFFECT_TYPES = [
  { type: "drop-shadow", label: "Drop shadow" },
  { type: "inner-shadow", label: "Inner shadow" },
  { type: "layer-blur", label: "Layer blur" },
  { type: "background-blur", label: "Background blur" },
  { type: "noise", label: "Noise" },
  { type: "texture", label: "Texture" },
  { type: "glass", label: "Glass" },
];

export function defaultEffect(type) {
  const id = "fx-" + Math.random().toString(36).slice(2, 8);
  const base = { id, type, enabled: true };
  switch (type) {
    case "drop-shadow": return { ...base, x: 0, y: 8, blur: 24, spread: 0, color: "#000000", opacity: 30 };
    case "inner-shadow": return { ...base, x: 0, y: 2, blur: 8, spread: 0, color: "#000000", opacity: 30 };
    case "layer-blur": return { ...base, blur: 6 };
    case "background-blur": return { ...base, blur: 12, transparency: 60 };
    case "noise": return { ...base, intensity: 50, scale: 2, opacity: 20 };
    case "texture": return { ...base, pattern: "dots", scale: 6, opacity: 15 };
    case "glass": return { ...base, blur: 16, transparency: 18, borderOpacity: 45, saturation: 160, reflection: 35 };
    default: return base;
  }
}

function hexA(hex, opacityPct) {
  const h = (hex || "#000000").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${(opacityPct / 100).toFixed(3)})`;
}

function noiseUri(intensity, scale, opacityPct) {
  const freq = (0.55 + (intensity / 100) * 0.55) / Math.max(1, scale);
  const op = (opacityPct / 100).toFixed(2);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'>` +
    `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${freq.toFixed(3)}' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix type='saturate' values='0'/></filter>` +
    `<rect width='100%' height='100%' filter='url(%23n)' opacity='${op}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/%23/g, "%23")}")`;
}

function textureUri(pattern, scale, opacityPct) {
  const s = Math.max(4, Math.round(scale * 2));
  const op = (opacityPct / 100).toFixed(2);
  let inner;
  if (pattern === "grid") inner = `<path d='M${s} 0H0V${s}' stroke='%23ffffff' fill='none' stroke-width='0.6'/>`;
  else if (pattern === "lines") inner = `<path d='M0 ${s} L${s} 0' stroke='%23ffffff' stroke-width='0.6'/>`;
  else if (pattern === "cross") inner = `<path d='M${s / 2} 0V${s} M0 ${s / 2}H${s}' stroke='%23ffffff' stroke-width='0.5'/>`;
  else inner = `<circle cx='${s / 2}' cy='${s / 2}' r='1' fill='%23ffffff'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'>` +
    `<g opacity='${op}'>${inner}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function computeEffectStyles(effects) {
  const shadows = [], filters = [], backdrop = [], bgImages = [];
  (effects || []).filter((e) => e.enabled).forEach((e) => {
    switch (e.type) {
      case "drop-shadow":
        shadows.push(`${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${hexA(e.color, e.opacity)}`); break;
      case "inner-shadow":
        shadows.push(`inset ${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${hexA(e.color, e.opacity)}`); break;
      case "layer-blur":
        filters.push(`blur(${e.blur}px)`); break;
      case "background-blur":
        backdrop.push(`blur(${e.blur}px)`); break;
      case "noise":
        bgImages.push(noiseUri(e.intensity, e.scale, e.opacity)); break;
      case "texture":
        bgImages.push(textureUri(e.pattern, e.scale, e.opacity)); break;
      case "glass":
        backdrop.push(`blur(${e.blur}px) saturate(${e.saturation}%)`);
        bgImages.push(`linear-gradient(${hexA("#ffffff", e.transparency)}, ${hexA("#ffffff", Math.max(0, e.transparency - 8))})`);
        shadows.push(`inset 0 1px 0 0 ${hexA("#ffffff", e.reflection)}`);
        shadows.push(`inset 0 0 0 1px ${hexA("#ffffff", e.borderOpacity)}`);
        break;
      default: break;
    }
  });
  return {
    boxShadow: shadows.join(", "),
    filter: filters.join(" "),
    backdropFilter: backdrop.join(" "),
    backgroundImage: bgImages.join(", "),
  };
}

export function parseEffects(el) {
  if (!el) return [];
  try {
    const raw = el.getAttribute("data-mae-effects");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Split a CSS background-image string on top-level commas only
 * (safe with nested functions like linear-gradient(a, b)).
 */
export function splitBgLayers(str) {
  if (!str || str === "none") return [];
  const result = [];
  let depth = 0;
  let current = "";
  for (const char of str) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/**
 * Apply effects to an element WITHOUT clobbering the element's existing
 * background-image (gradients, custom images).
 *
 * Strategy:
 *   - box-shadow / filter / backdrop-filter are independent → safe to overwrite
 *   - background-image: track which layers were last written by effects
 *     (stored as "||"-separated list in data-mae-fx-bg).
 *     On each apply: strip the old effect layers, keep user layers, prepend new effect layers.
 */
export function applyEffects(el, effects) {
  if (!el) return;
  const setP = (prop, val) => (val ? el.style.setProperty(prop, val) : el.style.removeProperty(prop));
  const s = computeEffectStyles(effects);

  // These properties are isolated — safe to set/clear independently
  setP("box-shadow", s.boxShadow);
  setP("filter", s.filter);
  setP("backdrop-filter", s.backdropFilter);
  setP("-webkit-backdrop-filter", s.backdropFilter);

  // ── Background-image: preserve user layers ───────────────────────────────
  // Parts that effects previously wrote (so we know what to strip on update)
  const prevFxBg = el.getAttribute("data-mae-fx-bg") || "";
  const prevFxParts = prevFxBg ? prevFxBg.split("||").map((p) => p.trim()).filter(Boolean) : [];

  // All current bg layers on the element
  const currentBgParts = splitBgLayers(el.style.backgroundImage || "");

  // User layers = anything NOT written by previous effects
  const userBgParts = currentBgParts.filter((p) => !prevFxParts.includes(p));

  // New effect-generated layers
  const newFxParts = s.backgroundImage ? splitBgLayers(s.backgroundImage) : [];

  // Combined: effect layers render on top of user layers
  const combined = [...newFxParts, ...userBgParts].filter(Boolean);
  if (combined.length) {
    el.style.setProperty("background-image", combined.join(", "));
  } else {
    el.style.removeProperty("background-image");
  }

  // Persist new effect layers so next applyEffects call knows what to strip
  if (newFxParts.length) {
    el.setAttribute("data-mae-fx-bg", newFxParts.join("||"));
  } else {
    el.removeAttribute("data-mae-fx-bg");
  }

  if (effects && effects.length) el.setAttribute("data-mae-effects", JSON.stringify(effects));
  else el.removeAttribute("data-mae-effects");
}

