// Stubbed for Lovable — no backend fonts API or image export cache here.
const api = { get: async () => ({ data: { fonts: [] } }) };
const invalidateFontCache = () => {};

let _fonts = null;
let _inflight = null;

export async function getFonts() {
  if (_fonts) return _fonts;
  if (_inflight) return _inflight;
  _inflight = api
    .get("/fonts")
    .then(({ data }) => {
      _fonts = data.fonts || [];
      return _fonts;
    })
    .catch(() => {
      _fonts = [];
      return _fonts;
    });
  return _inflight;
}

const _loaded = new Set();

export function loadGoogleFont(family) {
  if (!family || family === "inherit" || _loaded.has(family)) return;
  _loaded.add(family);
  const id = "gf-" + family.replace(/\s+/g, "-");
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family
  )}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
  // A new stylesheet just landed — drop the cached fontEmbedCSS so the next
  // image export rebuilds it including this family.
  invalidateFontCache();
}

// Convert a CSS font-family value to a readable family name.
export function readableFamily(cssValue) {
  if (!cssValue || cssValue === "inherit") return "inherit";
  return cssValue.split(",")[0].replace(/['"]/g, "").trim();
}
