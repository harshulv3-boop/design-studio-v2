import { useEffect, useMemo, useRef, useState, useCallback, useLayoutEffect, memo } from "react";
import { Plus, Minus, Maximize, Flag, Trash2, MousePointerClick } from "lucide-react";
import { sanitizeHtml } from "@/lib/pro/htmlUtils";
import { projectConnections, DEFAULTS } from "@/lib/pro/prototype";
import { scopedPhoneScreenCss, PHONE_SCREEN_PAGE_CLASS } from "@/components/PhoneScreenRenderer";

// Renders a screen's HTML into a frame off the React render cycle so a large
// payload doesn't freeze the canvas. Uses the SAME scoped-CSS helper as Lite/Pro
// so the design system renders identically and doesn't leak into app chrome.
const LazyScreenContent = memo(function LazyScreenContent({ html, css, width, height }) {
  const ref = useRef(null);
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  useEffect(() => {
    if (!ref.current) return;
    const raf = requestAnimationFrame(() => { if (ref.current) ref.current.innerHTML = clean; });
    return () => cancelAnimationFrame(raf);
  }, [clean]);
  return (
    <div style={{ width, height, overflow: "hidden", background: "#000" }}>
      {css && <style dangerouslySetInnerHTML={{ __html: scopedPhoneScreenCss(css) }} />}
      <div ref={ref} className={PHONE_SCREEN_PAGE_CLASS} style={{ width, height, overflow: "hidden" }} />
    </div>
  );
});

const HEADER_H = 30;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function autoPositions(screens, frame) {
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(screens.length))));
  const gapX = frame.width + 180, gapY = frame.height + 160;
  const pos = {};
  screens.forEach((s, i) => { pos[s.id] = { x: 80 + (i % cols) * gapX, y: 80 + Math.floor(i / cols) * gapY }; });
  return pos;
}

export default function FlowCanvas({
  screens = [],
  css = "",
  frame = { width: 375, height: 812, radius: 46 },
  startScreen,
  selection, setSelection,
  selectedConnection, setSelectedConnection,
  applyInteraction, clearInteraction,
  initialPositions, onPositions, onOpenScreen,
}) {
  const selectEl = useCallback((screenId, elId) => setSelection({ screenId, elId }), [setSelection]);

  const viewportRef = useRef(null);
  const frameRefs = useRef({});

  const [view, setView] = useState({ x: 0, y: 0, scale: 0.55 });
  const viewRef = useRef(view); viewRef.current = view;

  const [positions, setPositions] = useState(() => {
    const saved = initialPositions || {};
    return Object.keys(saved).length ? { ...autoPositions(screens, frame), ...saved } : autoPositions(screens, frame);
  });
  const posRef = useRef(positions); posRef.current = positions;

  useEffect(() => {
    setPositions((prev) => {
      const base = autoPositions(screens, frame);
      const next = { ...base, ...(initialPositions || {}), ...prev };
      screens.forEach((s) => { if (!next[s.id]) next[s.id] = base[s.id]; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screens.length]);

  const [hover, setHover] = useState(null);
  const [boxes, setBoxes] = useState({});
  const [selBox, setSelBox] = useState(null);
  const [connecting, setConnecting] = useState(null);
  const connectingRef = useRef(null); connectingRef.current = connecting;

  const screensSig = useMemo(() => screens.map((s) => `${s.id}:${(s.html || "").length}`).join("|"), [screens]);

  const screenToWorld = useCallback((cx, cy) => {
    const r = viewportRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.scale, y: (cy - r.top - v.y) / v.scale };
  }, []);

  const boxOf = useCallback((screenId, elId) => {
    const fEl = frameRefs.current[screenId];
    if (!fEl || !elId) return null;
    let el; try { el = fEl.querySelector(`[data-mae-id="${CSS.escape(elId)}"]`); } catch { el = null; }
    if (!el) return null;
    const fr = fEl.getBoundingClientRect(), er = el.getBoundingClientRect();
    const p = posRef.current[screenId] || { x: 0, y: 0 }, s = viewRef.current.scale;
    return { x: p.x + (er.left - fr.left) / s, y: p.y + (er.top - fr.top) / s, w: er.width / s, h: er.height / s };
  }, []);

  // Select the ACTUAL element under the cursor (deepest tagged node), so
  // individual nested items (e.g. a single tab-bar item) can be selected and
  // linked — not just the top-level container.
  const topLevel = (rawTarget) => rawTarget.closest("[data-mae-id]");

  const fitAll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !screens.length) return;
    const pos = posRef.current;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    screens.forEach((s) => {
      const p = pos[s.id] || { x: 0, y: 0 };
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y - HEADER_H);
      maxX = Math.max(maxX, p.x + frame.width); maxY = Math.max(maxY, p.y + frame.height);
    });
    const pad = 120, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
    const r = vp.getBoundingClientRect();
    const scale = Math.min(1, Math.min(r.width / w, r.height / h));
    setView({ scale, x: r.width / 2 - ((minX + maxX) / 2) * scale, y: r.height / 2 - ((minY + maxY) / 2) * scale });
  }, [screens, frame.width, frame.height]);

  useEffect(() => { const t = setTimeout(fitAll, 60); return () => clearTimeout(t); /* eslint-disable-next-line */ }, []);

  const recompute = useCallback(() => {
    const next = {};
    projectConnections(screens).forEach((c) => { const b = boxOf(c.source, c.elId); if (b) next[c.id] = b; });
    setBoxes(next);
    setSelBox(selection ? boxOf(selection.screenId, selection.elId) : null);
  }, [screens, selection, boxOf]);

  useLayoutEffect(() => { const id = requestAnimationFrame(recompute); return () => cancelAnimationFrame(id); }, [screensSig, positions, recompute]);

  useEffect(() => {
    const vp = viewportRef.current; if (!vp) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const v = viewRef.current, factor = Math.exp(-e.deltaY * 0.0015);
        const ns = clamp(v.scale * factor, 0.1, 2.5);
        const r = vp.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
        setView({ scale: ns, x: mx - ((mx - v.x) / v.scale) * ns, y: my - ((my - v.y) / v.scale) * ns });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (f) => {
    const r = viewportRef.current.getBoundingClientRect(), v = viewRef.current;
    const ns = clamp(v.scale * f, 0.1, 2.5), cx = r.width / 2, cy = r.height / 2;
    setView({ scale: ns, x: cx - ((cx - v.x) / v.scale) * ns, y: cy - ((cy - v.y) / v.scale) * ns });
  };

  const cancelConnect = useCallback(() => setConnecting(null), []);

  const onBgPointerDown = (e) => {
    if (connectingRef.current) { cancelConnect(); return; }
    setSelection(null); setSelectedConnection(null);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev) => setView((v) => ({ ...v, x: start.vx + (ev.clientX - start.x), y: start.vy + (ev.clientY - start.y) }));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const onHeaderDown = (e, sid) => {
    e.stopPropagation();
    const p0 = posRef.current[sid] || { x: 0, y: 0 }, start = { x: e.clientX, y: e.clientY };
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / viewRef.current.scale, dy = (ev.clientY - start.y) / viewRef.current.scale;
      setPositions((pos) => ({ ...pos, [sid]: { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) } }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      onPositions?.(posRef.current);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const onFrameClick = (e, sid) => {
    e.preventDefault(); e.stopPropagation();
    const fEl = frameRefs.current[sid];
    const el = topLevel(e.target, fEl);
    if (!el) return;
    const elId = el.getAttribute("data-mae-id");
    const conn = connectingRef.current;
    if (conn && conn.from.screenId !== sid) {
      applyInteraction?.(conn.from.screenId, conn.from.elId, {
        target: sid, action: "navigate", trigger: DEFAULTS.trigger,
        animation: DEFAULTS.animation, duration: DEFAULTS.duration, easing: DEFAULTS.easing,
      });
      setSelectedConnection(`${conn.from.screenId}::${conn.from.elId}`);
      selectEl(conn.from.screenId, conn.from.elId);
      setConnecting(null);
      return;
    }
    selectEl(sid, elId);
    setSelectedConnection(null);
  };

  const onFrameMove = (e, sid) => {
    const fEl = frameRefs.current[sid];
    if (!fEl) return;
    const el = topLevel(e.target, fEl);
    if (!el) { setHover(null); return; }
    const elId = el.getAttribute("data-mae-id");
    const fr = fEl.getBoundingClientRect(), er = el.getBoundingClientRect();
    const p = posRef.current[sid] || { x: 0, y: 0 }, s = viewRef.current.scale;
    const box = { x: p.x + (er.left - fr.left) / s, y: p.y + (er.top - fr.top) / s, w: er.width / s, h: er.height / s };
    setHover({ screenId: sid, elId, box });
    const conn = connectingRef.current;
    if (conn) {
      const valid = sid !== conn.from.screenId;
      setConnecting({ ...conn, target: valid ? { screenId: sid, elId, box } : null });
    }
  };

  const startConnect = (e, screenId, elId, box) => {
    e.stopPropagation(); e.preventDefault();
    selectEl(screenId, elId);
    const startWorld = screenToWorld(e.clientX, e.clientY);
    setConnecting({ from: { screenId, elId, box }, cursor: startWorld, target: null });
    let moved = false;
    const down = { x: e.clientX, y: e.clientY };
    const move = (ev) => {
      if (Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 4) moved = true;
      const w = screenToWorld(ev.clientX, ev.clientY);
      let target = null;
      const node = document.elementFromPoint(ev.clientX, ev.clientY);
      const fEl = node && node.closest && node.closest("[data-flow-frame]");
      if (fEl) {
        const tsid = fEl.getAttribute("data-flow-frame");
        const tel = topLevel(node, fEl);
        if (tel && tsid !== screenId) {
          const fr = fEl.getBoundingClientRect(), er = tel.getBoundingClientRect();
          const p = posRef.current[tsid] || { x: 0, y: 0 }, s = viewRef.current.scale;
          target = { screenId: tsid, elId: tel.getAttribute("data-mae-id"),
            box: { x: p.x + (er.left - fr.left) / s, y: p.y + (er.top - fr.top) / s, w: er.width / s, h: er.height / s } };
        }
      }
      setConnecting((c) => (c ? { ...c, cursor: w, target } : c));
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const c = connectingRef.current;
      const tgt = c?.target;
      if (moved) {
        if (tgt) {
          applyInteraction?.(screenId, elId, {
            target: tgt.screenId, action: "navigate", trigger: DEFAULTS.trigger,
            animation: DEFAULTS.animation, duration: DEFAULTS.duration, easing: DEFAULTS.easing,
          });
          setSelectedConnection(`${screenId}::${elId}`);
        }
        setConnecting(null);
      }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (connectingRef.current) setConnecting(null);
      else { setSelection(null); setSelectedConnection(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelection, setSelectedConnection]);

  const conns = useMemo(() => projectConnections(screens), [screens]);
  const pathFor = (sbox, tpos) => {
    const sCy = sbox.y + sbox.h / 2;
    const right = tpos.x + frame.width / 2 >= sbox.x + sbox.w / 2;
    const s = { x: right ? sbox.x + sbox.w : sbox.x, y: sCy };
    const t = { x: right ? tpos.x : tpos.x + frame.width, y: clamp(sCy, tpos.y + 28, tpos.y + frame.height - 28) };
    const dx = Math.max(50, Math.abs(t.x - s.x) * 0.4);
    return { d: `M ${s.x} ${s.y} C ${right ? s.x + dx : s.x - dx} ${s.y}, ${right ? t.x - dx : t.x + dx} ${t.y}, ${t.x} ${t.y}`, s, t };
  };

  const inv = 1 / view.scale;

  const PlusHandle = ({ x, y, color, onDown, testid, title }) => (
    <button
      onPointerDown={onDown}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "absolute", left: x, top: y, transform: "translate(-50%, -50%)", width: 24 * inv, height: 24 * inv, borderRadius: 999 }}
      className={`flex items-center justify-center border-2 border-white shadow-lg ${color}`}
      data-testid={testid} title={title}
    >
      <Plus style={{ width: 14 * inv, height: 14 * inv }} className="text-white" />
    </button>
  );

  return (
    <div
      ref={viewportRef}
      onPointerDown={onBgPointerDown}
      className="relative flex-1 h-full overflow-hidden bg-[#0a0a0d]"
      data-testid="flow-canvas"
      style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)",
        backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor: connecting ? "crosshair" : "default",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: "0 0" }}>
        <svg style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} width="1" height="1">
          <defs>
            <marker id="fc-arrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 Z" fill="#6d5efc" /></marker>
            <marker id="fc-arrow-sel" markerWidth="10" markerHeight="10" refX="6.5" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#22d3ee" /></marker>
            <marker id="fc-arrow-green" markerWidth="10" markerHeight="10" refX="6.5" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#34d399" /></marker>
          </defs>
          {conns.map((c) => {
            const sbox = boxes[c.id], tpos = positions[c.target];
            if (!sbox || !tpos) return null;
            const { d, s } = pathFor(sbox, tpos);
            const sel = selectedConnection === c.id;
            return (
              <g key={c.id}>
                <path d={d} stroke="transparent" strokeWidth={14 * inv} fill="none" style={{ pointerEvents: "stroke", cursor: "pointer" }}
                  onPointerDown={(e) => { e.stopPropagation(); setSelectedConnection(c.id); selectEl(c.source, c.elId); }}
                  data-testid={`flow-conn-${c.id}`} />
                <path d={d} stroke={sel ? "#22d3ee" : "#6d5efc"} strokeWidth={(sel ? 3 : 2) * inv} fill="none" markerEnd={`url(#${sel ? "fc-arrow-sel" : "fc-arrow"})`} style={{ pointerEvents: "none" }} />
                <circle cx={s.x} cy={s.y} r={4.5 * inv} fill={sel ? "#22d3ee" : "#6d5efc"} />
              </g>
            );
          })}

          {connecting && (() => {
            const s = { x: connecting.from.box.x + connecting.from.box.w, y: connecting.from.box.y + connecting.from.box.h / 2 };
            const t = connecting.target ? { x: connecting.target.box.x, y: connecting.target.box.y + connecting.target.box.h / 2 } : connecting.cursor;
            const right = t.x >= s.x, dx = Math.max(50, Math.abs(t.x - s.x) * 0.4);
            const green = !!connecting.target;
            const d = `M ${s.x} ${s.y} C ${right ? s.x + dx : s.x - dx} ${s.y}, ${right ? t.x - dx : t.x + dx} ${t.y}, ${t.x} ${t.y}`;
            return <path d={d} stroke={green ? "#34d399" : "#22d3ee"} strokeWidth={2.5 * inv} strokeDasharray={green ? "none" : `${6 * inv} ${5 * inv}`} fill="none" markerEnd={green ? "url(#fc-arrow-green)" : undefined} />;
          })()}
        </svg>

        {(() => {
          const c = conns.find((x) => x.id === selectedConnection);
          const sbox = c && boxes[c.id], tpos = c && positions[c.target];
          if (!c || !sbox || !tpos) return null;
          const { s, t } = pathFor(sbox, tpos);
          return (
            <button onPointerDown={(e) => { e.stopPropagation(); clearInteraction?.(c.source, c.elId); setSelectedConnection(null); setSelection(null); }}
              style={{ position: "absolute", left: (s.x + t.x) / 2, top: (s.y + t.y) / 2, width: 28 * inv, height: 28 * inv, transform: "translate(-50%,-50%)", borderRadius: 999 }}
              className="flex items-center justify-center bg-[#15151c] border border-cyan-400/60 text-cyan-300 hover:bg-red-500 hover:text-white hover:border-red-400" data-testid="flow-conn-delete">
              <Trash2 style={{ width: 14 * inv, height: 14 * inv }} />
            </button>
          );
        })()}

        {screens.map((s) => {
          const isStart = s.id === startScreen;
          const isDrop = connecting?.target?.screenId === s.id;
          const p = positions[s.id] || { x: 0, y: 0 };
          return (
            <div key={s.id} style={{ position: "absolute", left: p.x, top: p.y, width: frame.width }}>
              <div onPointerDown={(e) => onHeaderDown(e, s.id)} onDoubleClick={() => onOpenScreen?.(s.id)}
                style={{ position: "absolute", left: 0, bottom: "100%", height: HEADER_H * inv, marginBottom: 8 * inv, whiteSpace: "nowrap" }}
                className="flex items-center gap-2 cursor-move select-none" data-testid={`flow-frame-header-${s.id}`}>
                {isStart && (
                  <span style={{ fontSize: 13 * inv, padding: `${3 * inv}px ${8 * inv}px`, gap: 5 * inv, borderRadius: 999 }}
                    className="flex items-center bg-emerald-500/15 text-emerald-300 border border-emerald-400/40 font-medium" data-testid={`flow-start-badge-${s.id}`}>
                    <Flag style={{ width: 12 * inv, height: 12 * inv }} /> Start
                  </span>
                )}
                <span style={{ fontSize: 15 * inv }} className={isStart ? "text-emerald-200 font-semibold" : "text-zinc-300 font-medium"}>{s.name}</span>
              </div>

              <div ref={(n) => (frameRefs.current[s.id] = n)}
                onPointerMove={(e) => onFrameMove(e, s.id)}
                onPointerLeave={() => setHover((h) => (h?.screenId === s.id ? null : h))}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => onFrameClick(e, s.id)}
                style={{
                  width: frame.width, height: frame.height, borderRadius: frame.radius, background: "#000", overflow: "hidden",
                  boxShadow: isDrop ? "0 0 0 4px rgba(52,211,153,.95)" : isStart ? "0 0 0 2px rgba(16,185,129,.7), 0 30px 80px rgba(0,0,0,.5)" : "0 0 0 1px rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.5)",
                }}
                data-flow-frame={s.id} data-testid={`flow-frame-${s.id}`}>
                <LazyScreenContent html={s.html || ""} css={css} width={frame.width} height={frame.height} />
              </div>
            </div>
          );
        })}

        {hover && (!selection || hover.elId !== selection.elId || hover.screenId !== selection.screenId) && (
          <div style={{ position: "absolute", left: hover.box.x, top: hover.box.y, width: hover.box.w, height: hover.box.h, borderRadius: 8 * inv, boxShadow: `0 0 0 ${1.5 * inv}px rgba(109,94,252,.6)`, pointerEvents: "none" }} />
        )}

        {connecting?.target && (
          <>
            <div style={{ position: "absolute", left: connecting.target.box.x, top: connecting.target.box.y, width: connecting.target.box.w, height: connecting.target.box.h, borderRadius: 8 * inv, boxShadow: `0 0 0 ${2 * inv}px #34d399`, pointerEvents: "none" }} />
            <PlusHandle x={connecting.target.box.x + connecting.target.box.w} y={connecting.target.box.y + connecting.target.box.h / 2}
              color="bg-emerald-500" onDown={(e) => e.stopPropagation()} testid="flow-connect-target-handle" title="Release to connect" />
          </>
        )}

        {selection && selBox && (
          <>
            <div style={{ position: "absolute", left: selBox.x, top: selBox.y, width: selBox.w, height: selBox.h, borderRadius: 8 * inv, boxShadow: `0 0 0 ${2 * inv}px #6d5efc`, pointerEvents: "none" }} data-testid="flow-selection-box" />
            <PlusHandle x={selBox.x + selBox.w} y={selBox.y + selBox.h / 2}
              color={connecting ? "bg-cyan-500" : "bg-[#6d5efc] hover:scale-110 transition-transform"}
              onDown={(e) => startConnect(e, selection.screenId, selection.elId, selBox)}
              testid="flow-connect-handle" title="Drag to a screen to connect, or click then click a target" />
          </>
        )}
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-[#15151c]/95 backdrop-blur border border-white/10 rounded-xl px-1.5 py-1 z-20" onPointerDown={(e) => e.stopPropagation()} data-testid="flow-canvas-toolbar">
        <button onClick={() => zoomBy(1 / 1.2)} className="p-2 rounded-lg text-zinc-300 hover:bg-white/10" data-testid="flow-zoom-out-btn"><Minus size={15} /></button>
        <span className="text-xs font-mono text-zinc-300 w-12 text-center">{Math.round(view.scale * 100)}%</span>
        <button onClick={() => zoomBy(1.2)} className="p-2 rounded-lg text-zinc-300 hover:bg-white/10" data-testid="flow-zoom-in-btn"><Plus size={15} /></button>
        <div className="w-px h-5 bg-white/10 mx-0.5" />
        <button onClick={fitAll} className="p-2 rounded-lg text-zinc-300 hover:bg-white/10" data-testid="flow-fit-btn" title="Fit all screens"><Maximize size={15} /></button>
      </div>

      <div className="absolute top-3 left-4 flex items-center gap-2 text-[11px] text-zinc-500 pointer-events-none">
        <MousePointerClick size={12} />
        {connecting ? "Click an element on another screen to connect — Esc to cancel" : "Click an element, then drag its + handle onto another screen"}
      </div>
    </div>
  );
}
