// Reusable Text Styles library (Library > Text Styles). Persisted in localStorage
// so styles are shared across projects. Applying a style writes all typography
// properties onto the selected element (HTML remains the source of truth).
import { loadGoogleFont } from "@/lib/pro/fonts";

const KEY = "mae-text-styles";

const DEFAULTS = [
  { name: "Hero Title", fontFamily: "Plus Jakarta Sans", fontWeight: 800, fontSize: 40, lineHeight: 44, letterSpacing: -1, paragraphSpacing: 0, textTransform: "none", color: "#0F172A", textAlign: "left" },
  { name: "H1", fontFamily: "Plus Jakarta Sans", fontWeight: 700, fontSize: 30, lineHeight: 36, letterSpacing: -0.5, paragraphSpacing: 0, textTransform: "none", color: "#0F172A", textAlign: "left" },
  { name: "H2", fontFamily: "Plus Jakarta Sans", fontWeight: 700, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, paragraphSpacing: 0, textTransform: "none", color: "#0F172A", textAlign: "left" },
  { name: "Body Large", fontFamily: "Inter", fontWeight: 500, fontSize: 17, lineHeight: 26, letterSpacing: 0, paragraphSpacing: 8, textTransform: "none", color: "#334155", textAlign: "left" },
  { name: "Body", fontFamily: "Inter", fontWeight: 400, fontSize: 15, lineHeight: 22, letterSpacing: 0, paragraphSpacing: 8, textTransform: "none", color: "#334155", textAlign: "left" },
  { name: "Caption", fontFamily: "Inter", fontWeight: 500, fontSize: 12, lineHeight: 16, letterSpacing: 0.2, paragraphSpacing: 0, textTransform: "none", color: "#64748B", textAlign: "left" },
  { name: "Label", fontFamily: "Inter", fontWeight: 600, fontSize: 11, lineHeight: 14, letterSpacing: 0.6, paragraphSpacing: 0, textTransform: "uppercase", color: "#64748B", textAlign: "left" },
  { name: "Button Text", fontFamily: "Inter", fontWeight: 600, fontSize: 15, lineHeight: 20, letterSpacing: 0.2, paragraphSpacing: 0, textTransform: "none", color: "#FFFFFF", textAlign: "center" },
];

const uid = () => "ts-" + Math.random().toString(36).slice(2, 9);

export function getTextStyles() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  const seeded = DEFAULTS.map((d) => ({ id: uid(), ...d }));
  localStorage.setItem(KEY, JSON.stringify(seeded));
  return seeded;
}

function save(arr) {
  localStorage.setItem(KEY, JSON.stringify(arr));
  window.dispatchEvent(new Event("mae:text-styles-changed"));
  return arr;
}

export function createTextStyle(style) {
  const arr = getTextStyles();
  const s = { id: uid(), name: style.name || "New style", ...style };
  return [save([...arr, s]), s];
}
export function updateTextStyle(id, patch) {
  return save(getTextStyles().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}
export function renameTextStyle(id, name) { return updateTextStyle(id, { name }); }
export function deleteTextStyle(id) { return save(getTextStyles().filter((s) => s.id !== id)); }
export function duplicateTextStyle(id) {
  const arr = getTextStyles();
  const src = arr.find((s) => s.id === id);
  if (!src) return arr;
  return save([...arr, { ...src, id: uid(), name: `${src.name} copy` }]);
}

const num = (v) => parseFloat(v) || 0;
const rgbToHex = (rgb) => {
  const m = (rgb || "").match(/\d+/g);
  if (!m) return "#000000";
  return "#" + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("");
};

export function captureTextStyle(el, name = "New style") {
  const cs = getComputedStyle(el);
  const fam = (el.style.fontFamily || cs.fontFamily || "Inter").split(",")[0].replace(/['"]/g, "").trim();
  return {
    name,
    fontFamily: fam || "Inter",
    fontWeight: num(cs.fontWeight) || 400,
    fontSize: Math.round(num(cs.fontSize)) || 16,
    lineHeight: cs.lineHeight === "normal" ? 0 : Math.round(num(cs.lineHeight)),
    letterSpacing: cs.letterSpacing === "normal" ? 0 : num(cs.letterSpacing),
    paragraphSpacing: Math.round(num(cs.marginBottom)),
    textTransform: cs.textTransform === "none" ? "none" : cs.textTransform,
    color: rgbToHex(cs.color),
    textAlign: cs.textAlign || "left",
  };
}

export function applyTextStyle(el, style) {
  if (!el || !style) return;
  loadGoogleFont(style.fontFamily);
  const st = el.style;
  st.setProperty("font-family", `'${style.fontFamily}', sans-serif`);
  if (style.fontWeight) st.setProperty("font-weight", String(style.fontWeight));
  if (style.fontSize) st.setProperty("font-size", `${style.fontSize}px`);
  if (style.lineHeight) st.setProperty("line-height", `${style.lineHeight}px`);
  st.setProperty("letter-spacing", `${style.letterSpacing || 0}px`);
  st.setProperty("margin-bottom", `${style.paragraphSpacing || 0}px`);
  st.setProperty("text-transform", style.textTransform || "none");
  if (style.color) st.setProperty("color", style.color);
  if (style.textAlign) st.setProperty("text-align", style.textAlign);
  el.setAttribute("data-mae-textstyle", style.id || "");
}
