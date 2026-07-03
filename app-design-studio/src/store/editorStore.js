import { create } from "zustand";

const MAX_HISTORY = 60;

export const useEditorStore = create((set, get) => ({
  project: null,
  html: "",
  // bumped only when the canvas must imperatively re-render its innerHTML
  // (initial load, undo/redo, AI edit). Plain DOM edits do NOT bump it.
  htmlVersion: 0,

  // Design-system CSS and palette tracked here so palette changes participate
  // in undo/redo alongside canvas edits. Updated via commitDesignCss or undo/redo.
  designSystemCss: "",
  palette: null,
  // Set by undo/redo when a CSS snapshot is restored; workspace subscribes to
  // this to sync back into React project state. Cleared immediately after.
  paletteRestored: null,

  selectedId: null,
  selectedIds: [],
  tool: "select",
  spaceDown: false,
  clipboard: [],
  hiddenIds: {},
  lockedIds: {},
  names: {},

  history: [],
  future: [],
  inBatch: false,
  batchBase: null,
  batchBasePage: null,

  zoom: 1,
  pan: { x: 0, y: 0 },

  // Set during an active resize drag so PropertiesPanel can update live.
  // Shape: { id, w, h, x, y } | null
  liveSize: null,
  setLiveSize: (v) => set({ liveSize: v }),

  // Aspect-ratio lock: when true, W/H resize maintains the element's ratio.
  aspectLocked: false,
  setAspectLocked: (v) => set({ aspectLocked: v }),

  // Canvas background color (applied to the viewport, not the page element)
  page: { background: "" },
  setPage: (patch) => set((s) => {
    const newPage = { ...s.page, ...patch };
    if (s.inBatch) {
      return { page: newPage, dirty: true };
    }
    // Outside a batch: record a history entry so Ctrl+Z can undo page changes.
    return {
      page: newPage,
      dirty: true,
      history: [...s.history, { html: s.html, page: s.page }].slice(-MAX_HISTORY),
      future: [],
    };
  }),

  // User-created color library styles: [{ id, name, color }]
  colorStyles: [],
  addColorStyle: (style) => set((s) => ({ colorStyles: [...s.colorStyles, style], dirty: true })),
  updateColorStyle: (id, patch) =>
    set((s) => ({ colorStyles: s.colorStyles.map((st) => (st.id === id ? { ...st, ...patch } : st)), dirty: true })),
  deleteColorStyle: (id) => set((s) => ({ colorStyles: s.colorStyles.filter((st) => st.id !== id), dirty: true })),

  // User-created component/visual styles: [{ id, name, properties, preview }]
  styles: [],
  addStyle: (style) => set((s) => ({ styles: [...s.styles, style], dirty: true })),
  updateStyle: (id, patch) =>
    set((s) => ({ styles: s.styles.map((st) => (st.id === id ? { ...st, ...patch } : st)), dirty: true })),
  deleteStyle: (id) => set((s) => ({ styles: s.styles.filter((st) => st.id !== id), dirty: true })),

  // Recent colors (session-only, not persisted)
  recentColors: [],
  addRecentColor: (hex) =>
    set((s) => {
      const n = hex.toLowerCase();
      const filtered = s.recentColors.filter((c) => c.toLowerCase() !== n);
      return { recentColors: [n, ...filtered].slice(0, 12) };
    }),

  dirty: false,
  generating: false,
  aiBusy: false,

  // Live-save status for the navbar indicator. Kept in the store (not React
  // component state) so updating it re-renders ONLY the tiny indicator that
  // subscribes to it — never the Workspace/Canvas tree. Updating it from
  // Workspace state instead caused a render→sync→setProject cascade (an
  // infinite update loop) on direct page loads.
  saveStatus: "saved",
  setSaveStatus: (v) => set({ saveStatus: v }),

  setProject: (project) => set({ project }),

  // Full (re)load — imperatively re-renders the canvas.
  loadHtml: (html) =>
    set({
      html,
      htmlVersion: get().htmlVersion + 1,
      history: [],
      future: [],
      selectedId: null,
    }),

  // History entries are {html, page} snapshots. Plain strings are kept for
  // backward-compat with any persisted data that pre-dates this format.
  _snap: () => ({ html: get().html, page: get().page }),
  _fromSnap: (s) => typeof s === "string" ? { html: s, page: get().page } : s,

  // Record a palette/CSS change in the shared undo history.
  // oldCss/oldPalette are the state BEFORE the change (what undo will restore).
  // newCss/newPalette are the incoming values (update designSystemCss so future
  // canvas-edit snapshots capture the current CSS).
  commitDesignCss: (newCss, newPalette, oldCss, oldPalette) => {
    const { html, page, history } = get();
    set({
      designSystemCss: newCss,
      palette: newPalette,
      history: [...history, { html, page, css: oldCss, palette: oldPalette }].slice(-MAX_HISTORY),
      future: [],
      dirty: true,
    });
  },

  // DOM already reflects newHtml; just record history + sync string.
  // During a batch, intermediate calls only update html (no history entry).
  commitDom: (newHtml) => {
    const { html, page, history, inBatch } = get();
    if (html === newHtml) return;
    // SAFETY: a spurious empty DOM read (can happen while a large page is
    // (re)mounting) must NEVER wipe real content — the page root can't be
    // legitimately deleted, so an empty commit over non-empty html is a bug.
    if ((!newHtml || !newHtml.trim()) && html && html.trim()) return;
    if (inBatch) {
      set({ html: newHtml, dirty: true });
    } else {
      // Website imports carry ~0.5–1 MB of HTML per snapshot — cap the undo
      // depth for large documents so history can't balloon memory.
      const cap = newHtml.length > 500000 ? 15 : MAX_HISTORY;
      set({ html: newHtml, history: [...history, { html, page }].slice(-cap), future: [], dirty: true });
    }
  },

  // Begin a batch: save the pre-edit snapshot (html + page).
  startBatch: () => {
    if (get().inBatch) return;
    set({ inBatch: true, batchBase: get().html, batchBasePage: get().page });
  },

  // End a batch: push one history entry for the whole edit if anything changed.
  endBatch: () => {
    const { inBatch, batchBase, batchBasePage, html, page, history } = get();
    if (!inBatch) return;
    const htmlChanged = batchBase !== html;
    const pageChanged = JSON.stringify(batchBasePage) !== JSON.stringify(page);
    set({
      inBatch: false,
      batchBase: null,
      batchBasePage: null,
      ...((htmlChanged || pageChanged) ? {
        history: [...history, { html: batchBase, page: batchBasePage || page }].slice(-MAX_HISTORY),
        future: [],
        dirty: true,
      } : {}),
    });
  },

  // Replace html AND force canvas re-render (AI edit / structural change).
  reloadHtml: (newHtml) => {
    const { html, page } = get();
    const history = [...get().history, { html, page }].slice(-MAX_HISTORY);
    set({ html: newHtml, history, future: [], htmlVersion: get().htmlVersion + 1, dirty: true });
  },

  undo: () => {
    const { history, future, html, page, designSystemCss, palette, _fromSnap } = get();
    if (history.length === 0) return;
    const prev = _fromSnap(history[history.length - 1]);
    const hasCss = prev.css !== undefined;
    set({
      html: prev.html,
      page: prev.page,
      ...(hasCss ? {
        designSystemCss: prev.css,
        palette: prev.palette,
        paletteRestored: { css: prev.css, palette: prev.palette },
      } : {}),
      history: history.slice(0, -1),
      future: [{ html, page, ...(hasCss ? { css: designSystemCss, palette } : {}) }, ...future].slice(0, MAX_HISTORY),
      htmlVersion: get().htmlVersion + 1,
      dirty: true,
      selectedId: null,
      selectedIds: [],
    });
  },

  redo: () => {
    const { history, future, html, page, designSystemCss, palette, _fromSnap } = get();
    if (future.length === 0) return;
    const next = _fromSnap(future[0]);
    const hasCss = next.css !== undefined;
    set({
      html: next.html,
      page: next.page,
      ...(hasCss ? {
        designSystemCss: next.css,
        palette: next.palette,
        paletteRestored: { css: next.css, palette: next.palette },
      } : {}),
      future: future.slice(1),
      history: [...history, { html, page, ...(hasCss ? { css: designSystemCss, palette } : {}) }].slice(-MAX_HISTORY),
      htmlVersion: get().htmlVersion + 1,
      dirty: true,
      selectedId: null,
      selectedIds: [],
    });
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
  setSelection: (ids) =>
    set({ selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null }),
  toggleSelect: (id) => {
    const cur = get().selectedIds;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ selectedIds: next, selectedId: next.length ? next[next.length - 1] : null });
  },
  setTool: (tool) => set({ tool }),
  setSpaceDown: (v) => set({ spaceDown: v }),
  setClipboard: (clipboard) => set({ clipboard }),

  fitOnLoad: true,
  setFitOnLoad: (v) => set({ fitOnLoad: v }),
  // restore editor metadata + view from a persisted canvas_state
  restore: (cs) =>
    set({
      names: cs?.names || {},
      hiddenIds: cs?.hiddenIds || {},
      lockedIds: cs?.lockedIds || {},
      ...(cs?.zoom ? { zoom: cs.zoom } : {}),
      ...(cs?.pan ? { pan: cs.pan } : {}),
      fitOnLoad: !(cs && cs.zoom),
      ...(cs?.page ? {
        page: {
          ...cs.page,
          background: cs.page.background === "#EAEAEA" ? "" : (cs.page.background || ""),
        },
      } : {}),
      ...(cs?.colorStyles ? { colorStyles: cs.colorStyles } : {}),
      ...(cs?.styles ? { styles: cs.styles } : {}),
    }),
  canvasState: () => {
    const s = get();
    return {
      names: s.names,
      hiddenIds: s.hiddenIds,
      lockedIds: s.lockedIds,
      zoom: s.zoom,
      pan: s.pan,
      page: s.page,
      colorStyles: s.colorStyles,
      styles: s.styles,
    };
  },

  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.1, zoom)) }),
  setPan: (pan) => set({ pan }),

  toggleHidden: (id) =>
    set((s) => ({ hiddenIds: { ...s.hiddenIds, [id]: !s.hiddenIds[id] }, dirty: true })),
  toggleLock: (id) =>
    set((s) => ({ lockedIds: { ...s.lockedIds, [id]: !s.lockedIds[id] }, dirty: true })),
  rename: (id, name) => set((s) => ({ names: { ...s.names, [id]: name }, dirty: true })),

  setGenerating: (v) => set({ generating: v }),
  setAiBusy: (v) => set({ aiBusy: v }),
  setDirty: (v) => set({ dirty: v }),

  reset: () =>
    set({
      project: null,
      html: "",
      htmlVersion: 0,
      designSystemCss: "",
      palette: null,
      paletteRestored: null,
      selectedId: null,
      selectedIds: [],
      tool: "select",
      clipboard: [],
      hiddenIds: {},
      lockedIds: {},
      names: {},
      history: [],
      future: [],
      inBatch: false,
      batchBase: null,
      batchBasePage: null,
      liveSize: null,
      aspectLocked: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      page: { background: "" },
      colorStyles: [],
      styles: [],
      recentColors: [],
      dirty: false,
    }),
}));
