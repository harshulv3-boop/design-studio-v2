import { useEffect, useRef, useState, useCallback } from "react";
import { useEditorStore } from "@/store/editorStore";
import { findEl, ensureIdsOnElement, sanitizeHtml, classifyElement } from "@/lib/pro/htmlUtils";
import { PhoneScreenFrame } from "@/components/PhoneScreenFrame";
import { PHONE_FRAME } from "@/components/PhoneScreenRenderer";
import Toolbar from "@/components/editor/Toolbar";
import ContextMenu from "@/components/editor/ContextMenu";

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const HANDLES = [
  { k: "nw", x: 0, y: 0, cursor: "nwse-resize", dx: -1, dy: -1 },
  { k: "n", x: 0.5, y: 0, cursor: "ns-resize", dx: 0, dy: -1 },
  { k: "ne", x: 1, y: 0, cursor: "nesw-resize", dx: 1, dy: -1 },
  { k: "e", x: 1, y: 0.5, cursor: "ew-resize", dx: 1, dy: 0 },
  { k: "se", x: 1, y: 1, cursor: "nwse-resize", dx: 1, dy: 1 },
  { k: "s", x: 0.5, y: 1, cursor: "ns-resize", dx: 0, dy: 1 },
  { k: "sw", x: 0, y: 1, cursor: "nesw-resize", dx: -1, dy: 1 },
  { k: "w", x: 0, y: 0.5, cursor: "ew-resize", dx: -1, dy: 0 },
];

// Preserves flip state (data-mae-flip-x / data-mae-flip-y) when updating position.
function applyPos(el, x, y) {
  const fX = el.dataset.maeFlipX === "1" ? " scaleX(-1)" : "";
  const fY = el.dataset.maeFlipY === "1" ? " scaleY(-1)" : "";
  el.style.transform = `translate(${x}px, ${y}px)${fX}${fY}`;
}

export default function Canvas() {
  const pageRef = useRef(null);
  const viewportRef = useRef(null);
  const imgInputRef = useRef(null);

  // Website imports need a fixed-width container so that CSS `width: 100%`
  // and `max-width` on captured elements resolve against the captured viewport
  // width rather than collapsing against an unsized inline-block parent.
  const _project = useEditorStore((s) => s.project);
  const isWebsite = _project?.format_config?.artifactType === "website";
  const frameWidth = _project?.format_config?.frame?.width || null;
  const platform = _project?.platform === "android" ? "android" : "ios";

  const htmlVersion = useEditorStore((s) => s.htmlVersion);
  const html = useEditorStore((s) => s.html);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const zoom = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const hiddenIds = useEditorStore((s) => s.hiddenIds);
  const lockedIds = useEditorStore((s) => s.lockedIds);
  const tool = useEditorStore((s) => s.tool);
  const spaceDown = useEditorStore((s) => s.spaceDown);
  const pageMeta = useEditorStore((s) => s.page);
  // Read design-system CSS directly off the project — single source of truth,
  // same access path as Lite. No intermediate cached copy that can go stale.
  const designSystemCss = useEditorStore((s) => s.project?.designSystemCss || "");

  const [rects, setRects] = useState([]);
  const [editing, setEditing] = useState(false);
  const [marquee, setMarquee] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [guides, setGuides] = useState([]);
  // Below-the-fold scrolling. The phone screen keeps its NATIVE layout: a fixed
  // 375x812 flex column with a pinned header (status/nav) and a pinned bottom
  // tab bar, and a scrolling content region in between. We drive that content
  // region's scrollTop from a custom scrollbar beside the frame (never native
  // wheel/touch inside the phone, so it never conflicts with select/drag). The
  // header and tab bar stay pinned exactly like a real phone.
  const [scrollY, setScrollY] = useState(0);
  const [maxScroll, setMaxScroll] = useState(0);
  const [scrollClient, setScrollClient] = useState(PHONE_FRAME.height);
  const scrollTargetRef = useRef(null);
  const scrollBarDragRef = useRef(null);
  const scrollObsRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const marqueeRef = useRef(null);
  const rafRef = useRef(null);
  const cycleRef = useRef({ x: null, y: null, candidates: [], idx: 0 });
  // Tracks the last frame element that had a drop-indicator outline applied
  const dragOverFrameRef = useRef(null);

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const store = () => useEditorStore.getState();
  const commit = useCallback(() => {
    if (pageRef.current) store().commitDom(pageRef.current.innerHTML);
  }, []);

  const orderedIds = () =>
    Array.from(pageRef.current?.querySelectorAll("[data-mae-id]") || []).map((e) =>
      e.getAttribute("data-mae-id")
    );

  const rootEl = () => pageRef.current?.firstElementChild || pageRef.current;

  // ---- compute selection rects for all selected ids
  const recompute = useCallback(() => {
    const page = pageRef.current;
    if (!page) return setRects([]);
    const ids = store().selectedIds;
    const z = store().zoom;
    const pr = page.getBoundingClientRect();
    const next = [];
    ids.forEach((id) => {
      const el = findEl(page, id);
      if (!el) return;
      const er = el.getBoundingClientRect();
      next.push({
        id,
        left: (er.left - pr.left) / z,
        top: (er.top - pr.top) / z,
        width: er.width / z,
        height: er.height / z,
      });
    });
    setRects(next);
  }, []);

  // ---- below-the-fold scroll --------------------------------------------
  // Find the inner content region that scrolls — the flex-growing area between
  // the pinned header and the pinned tab bar. We pick the descendant with the
  // largest vertical overflow whose overflowY permits scrolling (auto/scroll/
  // hidden — overflow:hidden is still programmatically scrollable). Driving
  // THIS element's scrollTop (never the whole screen) is what keeps the header
  // and tab bar pinned, exactly like a native phone.
  const findScrollEl = useCallback(() => {
    const page = pageRef.current;
    if (!page) return null;
    let best = null;
    let bestOver = 4; // ignore sub-pixel overflow
    page.querySelectorAll("*").forEach((el) => {
      const over = el.scrollHeight - el.clientHeight;
      if (over <= bestOver) return;
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "hidden") {
        bestOver = over;
        best = el;
      }
    });
    return best;
  }, []);

  const measureScroll = useCallback(() => {
    const el = scrollTargetRef.current;
    if (!el || !pageRef.current?.contains(el)) {
      setMaxScroll(0);
      return;
    }
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    setMaxScroll(max);
    setScrollClient(el.clientHeight || PHONE_FRAME.height);
    if (el.scrollTop > max) {
      el.scrollTop = max;
      setScrollY(max);
    }
  }, []);

  // Set the content region's scroll position, then recompute overlays so
  // selection boxes / handles / guides track the moved elements (they all read
  // live getBoundingClientRect, which already reflects scrollTop).
  const setScroll = useCallback((y) => {
    const el = scrollTargetRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const clamped = clamp(y, 0, max);
    el.scrollTop = clamped;
    setScrollY(clamped);
    recompute();
  }, [recompute]);

  // ---- imperative (re)render
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    // CSS @media (max-width: N) rules evaluate against window.innerWidth, not
    // against our fixed-width canvas container. The canvas viewport is narrower
    // than 1440px (browser window minus sidebar), so mobile breakpoints fire and
    // the captured desktop page collapses to single-column mobile layout.
    // Fix: append 'and (min-width: 9999px)' to any @media rule whose condition
    // has only max-width (no min-width). Only runs when <style> elements are
    // present — AI-generated screens use inline styles only.
    const styleEls = page.querySelectorAll("style");
    if (styleEls.length > 0) {
      styleEls.forEach((styleEl) => {
        styleEl.textContent = styleEl.textContent.replace(
          /(@media\s+)([^{]+?)(\s*\{)/g,
          (full, prefix, condition, suffix) => {
            if (/\bmax-width\b/.test(condition) && !/\bmin-width\b/.test(condition)) {
              return `${prefix}${condition.trimEnd()} and (min-width: 9999px)${suffix}`;
            }
            return full;
          }
        );
      });
    }

    setEditing(false);
    // New screen/content: locate its scrolling content region, reset to the top.
    setScrollY(0);
    setMaxScroll(0);
    scrollTargetRef.current = null;
    scrollObsRef.current?.disconnect();
    scrollObsRef.current = null;
    requestAnimationFrame(() => {
      const scrollEl = findScrollEl();
      scrollTargetRef.current = scrollEl;
      if (scrollEl) {
        scrollEl.scrollTop = 0;
        // Re-measure when the content region's height changes (edits, image
        // loads, font swaps).
        if (typeof ResizeObserver !== "undefined") {
          const ro = new ResizeObserver(() => measureScroll());
          ro.observe(scrollEl);
          if (scrollEl.firstElementChild) ro.observe(scrollEl.firstElementChild);
          scrollObsRef.current = ro;
        }
      }
      measureScroll();
      if (store().fitOnLoad) {
        if (isWebsite) {
          // Websites scroll vertically — fit to width only, not height.
          // Using min(width-fit, height-fit) on a 1440×8000px page in a 900px
          // viewport gives ~10% zoom, making everything microscopic.
          const vp = viewportRef.current;
          const cw = page.scrollWidth || frameWidth || 1440;
          const pad = 80;
          const z = clamp((vp.clientWidth - pad) / cw, 0.1, 2);
          store().setZoom(z);
          store().setPan({ x: (vp.clientWidth - cw * z) / 2, y: pad / 2 });
        } else {
          fitToScreen();
        }
      }
      recompute();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlVersion]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    page.querySelectorAll("[data-mae-id]").forEach((el) => {
      el.style.visibility = hiddenIds[el.getAttribute("data-mae-id")] ? "hidden" : "";
    });
  }, [hiddenIds, htmlVersion]);

  useEffect(() => {
    recompute();
    measureScroll();
  }, [selectedIds, zoom, pan, recompute, measureScroll]);


  // Canvas background is applied inline on the viewport div via JSX style below.

  // Reset selection cycle on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") cycleRef.current = { x: null, y: null, candidates: [], idx: 0 };
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tear down the scroll ResizeObserver on unmount.
  useEffect(() => () => scrollObsRef.current?.disconnect(), []);

  // ============================================================ OPERATIONS
  const fitToScreen = useCallback(() => {
    const vp = viewportRef.current;
    const page = pageRef.current;
    if (!vp || !page) return;
    const cw = page.scrollWidth || 1;
    const ch = page.scrollHeight || 1;
    const pad = 80;
          const z = clamp(
      Math.min((vp.clientWidth - pad) / cw, (vp.clientHeight - pad) / ch),
      0.1,
            1
    );
    store().setZoom(z);
    store().setPan({ x: (vp.clientWidth - cw * z) / 2, y: (vp.clientHeight - ch * z) / 2 });
  }, []);

  const zoomToSelection = useCallback(() => {
    const vp = viewportRef.current;
    const page = pageRef.current;
    const ids = store().selectedIds;
    if (!vp || !page || !ids.length) return fitToScreen();
    const pr = page.getBoundingClientRect();
    const z0 = store().zoom;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach((id) => {
      const el = findEl(page, id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      minX = Math.min(minX, (r.left - pr.left) / z0);
      minY = Math.min(minY, (r.top - pr.top) / z0);
      maxX = Math.max(maxX, (r.right - pr.left) / z0);
      maxY = Math.max(maxY, (r.bottom - pr.top) / z0);
    });
    const w = maxX - minX, h = maxY - minY;
    const pad = 120;
    const z = clamp(Math.min((vp.clientWidth - pad) / w, (vp.clientHeight - pad) / h), 0.1, 4);
    store().setZoom(z);
    store().setPan({
      x: vp.clientWidth / 2 - (minX + w / 2) * z,
      y: vp.clientHeight / 2 - (minY + h / 2) * z,
    });
  }, [fitToScreen]);

  const deleteSelected = useCallback(() => {
    const ids = store().selectedIds;
    if (!ids.length) return;
    ids.forEach((id) => findEl(pageRef.current, id)?.remove());
    store().select(null);
    commit();
    setRects([]);
  }, [commit]);

  const duplicateSelected = useCallback(() => {
    const ids = store().selectedIds;
    if (!ids.length) return [];
    const newIds = [];
    ids.forEach((id) => {
      const el = findEl(pageRef.current, id);
      if (!el) return;
      const clone = el.cloneNode(true);
      [clone, ...clone.querySelectorAll("*")].forEach((n) => n.removeAttribute("data-mae-id"));
      ensureIdsOnElement(clone);
      const tx = parseFloat(el.dataset.maeX || "0") + 24;
      const ty = parseFloat(el.dataset.maeY || "0") + 24;
      clone.dataset.maeX = tx;
      clone.dataset.maeY = ty;
      applyPos(clone, tx, ty);
      el.after(clone);
      newIds.push(clone.getAttribute("data-mae-id"));
    });
    store().setSelection(newIds);
    commit();
    requestAnimationFrame(recompute);
    return newIds;
  }, [commit, recompute]);

  const copySelected = useCallback(() => {
    const ids = store().selectedIds;
    const clips = ids
      .map((id) => {
        const el = findEl(pageRef.current, id);
        if (!el) return null;
        return { html: el.outerHTML, parentId: el.parentElement?.getAttribute("data-mae-id") || null };
      })
      .filter(Boolean);
    if (clips.length) store().setClipboard(clips);
  }, []);

  const paste = useCallback(() => {
    const clips = store().clipboard;
    if (!clips.length) return;
    const newIds = [];
    clips.forEach((clip) => {
      const tmp = document.createElement("div");
      tmp.innerHTML = clip.html.trim();
      const el = tmp.firstElementChild;
      if (!el) return;
      [el, ...el.querySelectorAll("*")].forEach((n) => n.removeAttribute("data-mae-id"));
      ensureIdsOnElement(el);
      const tx = parseFloat(el.dataset.maeX || "0") + 20;
      const ty = parseFloat(el.dataset.maeY || "0") + 20;
      el.dataset.maeX = tx;
      el.dataset.maeY = ty;
      applyPos(el, tx, ty);
      const parent = (clip.parentId && findEl(pageRef.current, clip.parentId)) || rootEl();
      parent.appendChild(el);
      newIds.push(el.getAttribute("data-mae-id"));
    });
    store().setSelection(newIds);
    commit();
    requestAnimationFrame(recompute);
  }, [commit, recompute]);

  const cut = useCallback(() => {
    copySelected();
    deleteSelected();
  }, [copySelected, deleteSelected]);

  const nudge = useCallback(
    (dx, dy) => {
      const ids = store().selectedIds;
      if (!ids.length) return;
      ids.forEach((id) => {
        const el = findEl(pageRef.current, id);
        if (!el || store().lockedIds[id]) return;
        const x = parseFloat(el.dataset.maeX || "0") + dx;
        const y = parseFloat(el.dataset.maeY || "0") + dy;
        el.dataset.maeX = x;
        el.dataset.maeY = y;
        applyPos(el, x, y);
      });
      commit();
      recompute();
    },
    [commit, recompute]
  );

  // DOM-based layer ordering (Figma semantics).
  // Reorders elements among their siblings WITHOUT modifying any of:
  //   transform / position / x / y / width / height / rotation / scale.
  // Later siblings render on top in HTML, so:
  //   - "forward" -> move after next sibling
  //   - "backward" -> move before previous sibling
  //   - "front" -> append as last child of parent
  //   - "back" -> insert as first child of parent
  // Locked elements are skipped. Elements are processed in document order
  // so multi-selects move predictably and don't fight each other.
  const order = useCallback(
    (kind) => {
      const ids = store().selectedIds;
      if (!ids.length) return;
      const els = ids
        .map((id) => findEl(pageRef.current, id))
        .filter((el) => el && !store().lockedIds[el.getAttribute("data-mae-id")]);
      if (!els.length) return;
      els.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
      const list = kind === "forward" || kind === "front" ? [...els].reverse() : els;
      list.forEach((el) => {
        const parent = el.parentElement;
        if (!parent) return;
        if (kind === "front") {
          parent.appendChild(el);
        } else if (kind === "back") {
          parent.insertBefore(el, parent.firstChild);
        } else if (kind === "forward") {
          const next = el.nextElementSibling;
          if (next) parent.insertBefore(next, el);
        } else if (kind === "backward") {
          const prev = el.previousElementSibling;
          if (prev) parent.insertBefore(el, prev);
        }
      });
      commit();
      requestAnimationFrame(recompute);
    },
    [commit, recompute]
  );

  const replaceSelectedHtml = useCallback(
    (newHtml) => {
      const el = findEl(pageRef.current, store().selectedId);
      if (!el) return;
      const tmp = document.createElement("div");
      tmp.innerHTML = sanitizeHtml(newHtml).trim();
      const newEl = tmp.firstElementChild;
      if (!newEl) return;
      if (!newEl.getAttribute("data-mae-id")) newEl.setAttribute("data-mae-id", store().selectedId);
      ensureIdsOnElement(newEl);
      el.replaceWith(newEl);
      store().select(newEl.getAttribute("data-mae-id"));
      commit();
      requestAnimationFrame(recompute);
    },
    [commit, recompute]
  );

  // Find the correct parent for a newly inserted element.
  // Only Frames (data-mae-type="frame") and untyped imported-HTML containers
  // can accept children. Pure shapes (rect, ellipse, text, image) are skipped.
  const findDropParent = (clientX, clientY) => {
    const page = pageRef.current;
    if (!page) return page;
    const hit = document.elementFromPoint(clientX, clientY);
    if (!hit || !page.contains(hit)) return page;
    let el = hit;
    while (el && el !== page) {
      if (el.hasAttribute("data-mae-id")) {
        const t = el.dataset.maeType;
        // Only frames (and untyped imported containers) accept children
        if (!t || t === "frame") return el;
        // Pure shapes skip upward
      }
      el = el.parentElement;
    }
    return page;
  };

  // After a drag-move, reparent the element to the correct container.
  //
  // IMPORTANT: this runs while overflow:visible is still set on all containers
  // (overflow is restored in onPointerUp AFTER this call). That ensures
  // getBoundingClientRect() returns the full unclipped element rect so the
  // element-centre test is accurate.
  //
  // Algorithm (Figma-style):
  //   1. Use the element's visual CENTRE to find the deepest frame/container.
  //      The centre is the most stable proxy for "which box does this element live in".
  //   2. Fall back to the cursor release position if the centre hits nothing.
  //   3. Fall back to page root.
  const reparentIfNeeded = (el, cursorX, cursorY) => {
    const page = pageRef.current;
    if (!page) return;
    const z = store().zoom;

    // elRect is correct because overflow:visible is still set (unclipped rect).
    const elRect = el.getBoundingClientRect();
    const centerX = elRect.left + elRect.width / 2;
    const centerY = elRect.top + elRect.height / 2;

    // Helper: deepest frame/untyped container at a screen point, skipping
    // the dragged element and its descendants.
    const findContainer = (px, py) => {
      const hits = document.elementsFromPoint(px, py);
      for (const h of hits) {
        if (!page.contains(h) || !h.hasAttribute("data-mae-id")) continue;
        if (h === el || el.contains(h)) continue;
        const t = h.dataset.maeType;
        if (!t || t === "frame") return h;
      }
      return null;
    };

    // 1) element centre → 2) cursor position → 3) page root
    const targetParent = findContainer(centerX, centerY) ?? findContainer(cursorX, cursorY) ?? null;
    const newParent = targetParent || page;
    const currentParent = el.parentElement;
    if (newParent === currentParent) return;

    // Convert element screen position to new-parent-relative coordinates.
    const parentRect = newParent.getBoundingClientRect();
    const newX = Math.round((elRect.left - parentRect.left) / z);
    const newY = Math.round((elRect.top - parentRect.top) / z);
    el.dataset.maeX = newX;
    el.dataset.maeY = newY;
    applyPos(el, newX, newY);
    // Ensure the element is absolutely positioned so transform:translate works
    // correctly within any parent (flex, grid, block, etc.).
    el.style.position = "absolute";
    newParent.appendChild(el);
  };

  // Programmatic reparent: move element `draggedId` to become a child of
  // `targetId` (or page root if targetId is null), preserving visual position.
  // Used by the Layers panel drag-drop.
  const reparentTo = useCallback((draggedId, targetId) => {
    const page = pageRef.current;
    if (!page) return;
    const draggedEl = findEl(page, draggedId);
    const targetEl = targetId ? findEl(page, targetId) : page;
    if (!draggedEl || !targetEl) return;
    if (draggedEl.contains(targetEl)) return; // can't drop into own descendant
    if (draggedEl.parentElement === targetEl) return; // already a child

    const z = store().zoom;
    const dragRect = draggedEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const newX = Math.round((dragRect.left - targetRect.left) / z);
    const newY = Math.round((dragRect.top - targetRect.top) / z);
    draggedEl.dataset.maeX = newX;
    draggedEl.dataset.maeY = newY;
    applyPos(draggedEl, newX, newY);
    // Ensure absolute positioning so translate works regardless of container layout.
    draggedEl.style.position = "absolute";
    targetEl.appendChild(draggedEl);
    store().select(draggedId);
    commit();
    requestAnimationFrame(recompute);
  }, [commit, recompute]);

  const insertElement = useCallback(
    (type, clientX, clientY, src) => {
      const page = pageRef.current;
      if (!page) return;
      const pr = page.getBoundingClientRect();
      const z = store().zoom;
      const x = Math.round((clientX - pr.left) / z);
      const y = Math.round((clientY - pr.top) / z);
      let el;
      if (type === "text") {
        el = document.createElement("div");
        el.textContent = "Text";
        el.style.cssText = "font-size:24px;color:#111111;font-family:inherit;";
        el.dataset.maeType = "text";
      } else if (type === "rect") {
        el = document.createElement("div");
        // Rectangles default to 0 border-radius (like Figma)
        el.style.cssText = "width:160px;height:100px;background:#6366f1;border-radius:0px;";
        el.dataset.maeType = "rect";
      } else if (type === "frame") {
        el = document.createElement("div");
        el.style.cssText = "width:400px;height:300px;background:#ffffff;overflow:hidden;";
        el.dataset.maeType = "frame";
      } else if (type === "ellipse") {
        el = document.createElement("div");
        el.style.cssText = "width:120px;height:120px;background:#22c55e;border-radius:9999px;";
        el.dataset.maeType = "ellipse";
      } else if (type === "image") {
        el = document.createElement("img");
        el.setAttribute(
          "src",
          src ||
            "data:image/svg+xml;utf8," +
              encodeURIComponent(
                "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'><rect width='100%' height='100%' fill='%23e5e7eb'/><text x='50%' y='50%' font-size='12' fill='%239ca3af' text-anchor='middle' dy='.3em'>Image</text></svg>"
              )
        );
        el.style.cssText = "width:160px;height:120px;object-fit:cover;";
        el.dataset.maeType = "image";
      }
      el.style.position = "absolute";
      el.style.left = "0px";
      el.style.top = "0px";

      // Determine parent based on geometry: use the deepest container at the
      // click point so elements land inside frames they're drawn into.
      const parent = findDropParent(clientX, clientY);

      // Convert x/y (page-root-relative) to parent-relative coordinates.
      let relX = x, relY = y;
      if (parent !== page) {
        const parentRect = parent.getBoundingClientRect();
        relX = Math.round((clientX - parentRect.left) / z);
        relY = Math.round((clientY - parentRect.top) / z);
      }

      el.dataset.maeX = relX;
      el.dataset.maeY = relY;
      applyPos(el, relX, relY);
      ensureIdsOnElement(el);
      parent.appendChild(el);
      store().select(el.getAttribute("data-mae-id"));
      store().setTool("select");
      commit();
      requestAnimationFrame(() => {
        recompute();
        if (type === "text") startEditing();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, recompute]
  );

  const selectStep = useCallback(
    (dir) => {
      const ids = orderedIds();
      if (!ids.length) return;
      const cur = store().selectedId;
      let idx = ids.indexOf(cur);
      idx = idx === -1 ? 0 : (idx + dir + ids.length) % ids.length;
      store().select(ids[idx]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Figma-style Ctrl+A: select every element inside the active canvas only.
  // Walks all data-mae-id descendants of the page root and keeps only the
  // outermost ones (no parent in the hit set) so children of a selected
  // ancestor are NOT redundantly selected.
  const selectAll = useCallback(() => {
    const page = pageRef.current;
    if (!page) return;
    const all = Array.from(page.querySelectorAll("[data-mae-id]"));
    if (!all.length) return;
    const set = new Set(all);
    const outer = all.filter((el) => {
      let p = el.parentElement;
      while (p && p !== page) {
        if (set.has(p)) return false;
        p = p.parentElement;
      }
      return true;
    });
    const ids = outer.map((el) => el.getAttribute("data-mae-id"));
    store().setSelection(ids);
  }, []);

  const flipH = useCallback(() => {
    const ids = store().selectedIds;
    if (!ids.length) return;
    ids.forEach((id) => {
      const el = findEl(pageRef.current, id);
      if (!el || store().lockedIds[id]) return;
      el.dataset.maeFlipX = el.dataset.maeFlipX === "1" ? "0" : "1";
      applyPos(el, parseFloat(el.dataset.maeX || "0"), parseFloat(el.dataset.maeY || "0"));
    });
    commit();
    requestAnimationFrame(recompute);
  }, [commit, recompute]);

  const flipV = useCallback(() => {
    const ids = store().selectedIds;
    if (!ids.length) return;
    ids.forEach((id) => {
      const el = findEl(pageRef.current, id);
      if (!el || store().lockedIds[id]) return;
      el.dataset.maeFlipY = el.dataset.maeFlipY === "1" ? "0" : "1";
      applyPos(el, parseFloat(el.dataset.maeX || "0"), parseFloat(el.dataset.maeY || "0"));
    });
    commit();
    requestAnimationFrame(recompute);
  }, [commit, recompute]);

  const group = useCallback(() => {
    const ids = store().selectedIds;
    if (ids.length < 2) return;
    const els = ids.map((id) => findEl(pageRef.current, id)).filter(Boolean);
    if (!els.length) return;
    const parent = els[0].parentElement;
    if (!els.every((e) => e.parentElement === parent)) return;
    els.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
    const page = pageRef.current;
    const pr = page.getBoundingClientRect();
    const z = store().zoom;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      const x = (r.left - pr.left) / z, y = (r.top - pr.top) / z;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + r.width / z);
      maxY = Math.max(maxY, y + r.height / z);
    });
    const grp = document.createElement("div");
    grp.style.cssText = `position:absolute;left:0;top:0;width:${Math.round(maxX - minX)}px;height:${Math.round(maxY - minY)}px;`;
    grp.dataset.maeX = Math.round(minX);
    grp.dataset.maeY = Math.round(minY);
    applyPos(grp, Math.round(minX), Math.round(minY));
    parent.insertBefore(grp, els[0]);
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      const cx = Math.round((r.left - pr.left) / z - minX);
      const cy = Math.round((r.top - pr.top) / z - minY);
      el.dataset.maeX = cx;
      el.dataset.maeY = cy;
      applyPos(el, cx, cy);
      grp.appendChild(el);
    });
    ensureIdsOnElement(grp);
    store().select(grp.getAttribute("data-mae-id"));
    commit();
    requestAnimationFrame(recompute);
  }, [commit, recompute]);

  const pasteToReplace = useCallback(() => {
    const clips = store().clipboard;
    const targetId = store().selectedId;
    if (!clips.length || !targetId) return paste();
    const target = findEl(pageRef.current, targetId);
    if (!target) return paste();
    const clip = clips[0];
    const tmp = document.createElement("div");
    tmp.innerHTML = clip.html.trim();
    const newEl = tmp.firstElementChild;
    if (!newEl) return;
    const tx = parseFloat(target.dataset.maeX || "0");
    const ty = parseFloat(target.dataset.maeY || "0");
    const tw = target.offsetWidth, th = target.offsetHeight;
    [newEl, ...newEl.querySelectorAll("*")].forEach((n) => n.removeAttribute("data-mae-id"));
    ensureIdsOnElement(newEl);
    newEl.dataset.maeX = tx;
    newEl.dataset.maeY = ty;
    applyPos(newEl, tx, ty);
    newEl.style.width = `${tw}px`;
    newEl.style.height = `${th}px`;
    target.replaceWith(newEl);
    store().select(newEl.getAttribute("data-mae-id"));
    commit();
    requestAnimationFrame(recompute);
  }, [commit, paste, recompute]);

  // Only these element types can enter inline text-edit mode (Figma parity).
  // Elements with a known non-text data-mae-type are always blocked.
  // Untyped imported HTML elements are allowed only if they are leaf nodes
  // (no data-mae-id children) — i.e. they are not used as containers.
  const isTextEditable = (el) => {
    if (!el) return false;
    const t = el.dataset?.maeType;
    if (t === "text") return true;
    if (t) return false; // rect, frame, ellipse, image
    // Imported HTML: allow editing if element has no editor-children (leaf)
    return el.querySelector("[data-mae-id]") === null;
  };

  // ---- inline text editing
  const startEditing = useCallback(() => {
    const id = store().selectedId;
    const el = findEl(pageRef.current, id);
    if (!el || store().lockedIds[id]) return;
    if (!isTextEditable(el)) return;
    // Lock the element's width before making it editable so the browser's
    // contenteditable behaviour cannot reflow the element to a different size.
    if (!el.style.width) el.style.width = `${el.offsetWidth}px`;
    setEditing(true);
    el.setAttribute("contenteditable", "true");
    el.focus();
    const finish = () => {
      el.removeAttribute("contenteditable");
      el.removeEventListener("blur", finish);
      setEditing(false);
      commit();
      requestAnimationFrame(recompute);
    };
    el.addEventListener("blur", finish);
  }, [commit, recompute]);

  // register ops
  useEffect(() => {
    useEditorStore.setState({
      ops: {
        fitToScreen,
        zoomIn: () => store().setZoom(store().zoom * 1.2),
        zoomOut: () => store().setZoom(store().zoom / 1.2),
        resetZoom: () => store().setZoom(1),
        zoomToSelection,
        deleteSelected,
        duplicateSelected,
        copySelected,
        cut,
        paste,
        pasteToReplace,
        nudge,
        bringForward: () => order("forward"),
        sendBackward: () => order("backward"),
        bringToFront: () => order("front"),
        sendToBack: () => order("back"),
        group,
        flipH,
        flipV,
        replaceSelectedHtml,
        insertElement,
        openImagePicker: () => imgInputRef.current?.click(),
        selectNext: () => selectStep(1),
        selectPrev: () => selectStep(-1),
        selectAll,
        startEditingSelected: startEditing,
        startRename: () => {
          const id = useEditorStore.getState().selectedId;
          if (id) window.dispatchEvent(new CustomEvent("mae:rename", { detail: { id } }));
        },
        getEl: (id) => findEl(pageRef.current, id),
        getPageRoot: () => pageRef.current,
        commit,
        recompute,
        reparentTo,
        startBatch: () => store().startBatch(),
        endBatch: () => store().endBatch(),
      },
    });
  }, [
    fitToScreen, zoomToSelection, deleteSelected, duplicateSelected, copySelected, cut,
    paste, pasteToReplace, nudge, order, group, flipH, flipV,
    replaceSelectedHtml, insertElement, selectStep, selectAll,
    startEditing, commit, recompute, reparentTo,
  ]);

  // ============================================================ POINTER
  // Unified click handler on the wrapper div — covers BOTH pageRef HTML content
  // AND the overlay selection boxes (which are siblings of pageRef, so
  // onClickCapture on pageRef itself never fires for overlay clicks).
  const onPageClickCapture = (e) => {
    if (editing) return;
    if (store().tool !== "select") return;
    // Resize handle clicks must not trigger cycling — they start resize drags.
    if ((e.target.dataset?.testid || "").startsWith("resize-")) return;
    e.preventDefault();
    e.stopPropagation();

    // Double-click (detail=2): advance the cycle one level deeper (enter child),
    // then let the dblclick event fire startEditing. Do NOT skip it.

    const page = pageRef.current;
    if (!page) return;

    // Always use elementsFromPoint — works regardless of whether the click
    // landed on the HTML content or on an overlay selection box above it.
    const depthOf = (el) => {
      let d = 0, cur = el;
      while (cur && cur !== page) { d++; cur = cur.parentElement; }
      return d;
    };
    const rawHits = document.elementsFromPoint(e.clientX, e.clientY)
      .filter((el) => page.contains(el) && el !== page && el.hasAttribute("data-mae-id"));
    // Deepest-first: a fresh click selects the most specific element actually
    // under the cursor (the clicked child), not the outermost screen wrapper.
    // Clicking empty screen background still resolves to the screen (only hit),
    // and repeat clicks at the same spot cycle outward to the parent.
    rawHits.sort((a, b) => depthOf(b) - depthOf(a));

    if (e.shiftKey) {
      // Toggle the shallowest element at the click point.
      const t = rawHits[0];
      if (!t) return;
      store().toggleSelect(t.getAttribute("data-mae-id"));
      cycleRef.current = { x: null, y: null, candidates: [], idx: 0 };
      return;
    }

    if (!rawHits.length) {
      store().select(null);
      cycleRef.current = { x: null, y: null, candidates: [], idx: 0 };
      return;
    }

    const cx = cycleRef.current;
    const THRESHOLD = 5;
    const sameSpot =
      cx.x !== null &&
      Math.abs(e.clientX - cx.x) < THRESHOLD &&
      Math.abs(e.clientY - cx.y) < THRESHOLD &&
      cx.candidates.length > 0;

    const candidates = rawHits.map((el) => el.getAttribute("data-mae-id"));
    const nextIdx = sameSpot ? (cx.idx + 1) % candidates.length : 0;

    cycleRef.current = { x: e.clientX, y: e.clientY, candidates, idx: nextIdx };
    store().select(candidates[nextIdx]);
  };

  const onBoxPointerDown = (e, id) => {
    if (store().spaceDown) return;
    // Second click of a double-click: advance the cycle one level deeper.
    // onPageClickCapture won't see this because the overlay intercepts it, so
    // we handle cycle advancement here before letting onDoubleClick fire.
    if (e.detail > 1) {
      const page = pageRef.current;
      if (page) {
        const depthOf = (el) => { let d = 0, cur = el; while (cur && cur !== page) { d++; cur = cur.parentElement; } return d; };
        const rawHits = document.elementsFromPoint(e.clientX, e.clientY)
          .filter((el) => page.contains(el) && el !== page && el.hasAttribute("data-mae-id"));
        rawHits.sort((a, b) => depthOf(b) - depthOf(a));
        if (rawHits.length > 1) {
          const candidates = rawHits.map((el) => el.getAttribute("data-mae-id"));
          const cx = cycleRef.current;
          const nextIdx = (cx.idx + 1) % candidates.length;
          cycleRef.current = { x: e.clientX, y: e.clientY, candidates, idx: nextIdx };
          store().select(candidates[nextIdx]);
        }
      }
      return;
    }
    e.stopPropagation();
    // Figma-style shift+click: toggle this element in/out of selection
    // without starting a drag. Plain click on an already-selected element
    // keeps the selection (so multi-drag works).
    let ids = store().selectedIds;
    if (e.shiftKey) {
      if (ids.includes(id)) {
        store().setSelection(ids.filter((x) => x !== id));
      } else {
        store().setSelection([...ids, id]);
      }
      return;
    }
    if (!ids.includes(id)) {
      store().select(id);
      ids = [id];
    }
    // alt-drag duplicates first
    if (e.altKey) {
      ids = duplicateSelected();
    }
    const z = store().zoom;
    const items = ids
      .filter((sid) => !store().lockedIds[sid])
      .map((sid) => {
        const el = findEl(pageRef.current, sid);
        return el
          ? { el, baseX: parseFloat(el.dataset.maeX || "0"), baseY: parseFloat(el.dataset.maeY || "0") }
          : null;
      })
      .filter(Boolean);

    // ---- build snap targets (sibling + frame bounds) in page-space
    const page = pageRef.current;
    const pr = page.getBoundingClientRect();
    const toPage = (r) => ({
      left: (r.left - pr.left) / z,
      top: (r.top - pr.top) / z,
      right: (r.right - pr.left) / z,
      bottom: (r.bottom - pr.top) / z,
    });
    const dragged = new Set(items.map((it) => it.el));
    const root = rootEl();
    const targets = [];
    if (root) {
      Array.from(root.querySelectorAll("[data-mae-id]")).forEach((el) => {
        if (dragged.has(el) || [...dragged].some((d2) => d2.contains(el) || el.contains(d2))) return;
        targets.push(toPage(el.getBoundingClientRect()));
      });
      targets.push(toPage(root.getBoundingClientRect())); // frame edges
    }
    const primRect = toPage(items[0]?.el.getBoundingClientRect() || pr);
    dragRef.current = {
      type: "move",
      items,
      startX: e.clientX,
      startY: e.clientY,
      z,
      targets,
      primRect,
      overFrameEl: null,
      moved: false, // set true on first onPointerMove; guards reparent/commit
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onHandlePointerDown = (h) => (e) => {
    if (e.detail > 1) return;
    const id = store().selectedId;
    if (store().lockedIds[id]) return;
    e.preventDefault();
    e.stopPropagation();
    const el = findEl(pageRef.current, id);
    if (!el) return;
    dragRef.current = {
      type: "resize",
      h,
      el,
      startX: e.clientX,
      startY: e.clientY,
      baseW: el.offsetWidth,
      baseH: el.offsetHeight,
      baseX: parseFloat(el.dataset.maeX || "0"),
      baseY: parseFloat(el.dataset.maeY || "0"),
      z: store().zoom,
      moved: false,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    // First real movement: arm the moved flag only after the pointer has
    // travelled at least 4px from the start — this filters out trackpad
    // jitter that would otherwise make every click look like a drag and
    // trigger reparentIfNeeded / updateGroupBounds on pointerup.
    if (!d.moved) {
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (dist < 4) return;
      d.moved = true;
      if (d.type === "move") {
        pageRef.current?.querySelectorAll("[data-mae-id]").forEach((el) => {
          const ov = el.style.overflow;
          if (ov && ov !== "visible") {
            el.dataset.maeOverflowBak = ov;
            el.style.overflow = "visible";
          }
        });
      }
    }
    let dx = (e.clientX - d.startX) / d.z;
    let dy = (e.clientY - d.startY) / d.z;
    if (d.type === "move") {
      // ---- smart guides + snapping against precomputed targets
      const thr = 6 / d.z;
      const R = d.primRect;
      const L = R.left + dx, T = R.top + dy;
      const W = R.right - R.left, H = R.bottom - R.top;
      const xEdges = [L, L + W / 2, L + W];
      const yEdges = [T, T + H / 2, T + H];
      let bestX = thr, bestY = thr, gv = null, gh = null;
      d.targets.forEach((t) => {
        [t.left, (t.left + t.right) / 2, t.right].forEach((tx) => {
          xEdges.forEach((xe) => {
            const diff = tx - xe;
            if (Math.abs(diff) < bestX) {
              bestX = Math.abs(diff);
              dx += diff;
              gv = { x: tx, a: Math.min(T, t.top), b: Math.max(T + H, t.bottom), t };
            }
          });
        });
        [t.top, (t.top + t.bottom) / 2, t.bottom].forEach((ty) => {
          yEdges.forEach((ye) => {
            const diff = ty - ye;
            if (Math.abs(diff) < bestY) {
              bestY = Math.abs(diff);
              dy += diff;
              gh = { y: ty, a: Math.min(L, t.left), b: Math.max(L + W, t.right), t };
            }
          });
        });
      });

      d.items.forEach(({ el, baseX, baseY }) => {
        const nx = baseX + dx;
        const ny = baseY + dy;
        el.dataset.maeX = nx;
        el.dataset.maeY = ny;
        applyPos(el, nx, ny);
      });

      // ---- guide lines + distance to snapped neighbour
      const nextGuides = [];
      const fL = R.left + dx, fT = R.top + dy;
      if (gv) {
        const gap = gv.t.top > fT + H ? gv.t.top - (fT + H) : fT > gv.t.bottom ? fT - gv.t.bottom : null;
        nextGuides.push({ axis: "v", x: gv.x, a: gv.a, b: gv.b, dist: gap != null ? Math.round(gap) : null });
      }
      if (gh) {
        const gap = gh.t.left > fL + W ? gh.t.left - (fL + W) : fL > gh.t.right ? fL - gh.t.right : null;
        nextGuides.push({ axis: "h", y: gh.y, a: gh.a, b: gh.b, dist: gap != null ? Math.round(gap) : null });
      }
      d.guides = nextGuides;
    } else {
      let w = d.baseW, h = d.baseH, tx = d.baseX, ty = d.baseY;
      if (d.h.dx === 1) w = d.baseW + dx;
      if (d.h.dx === -1) { w = d.baseW - dx; tx = d.baseX + dx; }
      if (d.h.dy === 1) h = d.baseH + dy;
      if (d.h.dy === -1) { h = d.baseH - dy; ty = d.baseY + dy; }

      // Aspect-ratio lock: maintain width/height ratio during drag resize
      if (store().aspectLocked && d.baseW > 0 && d.baseH > 0) {
        const ratio = d.baseW / d.baseH;
        const xOnly = d.h.dx !== 0 && d.h.dy === 0;
        const yOnly = d.h.dy !== 0 && d.h.dx === 0;
        if (xOnly) {
          h = w / ratio;
        } else if (yOnly) {
          w = h * ratio;
          if (d.h.dx === -1) tx = d.baseX + (d.baseW - w);
        } else {
          // Corner handle: let the larger delta lead
          const wDelta = Math.abs(w - d.baseW);
          const hDelta = Math.abs(h - d.baseH);
          if (wDelta >= hDelta) {
            h = w / ratio;
            if (d.h.dy === -1) ty = d.baseY + (d.baseH - h);
          } else {
            w = h * ratio;
            if (d.h.dx === -1) tx = d.baseX + (d.baseW - w);
          }
        }
      }

      w = Math.max(8, w); h = Math.max(8, h);
      if (d.h.dx !== 0) d.el.style.width = `${Math.round(w)}px`;
      if (d.h.dy !== 0) d.el.style.height = `${Math.round(h)}px`;
      d.el.dataset.maeX = tx;
      d.el.dataset.maeY = ty;
      applyPos(d.el, tx, ty);
      // Push live dimensions so PropertiesPanel updates in real-time
      store().setLiveSize({
        id: d.el.getAttribute("data-mae-id"),
        w: Math.round(w),
        h: Math.round(h),
        x: Math.round(tx),
        y: Math.round(ty),
      });
    }
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
      if (dragRef.current?.type === "move") {
        setGuides(dragRef.current.guides || []);

        // Frame drop-indicator: outline the frame the primary item is over
        const page = pageRef.current;
        const primEl = dragRef.current.items?.[0]?.el;
        let overFrame = null;
        if (page && primEl) {
          const er = primEl.getBoundingClientRect();
          const cx = er.left + er.width / 2;
          const cy = er.top + er.height / 2;
          const hits = document.elementsFromPoint(cx, cy);
          for (const h of hits) {
            if (!page.contains(h) || !h.hasAttribute("data-mae-id")) continue;
            if (h === primEl || primEl.contains(h)) continue;
            if (!h.dataset.maeType || h.dataset.maeType === "frame") { overFrame = h; break; }
          }
        }
        // Remove old indicator
        if (dragOverFrameRef.current && dragOverFrameRef.current !== overFrame) {
          dragOverFrameRef.current.style.outline = "";
          dragOverFrameRef.current = null;
        }
        // Apply new indicator
        if (overFrame && overFrame !== dragOverFrameRef.current) {
          overFrame.style.outline = "2px solid #3b82f6";
          dragOverFrameRef.current = overFrame;
        }
      }
    });
  };

  // Recalculate a group's bounding box to tightly fit all its children.
  // Only runs on Groups — Frames have user-defined fixed bounds and must
  // never be auto-resized by child movement.
  const updateGroupBounds = (el) => {
    if (!el) return;
    const parent = el.parentElement;
    if (!parent || !parent.hasAttribute("data-mae-id") || parent === pageRef.current) return;
    // Only Groups auto-resize to fit children. Frames — whether created by the
    // toolbar (data-mae-type="frame") or classified as Frame because they carry
    // a background (imported HTML) — keep their user-defined fixed bounds.
    if (classifyElement(parent) !== "Group") return;
    if (!parent.style.width || !parent.style.height) return;

    const children = Array.from(parent.children).filter((c) => c.hasAttribute("data-mae-id"));
    if (!children.length) return;

    const z = store().zoom;
    const pr = parent.getBoundingClientRect();

    // Compute children bounds in parent-relative page-space (unscaled px).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    children.forEach((c) => {
      const cr = c.getBoundingClientRect();
      const l = (cr.left  - pr.left)  / z;
      const t = (cr.top   - pr.top)   / z;
      const r = (cr.right - pr.left)  / z;
      const b = (cr.bottom - pr.top)  / z;
      minX = Math.min(minX, l); minY = Math.min(minY, t);
      maxX = Math.max(maxX, r); maxY = Math.max(maxY, b);
    });
    if (!isFinite(minX)) return;

    // If children overflow or leave a gap relative to the group origin,
    // shift the group and re-offset all children to compensate, so their
    // page-absolute positions stay unchanged.
    if (Math.abs(minX) > 0.5 || Math.abs(minY) > 0.5) {
      const gx = parseFloat(parent.dataset.maeX || "0") + minX;
      const gy = parseFloat(parent.dataset.maeY || "0") + minY;
      parent.dataset.maeX = gx;
      parent.dataset.maeY = gy;
      applyPos(parent, gx, gy);
      children.forEach((c) => {
        const cx = parseFloat(c.dataset.maeX || "0") - minX;
        const cy = parseFloat(c.dataset.maeY || "0") - minY;
        c.dataset.maeX = cx;
        c.dataset.maeY = cy;
        applyPos(c, cx, cy);
      });
    }

    // Set group size to tightly contain all children (both shrink and expand).
    parent.style.width  = `${Math.max(8, Math.ceil(maxX - minX))}px`;
    parent.style.height = `${Math.max(8, Math.ceil(maxY - minY))}px`;
  };

  const onPointerUp = (e) => {
    if (dragRef.current) {
      const d = dragRef.current;
      dragRef.current = null;

      store().setLiveSize(null);

      if (dragOverFrameRef.current) {
        dragOverFrameRef.current.style.outline = "";
        dragOverFrameRef.current = null;
      }

      // Only apply DOM mutations and commit when the mouse actually moved.
      // A zero-distance "drag" is just a click — it must not reparent,
      // resize groups, or create a history entry.
      if (d.moved) {
        if (d.type === "move") {
          // Reparent while overflow:visible is still set (set in onPointerMove).
          d.items?.forEach(({ el }) => {
            reparentIfNeeded(el, e?.clientX ?? 0, e?.clientY ?? 0);
            updateGroupBounds(el);
          });
          // Restore overflow now that reparenting is done.
          pageRef.current?.querySelectorAll("[data-mae-id]").forEach((el) => {
            if ("maeOverflowBak" in el.dataset) {
              el.style.overflow = el.dataset.maeOverflowBak || "";
              delete el.dataset.maeOverflowBak;
            }
          });
        } else if (d.type === "resize") {
          updateGroupBounds(d.el);
        }
        commit();
        requestAnimationFrame(recompute);
      }
    }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setGuides([]);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  };

  // ---- wheel: scroll / shift-scroll / cmd-zoom
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e) => {
      e.preventDefault();
      const s = store();
      if (e.ctrlKey || e.metaKey) {
        const r = vp.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const nz = clamp(s.zoom * factor, 0.1, 4);
        const wx = (mx - s.pan.x) / s.zoom, wy = (my - s.pan.y) / s.zoom;
        s.setZoom(nz);
        s.setPan({ x: mx - wx * nz, y: my - wy * nz });
      } else if (e.shiftKey) {
        s.setPan({ x: s.pan.x - (e.deltaY || e.deltaX), y: s.pan.y });
      } else {
        s.setPan({ x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY });
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // ---- viewport pointer down: pan / marquee / create
  const onViewportPointerDown = (e) => {
    if (e.button === 2) return; // context menu handled separately
    const s = store();
    const inPage = pageRef.current?.contains(e.target);
    const inOverlay = e.target.closest("[data-overlay]");
    if (inOverlay) return;

    const panning = s.spaceDown || s.tool === "hand" || e.button === 1;
    if (panning) {
      panRef.current = { startX: e.clientX, startY: e.clientY, px: s.pan.x, py: s.pan.y };
      window.addEventListener("pointermove", onPanMove);
      window.addEventListener("pointerup", onPanUp);
      return;
    }

    // creation tools
    if (["text", "rect", "frame", "ellipse"].includes(s.tool)) {
      insertElement(s.tool, e.clientX, e.clientY);
      return;
    }
    if (s.tool === "image") {
      imgInputRef.current?.click();
      return;
    }

    // select tool on empty area -> marquee
    if (!inPage) {
      if (!e.shiftKey) s.select(null);
      const r = viewportRef.current.getBoundingClientRect();
      marqueeRef.current = { startX: e.clientX, startY: e.clientY, vpRect: r };
      setMarquee({ x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 });
      window.addEventListener("pointermove", onMarqueeMove);
      window.addEventListener("pointerup", onMarqueeUp);
    }
  };

  const onPanMove = (e) => {
    const p = panRef.current;
    if (!p) return;
    store().setPan({ x: p.px + (e.clientX - p.startX), y: p.py + (e.clientY - p.startY) });
  };
  const onPanUp = () => {
    panRef.current = null;
    window.removeEventListener("pointermove", onPanMove);
    window.removeEventListener("pointerup", onPanUp);
  };

  const onMarqueeMove = (e) => {
    const m = marqueeRef.current;
    if (!m) return;
    const r = m.vpRect;
    const x = Math.min(m.startX, e.clientX) - r.left;
    const y = Math.min(m.startY, e.clientY) - r.top;
    const w = Math.abs(e.clientX - m.startX);
    const h = Math.abs(e.clientY - m.startY);
    setMarquee({ x, y, w, h });
  };
  const onMarqueeUp = (e) => {
    const m = marqueeRef.current;
    marqueeRef.current = null;
    window.removeEventListener("pointermove", onMarqueeMove);
    window.removeEventListener("pointerup", onMarqueeUp);
    setMarquee(null);
    if (!m) return;
    const box = {
      left: Math.min(m.startX, e.clientX),
      top: Math.min(m.startY, e.clientY),
      right: Math.max(m.startX, e.clientX),
      bottom: Math.max(m.startY, e.clientY),
    };
    if (box.right - box.left < 4 && box.bottom - box.top < 4) return;
    const root = rootEl();
    const hits = [];
    Array.from(root?.querySelectorAll("[data-mae-id]") || []).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.left >= box.left && r.top >= box.top && r.right <= box.right && r.bottom <= box.bottom) {
        // only top-most enclosed (skip if an ancestor already hit)
        hits.push(el);
      }
    });
    // keep only outermost enclosed elements
    const outer = hits.filter((el) => !hits.some((o) => o !== el && o.contains(el)));
    const ids = outer.map((el) => el.getAttribute("data-mae-id"));
    if (ids.length) store().setSelection(ids);
  };

  const onContextMenu = (e) => {
    const t = e.target.closest("[data-mae-id]");
    if (!t && !store().selectedIds.length) return;
    e.preventDefault();
    if (t) {
      const id = t.getAttribute("data-mae-id");
      if (!store().selectedIds.includes(id)) store().select(id);
    }
    setCtx({ x: e.clientX, y: e.clientY });
  };

  // ---- custom scrollbar (drives the content region's scrollTop) ------------
  // Geometry mirrors the frame's on-screen box: frame top-left is (pan.x, pan.y)
  // and it renders at PHONE_FRAME size * zoom (transformOrigin 0 0 on wrapper).
  // Thumb size = visible fraction of the scrolling content region.
  const barTrackH = PHONE_FRAME.height * zoom;
  const barVisibleFrac = maxScroll > 0
    ? scrollClient / (scrollClient + maxScroll)
    : 1;
  const barThumbH = Math.min(barTrackH, Math.max(28, barTrackH * barVisibleFrac));
  const barThumbTop = maxScroll > 0
    ? (scrollY / maxScroll) * (barTrackH - barThumbH)
    : 0;
  const barLeft = pan.x + PHONE_FRAME.width * zoom + 18;
  const barTop = pan.y;

  const onScrollThumbPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    scrollBarDragRef.current = {
      startY: e.clientY,
      startScroll: scrollY,
      travel: barTrackH - barThumbH,
    };
    window.addEventListener("pointermove", onScrollThumbMove);
    window.addEventListener("pointerup", onScrollThumbUp);
  };
  const onScrollThumbMove = (e) => {
    const d = scrollBarDragRef.current;
    if (!d || d.travel <= 0) return;
    const dy = e.clientY - d.startY;
    setScroll(d.startScroll + (dy / d.travel) * maxScroll);
  };
  const onScrollThumbUp = () => {
    scrollBarDragRef.current = null;
    window.removeEventListener("pointermove", onScrollThumbMove);
    window.removeEventListener("pointerup", onScrollThumbUp);
  };
  const onScrollTrackPointerDown = (e) => {
    // Click on the track above/below the thumb pages the view by one frame.
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const clickY = e.clientY - r.top;
    const dir = clickY < barThumbTop ? -1 : 1;
    setScroll(scrollY + dir * PHONE_FRAME.height);
  };

  const cursor = spaceDown || tool === "hand"
    ? "grab"
    : ["text", "rect", "frame", "ellipse", "image"].includes(tool)
    ? "crosshair"
    : "default";

  const showHandles = selectedIds.length === 1 && !editing;

  return (
    <div
      ref={viewportRef}
      onPointerDown={onViewportPointerDown}
      onContextMenu={onContextMenu}
      className="relative flex-1 h-full overflow-hidden canvas-grid select-none"
      style={{ cursor, ...(pageMeta?.background ? { backgroundColor: pageMeta.background } : {}) }}
      data-testid="canvas-viewport"
    >
      <Toolbar />
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const reader = new FileReader();
          reader.onload = () => {
            const vp = viewportRef.current.getBoundingClientRect();
            insertElement("image", vp.left + vp.width / 2, vp.top + vp.height / 2, reader.result);
          };
          reader.readAsDataURL(f);
          e.target.value = "";
        }}
        data-testid="canvas-image-input"
      />

      <PhoneScreenFrame
        wrapperStyle={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
        platform={platform}
        html={html || ""}
        htmlVersion={htmlVersion}
        css={designSystemCss}
        isWebsite={isWebsite}
        frameWidth={frameWidth}
        pageRef={pageRef}
        pageClassName="pro-canvas-page"
        onClickCapture={onPageClickCapture}
        onDoubleClick={() => {
          if (store().selectedId) startEditing();
        }}
      >

          {/* smart alignment guides + distance indicators */}
          {guides.map((g, i) =>
            g.axis === "v" ? (
              <div key={`g${i}`} data-overlay className="absolute pointer-events-none" style={{ left: g.x, top: g.a, height: g.b - g.a }}>
                <div style={{ position: "absolute", left: -0.5 / zoom, top: 0, width: 1 / zoom, height: "100%", background: "#ec4899" }} />
                {g.dist != null && (
                  <span style={{ position: "absolute", left: 4 / zoom, top: "50%", fontSize: 10 / zoom, background: "#ec4899", color: "#fff", padding: `${1 / zoom}px ${4 / zoom}px`, borderRadius: 3 / zoom, whiteSpace: "nowrap" }}>{g.dist}</span>
                )}
              </div>
            ) : (
              <div key={`g${i}`} data-overlay className="absolute pointer-events-none" style={{ left: g.a, top: g.y, width: g.b - g.a }}>
                <div style={{ position: "absolute", top: -0.5 / zoom, left: 0, height: 1 / zoom, width: "100%", background: "#ec4899" }} />
                {g.dist != null && (
                  <span style={{ position: "absolute", top: 4 / zoom, left: "50%", fontSize: 10 / zoom, background: "#ec4899", color: "#fff", padding: `${1 / zoom}px ${4 / zoom}px`, borderRadius: 3 / zoom, whiteSpace: "nowrap" }}>{g.dist}</span>
                )}
              </div>
            )
          )}

          {rects.map((rect, i) => {
            const isPrimary = rect.id === selectedIds[selectedIds.length - 1];
            const locked = lockedIds[rect.id];
            return (
              <div
                key={rect.id}
                data-overlay
                className="absolute pointer-events-none"
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                <div
                  className={`absolute inset-0 ring-2 ${locked ? "ring-amber-500" : "ring-blue-500"}`}
                  style={{ pointerEvents: editing ? "none" : "auto", cursor: "move" }}
                  onPointerDown={(e) => onBoxPointerDown(e, rect.id)}
                  onDoubleClick={startEditing}
                  data-testid={isPrimary ? "selection-box" : `selection-box-${rect.id}`}
                />
                {showHandles && isPrimary && !locked &&
                  HANDLES.map((h) => (
                    <div
                      key={h.k}
                      onPointerDown={onHandlePointerDown(h)}
                      className="absolute bg-white border border-blue-500 rounded-sm"
                      style={{
                        width: 10 / zoom,
                        height: 10 / zoom,
                        left: `calc(${h.x * 100}% - ${5 / zoom}px)`,
                        top: `calc(${h.y * 100}% - ${5 / zoom}px)`,
                        cursor: h.cursor,
                        pointerEvents: "auto",
                      }}
                      data-testid={`resize-${h.k}`}
                    />
                  ))}
              </div>
            );
          })}
        </PhoneScreenFrame>

      {/* Custom scrollbar — reveals below-the-fold content without native
          wheel/touch scroll inside the phone (avoids select/drag conflicts).
          Sits beside the frame and scales/moves with pan + zoom. */}
      {maxScroll > 1 && (
        <div
          onPointerDown={onScrollTrackPointerDown}
          data-overlay
          data-testid="canvas-scrollbar"
          style={{
            position: "absolute",
            left: barLeft,
            top: barTop,
            width: 10,
            height: barTrackH,
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxSizing: "border-box",
            cursor: "pointer",
            zIndex: 5,
          }}
        >
          <div
            onPointerDown={onScrollThumbPointerDown}
            data-testid="canvas-scrollbar-thumb"
            style={{
              position: "absolute",
              left: 1,
              right: 1,
              top: barThumbTop,
              height: barThumbH,
              borderRadius: 999,
              background: scrollBarDragRef.current ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.42)",
              cursor: "grab",
              transition: "background .12s",
            }}
          />
        </div>
      )}

      {marquee && (
        <div
          className="absolute border border-blue-400 bg-blue-400/10 pointer-events-none"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
          data-testid="marquee"
        />
      )}

      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} ops={store().ops} onClose={() => setCtx(null)} />
      )}
    </div>
  );
}
