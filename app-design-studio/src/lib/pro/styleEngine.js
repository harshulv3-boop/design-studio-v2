// Style engine: capture CSS properties from DOM elements and apply style objects.
// The style system intentionally excludes layout (position, width, height, transform)
// so that styles are purely visual and reusable across elements of different sizes.

export const STYLE_PROPS = [
  "backgroundColor",
  "background",
  "color",
  "borderRadius",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "border",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "boxShadow",
  "opacity",
  "backdropFilter",
  "filter",
  "display",
  "gap",
  "flexDirection",
  "alignItems",
  "justifyContent",
];

// Read only inline style values (user-set intent, not browser defaults).
export function captureFromElement(el) {
  if (!el) return {};
  const props = {};
  STYLE_PROPS.forEach((prop) => {
    const val = el.style[prop];
    if (val && val !== "initial" && val !== "inherit") {
      props[prop] = val;
    }
  });
  return props;
}

// Apply style properties to a DOM element via inline style.
// Only sets non-empty values; does not clear other existing styles.
export function applyToElement(el, properties = {}) {
  if (!el) return;
  Object.entries(properties).forEach(([prop, val]) => {
    if (val !== undefined && val !== null && val !== "") {
      try { el.style[prop] = val; } catch (_) {}
    }
  });
}

// Pick a representative preview color from a style.
export function previewColor(style) {
  const p = style.properties || {};
  const raw = style.preview || p.backgroundColor || p.background || p.color || "#3f3f46";
  // If it's a gradient or transparent, fall back to a neutral color
  if (raw.startsWith("linear-gradient") || raw.startsWith("radial-gradient")) return "#6366f1";
  if (raw === "transparent" || raw === "rgba(0, 0, 0, 0)") return "#3f3f46";
  return raw;
}

// Check whether a style's preview color is light (for text contrast).
export function isLightColor(hex) {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

let _n = 0;
export function styleId() {
  return `sty-${Date.now().toString(36)}-${(++_n).toString(36)}`;
}
