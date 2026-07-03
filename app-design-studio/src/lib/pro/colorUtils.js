// HSV (h:0-360, s:0-1, v:0-1) → RGB (each 0-255)
export function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return [
    Math.max(0, Math.min(255, Math.round((r + m) * 255))),
    Math.max(0, Math.min(255, Math.round((g + m) * 255))),
    Math.max(0, Math.min(255, Math.round((b + m) * 255))),
  ];
}

// RGB (each 0-255) → HSV (h:0-360, s:0-1, v:0-1)
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else                h = ((r - g) / d + 4) * 60;
  }
  return [h, s, v];
}

// Hex (#rrggbb) → RGB [r, g, b]
export function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "").padEnd(6, "0");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

// RGB → Hex #rrggbb
export function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0"))
      .join("")
  );
}

// Hex → HSV
export function hexToHsv(hex) {
  return rgbToHsv(...hexToRgb(hex));
}

// HSV → Hex
export function hsvToHex(h, s, v) {
  return rgbToHex(...hsvToRgb(h, s, v));
}

// Parse any CSS color string (rgb/rgba/hex) → #rrggbb, or null on failure.
export function cssColorToHex(css) {
  if (!css) return null;
  const t = css.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) {
    const [, r, g, b] = t;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const m = t.match(/[\d.]+/g);
  if (m && m.length >= 3) return rgbToHex(+m[0], +m[1], +m[2]);
  return null;
}
