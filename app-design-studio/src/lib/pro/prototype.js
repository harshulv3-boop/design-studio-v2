// Prototype interaction model. Built ON TOP of the existing `data-nav-to`
// attribute (which stays the canonical navigation target so backend nav
// derivation + exports keep working). Optional `data-nav-*` attributes enrich
// each interaction the way Figma's Prototype mode does.

export const TRIGGERS = [
  { id: "click", label: "On Click" },
  { id: "hover", label: "On Hover" },
  { id: "press", label: "On Press" },
  { id: "delay", label: "After Delay" },
];

export const ACTIONS = [
  { id: "navigate", label: "Navigate to" },
  { id: "back", label: "Back" },
  { id: "overlay", label: "Open Overlay" },
  { id: "scroll", label: "Scroll To" },
];

export const ANIMATIONS = [
  { id: "instant", label: "Instant" },
  { id: "dissolve", label: "Dissolve" },
  { id: "smart-animate", label: "Smart Animate" },
  { id: "slide", label: "Slide In" },
  { id: "push", label: "Push" },
];

export const EASINGS = [
  { id: "ease", label: "Ease" },
  { id: "ease-in", label: "Ease In" },
  { id: "ease-out", label: "Ease Out" },
  { id: "ease-in-out", label: "Ease In-Out" },
  { id: "linear", label: "Linear" },
];

export const DEFAULTS = {
  trigger: "click",
  action: "navigate",
  animation: "instant",
  duration: 300,
  easing: "ease",
  delay: 0,
};

const labelOf = (el) => {
  const tag = el.tagName.toLowerCase();
  const txt = (el.textContent || "").trim();
  return txt ? `${tag} · ${txt.slice(0, 22)}` : tag;
};

// Read every interaction declared on a screen's HTML.
export function parseInteractions(html) {
  const doc = new DOMParser().parseFromString(`<div id="__r">${html || ""}</div>`, "text/html");
  const out = [];
  doc.querySelectorAll("[data-nav-to],[data-nav-action]").forEach((el) => {
    const action = el.getAttribute("data-nav-action") || "navigate";
    if (action === "navigate" && !el.getAttribute("data-nav-to")) return;
    out.push({
      elId: el.getAttribute("data-mae-id"),
      label: labelOf(el),
      target: el.getAttribute("data-nav-to") || "",
      trigger: el.getAttribute("data-nav-trigger") || DEFAULTS.trigger,
      action,
      animation: el.getAttribute("data-nav-animation") || DEFAULTS.animation,
      duration: parseInt(el.getAttribute("data-nav-duration") || DEFAULTS.duration, 10),
      easing: el.getAttribute("data-nav-easing") || DEFAULTS.easing,
      delay: parseInt(el.getAttribute("data-nav-delay") || DEFAULTS.delay, 10),
    });
  });
  return out;
}

// Read a single element's interaction (or null) from a screen's HTML.
export function readInteraction(html, elId) {
  return parseInteractions(html).find((i) => i.elId === elId) || null;
}

// Return a new HTML string with the interaction attrs applied to one element.
export function applyInteractionToHtml(html, elId, attrs) {
  const doc = new DOMParser().parseFromString(`<div id="__r">${html || ""}</div>`, "text/html");
  const el = doc.querySelector(`#__r [data-mae-id="${CSS.escape(elId)}"]`);
  if (!el) return html;
  setAttrs(el, attrs);
  return doc.getElementById("__r").innerHTML;
}

// Apply interaction attributes onto a live DOM element (used when the screen is
// open in the editor, so the change flows through commit/undo/autosave).
export function setInteractionAttrs(el, attrs) {
  setAttrs(el, attrs);
}

function setAttrs(el, attrs) {
  const map = {
    target: "data-nav-to",
    trigger: "data-nav-trigger",
    action: "data-nav-action",
    animation: "data-nav-animation",
    duration: "data-nav-duration",
    easing: "data-nav-easing",
    delay: "data-nav-delay",
    scrollTo: "data-nav-scroll",
  };
  Object.entries(attrs).forEach(([k, v]) => {
    const name = map[k];
    if (!name) return;
    if (v === "" || v == null) el.removeAttribute(name);
    else el.setAttribute(name, String(v));
  });
}

export function clearInteractionFromHtml(html, elId) {
  const doc = new DOMParser().parseFromString(`<div id="__r">${html || ""}</div>`, "text/html");
  const el = doc.querySelector(`#__r [data-mae-id="${CSS.escape(elId)}"]`);
  if (!el) return html;
  ["data-nav-to", "data-nav-trigger", "data-nav-action", "data-nav-animation",
   "data-nav-duration", "data-nav-easing", "data-nav-delay", "data-nav-scroll"]
    .forEach((a) => el.removeAttribute(a));
  return doc.getElementById("__r").innerHTML;
}

// All connections across the whole project: [{ id, source, target, elId, ...interaction }]
export function projectConnections(screens) {
  const ids = new Set(screens.map((s) => s.id));
  const conns = [];
  screens.forEach((s) => {
    parseInteractions(s.html).forEach((i) => {
      if (i.action === "navigate" || i.action === "overlay") {
        if (i.target && ids.has(i.target)) {
          conns.push({ id: `${s.id}::${i.elId}`, source: s.id, ...i });
        }
      }
    });
  });
  return conns;
}

// Build incoming/outgoing adjacency for the screen-navigation graph.
export function buildGraph(screens) {
  const conns = projectConnections(screens);
  const graph = {};
  screens.forEach((s) => (graph[s.id] = { out: [], in: [] }));
  conns.forEach((c) => {
    graph[c.source]?.out.push(c);
    graph[c.target]?.in.push(c);
  });
  return graph;
}
