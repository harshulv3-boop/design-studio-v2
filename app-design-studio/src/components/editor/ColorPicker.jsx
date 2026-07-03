import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Check, Pencil, Trash2, Pipette } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { hsvToHex, hexToHsv, hexToRgb, rgbToHex, cssColorToHex } from "@/lib/pro/colorUtils";

// ── Built-in palettes ─────────────────────────────────────────────────────────

const PALETTES = [
  {
    name: "Neutrals",
    colors: ["#ffffff","#f5f5f5","#e5e5e5","#d4d4d4","#a3a3a3","#737373","#525252","#404040","#262626","#171717","#0a0a0a","#000000"],
  },
  {
    name: "Blues",
    colors: ["#eff6ff","#dbeafe","#bfdbfe","#93c5fd","#60a5fa","#3b82f6","#2563eb","#1d4ed8","#1e40af","#1e3a8a","#172554"],
  },
  {
    name: "Greens",
    colors: ["#f0fdf4","#dcfce7","#bbf7d0","#86efac","#4ade80","#22c55e","#16a34a","#15803d","#166534","#14532d","#052e16"],
  },
  {
    name: "Ambers",
    colors: ["#fffbeb","#fef3c7","#fde68a","#fcd34d","#fbbf24","#f59e0b","#d97706","#b45309","#92400e","#78350f","#451a03"],
  },
  {
    name: "Reds",
    colors: ["#fef2f2","#fee2e2","#fecaca","#fca5a5","#f87171","#ef4444","#dc2626","#b91c1c","#991b1b","#7f1d1d","#450a0a"],
  },
  {
    name: "Purples",
    colors: ["#faf5ff","#f3e8ff","#e9d5ff","#d8b4fe","#c084fc","#a855f7","#9333ea","#7e22ce","#6b21a8","#581c87","#3b0764"],
  },
  {
    name: "Dark UI",
    colors: ["#09090b","#18181b","#27272a","#3f3f46","#52525b","#71717a","#a1a1aa","#d4d4d8","#e4e4e7","#f4f4f5"],
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function ColorBoard({ h, s, v, onChange }) {
  const ref = useRef(null);
  const drag = useRef(false);
  const pureHex = useMemo(() => hsvToHex(h, 1, 1), [h]);
  const thumbHex = useMemo(() => hsvToHex(h, s, v), [h, s, v]);

  const fromEvent = useCallback((e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height)),
    ];
  }, []);

  return (
    <div
      ref={ref}
      style={{
        width: "100%",
        height: 180,
        borderRadius: 6,
        background: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${pureHex} 100%)`,
        position: "relative",
        cursor: "crosshair",
        touchAction: "none",
        flexShrink: 0,
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = true;
        ref.current?.setPointerCapture(e.pointerId);
        const pt = fromEvent(e);
        if (pt) onChange(pt[0], pt[1]);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const pt = fromEvent(e);
        if (pt) onChange(pt[0], pt[1]);
      }}
      onPointerUp={() => { drag.current = false; }}
      onPointerCancel={() => { drag.current = false; }}
    >
      <div
        style={{
          position: "absolute",
          left: `${s * 100}%`,
          top: `${(1 - v) * 100}%`,
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: thumbHex,
          border: "2.5px solid #fff",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.4)",
          transform: "translate(-50%,-50%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

function HSlider({ value, min = 0, max = 1, background, checkerboard, thumbColor, onChange }) {
  const ref = useRef(null);
  const drag = useRef(false);
  const pct = ((value - min) / (max - min)) * 100;

  const fromEvent = useCallback((e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    return Math.max(min, Math.min(max, min + (max - min) * (e.clientX - r.left) / r.width));
  }, [min, max]);

  return (
    <div
      ref={ref}
      style={{ position: "relative", height: 12, borderRadius: 6, cursor: "pointer", touchAction: "none" }}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = true;
        ref.current?.setPointerCapture(e.pointerId);
        const v = fromEvent(e);
        if (v !== null) onChange(v);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const v = fromEvent(e);
        if (v !== null) onChange(v);
      }}
      onPointerUp={() => { drag.current = false; }}
      onPointerCancel={() => { drag.current = false; }}
    >
      {checkerboard && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: 6,
          backgroundImage: "linear-gradient(45deg,#555 25%,transparent 25%),linear-gradient(-45deg,#555 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#555 75%),linear-gradient(-45deg,transparent 75%,#555 75%)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0,0 4px,4px -4px,-4px 0",
        }} />
      )}
      <div style={{ position: "absolute", inset: 0, borderRadius: 6, background }} />
      <div style={{
        position: "absolute",
        left: `${pct}%`,
        top: "50%",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: thumbColor || "#fff",
        border: "2.5px solid #fff",
        boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.4)",
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

function Swatch({ color, active, onClick }) {
  return (
    <div
      title={color}
      onClick={() => onClick(color)}
      style={{
        width: 18,
        height: 18,
        borderRadius: 3,
        background: color,
        cursor: "pointer",
        flexShrink: 0,
        outline: active
          ? "2px solid #3b82f6"
          : "1px solid rgba(255,255,255,0.15)",
        outlineOffset: active ? 1 : 0,
      }}
    />
  );
}

// ── ID gen ────────────────────────────────────────────────────────────────────

let _n = 0;
const uid = () => `cs-${Date.now().toString(36)}-${(++_n).toString(36)}`;

// ── Position helper ───────────────────────────────────────────────────────────

function getPos(anchor) {
  if (!anchor) return { top: 60, left: 60 };
  const r = anchor.getBoundingClientRect();
  const pw = 252, ph = 540;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Prefer left of anchor (properties panel is on the right)
  let left = r.left - pw - 8;
  if (left < 8) left = r.right + 8;
  if (left + pw > vw) left = vw - pw - 8;
  let top = r.top;
  if (top + ph > vh) top = vh - ph - 8;
  return { top: Math.max(8, top), left: Math.max(8, left) };
}

// ── Main ColorPicker ──────────────────────────────────────────────────────────

export default function ColorPicker({ value = "#000000", onChange, onClose, anchor, opacity = 100, onOpacityChange }) {
  // Internal HSV state (source of truth while picker is open)
  const [h, setH] = useState(0);
  const [s, setS] = useState(0);
  const [v, setV] = useState(0);
  const [alpha, setAlpha] = useState(() => Math.max(0, Math.min(100, opacity ?? 100)));
  const [tab, setTab] = useState("custom");
  const [format, setFormat] = useState("hex");
  const [hexInput, setHexInput] = useState("000000");
  const [paletteOpen, setPaletteOpen] = useState(null);
  const [hoveredStyleId, setHoveredStyleId] = useState(null);
  const [pendingLibraryAdd, setPendingLibraryAdd] = useState(false);
  const [newStyleName, setNewStyleName] = useState("");
  const [editingStyleId, setEditingStyleId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [editingColorId, setEditingColorId] = useState(null);

  const colorStyles = useEditorStore((s) => s.colorStyles);
  const addColorStyle = useEditorStore((s) => s.addColorStyle);
  const updateColorStyle = useEditorStore((s) => s.updateColorStyle);
  const deleteColorStyle = useEditorStore((s) => s.deleteColorStyle);
  const recentColors = useEditorStore((s) => s.recentColors);
  const addRecentColor = useEditorStore((s) => s.addRecentColor);
  const ops = useEditorStore((s) => s.ops);

  const [pos, setPos] = useState(() => getPos(anchor));
  const posRef = useRef(pos);
  posRef.current = pos;
  const onDragBarMouseDown = (e) => {
    e.preventDefault();
    const ox = e.clientX - posRef.current.left;
    const oy = e.clientY - posRef.current.top;
    const onMove = (mv) => setPos({ left: mv.clientX - ox, top: mv.clientY - oy });
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Sync initial value → HSV
  useEffect(() => {
    const hex = cssColorToHex(value) || "#000000";
    const [nh, ns, nv] = hexToHsv(hex);
    setH(nh); setS(ns); setV(nv);
    setHexInput(hex.replace("#", "").toUpperCase());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentHex = useMemo(() => hsvToHex(h, s, v), [h, s, v]);
  const pureHex    = useMemo(() => hsvToHex(h, 1, 1), [h]);

  const emit = useCallback((hex) => { onChange(hex); }, [onChange]);

  const handleBoardChange = useCallback((ns, nv) => {
    setS(ns); setV(nv);
    emit(hsvToHex(h, ns, nv));
  }, [h, emit]);

  const handleAlphaChange = useCallback((na) => {
    setAlpha(na);
    onOpacityChange?.(Math.round(na));
  }, [onOpacityChange]);

  const handleHueChange = useCallback((nh) => {
    setH(nh);
    emit(hsvToHex(nh, s, v));
  }, [s, v, emit]);

  const handleHexInput = useCallback((raw) => {
    const clean = raw.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6).toUpperCase();
    setHexInput(clean);
    if (clean.length === 6) {
      const hex = `#${clean}`;
      const [nh, ns, nv] = hexToHsv(hex);
      setH(nh); setS(ns); setV(nv);
      emit(hex);
    }
  }, [emit]);

  const applyColor = useCallback((hex) => {
    const [nh, ns, nv] = hexToHsv(hex);
    setH(nh); setS(ns); setV(nv);
    setHexInput(hex.replace("#", "").toUpperCase());
    emit(hex);
  }, [emit]);

  // Load a color into the picker display WITHOUT emitting onChange.
  // Used by the Saved tab so browsing saved colors doesn't mutate the canvas.
  const previewColor = useCallback((hex) => {
    const [nh, ns, nv] = hexToHsv(hex);
    setH(nh); setS(ns); setV(nv);
    setHexInput(hex.replace("#", "").toUpperCase());
  }, []);

  const handleClose = useCallback(() => {
    addRecentColor(currentHex);
    onClose();
  }, [currentHex, addRecentColor, onClose]);

  const handleEyedropper = useCallback(async () => {
    if (!window.EyeDropper) return;
    try {
      const ed = new window.EyeDropper();
      const res = await ed.open();
      if (res?.sRGBHex) applyColor(res.sRGBHex);
    } catch (_) {}
  }, [applyColor]);

  // Page colors from live DOM
  const pageColors = useMemo(() => {
    const root = ops?.getPageRoot?.();
    if (!root) return [];
    const seen = new Set();
    root.querySelectorAll("[data-mae-id]").forEach((el) => {
      ["backgroundColor", "color", "borderColor"].forEach((prop) => {
        const c = window.getComputedStyle(el)[prop];
        if (!c || c === "transparent") return;
        const hex = cssColorToHex(c);
        if (hex && hex !== "#000000") seen.add(hex);
      });
    });
    return [...seen].slice(0, 20);
  }, [ops]);

  // Click outside to close
  const pickerRef = useRef(null);
  useEffect(() => {
    const fn = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) handleClose();
    };
    const tid = setTimeout(() => document.addEventListener("mousedown", fn), 60);
    return () => { clearTimeout(tid); document.removeEventListener("mousedown", fn); };
  }, [handleClose]);

  const [r, g, b] = hexToRgb(currentHex);

  const S = {
    panel: {
      position: "fixed", top: pos.top, left: pos.left,
      width: 252, zIndex: 9999,
      background: "#1c1c1e",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 10,
      boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.5)",
      overflow: "hidden",
      fontSize: 12,
      color: "#e4e4e7",
      userSelect: "none",
    },
    tabBar: {
      display: "flex", alignItems: "center",
      borderBottom: "1px solid rgba(255,255,255,0.08)",
      padding: "0 12px",
    },
    tab: (active) => ({
      flex: 1, padding: "9px 0",
      background: "none", border: "none", cursor: "pointer",
      color: active ? "#fff" : "#71717a",
      fontWeight: active ? 600 : 400,
      fontSize: 12,
      borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
      marginBottom: -1,
      transition: "color .12s",
    }),
    close: {
      padding: "8px 4px", background: "none", border: "none",
      cursor: "pointer", color: "#52525b", marginLeft: 6,
      display: "flex", alignItems: "center",
    },
    section: { padding: 12 },
    label: {
      color: "#52525b", fontSize: 10,
      textTransform: "uppercase", letterSpacing: "0.06em",
      marginBottom: 6,
    },
    swatchRow: { display: "flex", gap: 4, flexWrap: "wrap" },
    input: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      color: "#fff", borderRadius: 6,
      padding: "4px 8px", fontSize: 12,
      fontFamily: "monospace", outline: "none",
    },
    numInput: {
      width: 38, textAlign: "center",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      color: "#fff", borderRadius: 6,
      padding: "4px 3px", fontSize: 11, outline: "none",
    },
    select: {
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      color: "#a1a1aa", borderRadius: 6,
      padding: "4px 6px", fontSize: 11, cursor: "pointer", outline: "none",
    },
    iconBtn: {
      padding: "5px 7px", borderRadius: 6,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.1)",
      cursor: "pointer", color: "#a1a1aa",
      display: "flex", alignItems: "center",
    },
    divider: { borderTop: "1px solid rgba(255,255,255,0.07)", margin: "10px 0" },
  };

  const picker = (
    <div ref={pickerRef} style={S.panel} onKeyDown={(e) => e.stopPropagation()}>
      {/* Drag handle */}
      <div
        onMouseDown={onDragBarMouseDown}
        style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "7px 0 4px", cursor: "grab", userSelect: "none" }}
        title="Drag to reposition"
      >
        <div style={{ width: 30, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.18)" }} />
      </div>
      {/* Tab bar */}
      <div style={S.tabBar}>
        <button style={S.tab(tab === "custom")} onClick={() => setTab("custom")}>Select</button>
        <button style={S.tab(tab === "libraries")} onClick={() => setTab("libraries")}>Saved</button>
        <button style={S.close} onClick={handleClose}><X size={13} /></button>
      </div>

      {tab === "custom" ? (
        <div style={{ ...S.section, maxHeight: 560, overflowY: "auto" }}>
          {/* HSV board */}
          <div style={{ marginBottom: 10 }}>
            <ColorBoard h={h} s={s} v={v} onChange={handleBoardChange} />
          </div>

          {/* Preview + sliders */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
              background: currentHex,
              border: "2px solid rgba(255,255,255,0.2)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)",
            }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <HSlider
                value={h} min={0} max={360}
                background="linear-gradient(to right,#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)"
                thumbColor={pureHex}
                onChange={handleHueChange}
              />
              <HSlider
                value={alpha} min={0} max={100}
                checkerboard
                background={`linear-gradient(to right, transparent, ${currentHex})`}
                thumbColor={currentHex}
                onChange={handleAlphaChange}
              />
            </div>
          </div>

          {/* Eyedropper + format + inputs */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
            {"EyeDropper" in window && (
              <button style={S.iconBtn} onClick={handleEyedropper} title="Pick from screen">
                <Pipette size={13} />
              </button>
            )}
            <select style={S.select} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="hex">Hex</option>
              <option value="rgb">RGB</option>
            </select>
            {format === "hex" ? (
              <>
                <input
                  style={{ ...S.input, flex: 1 }}
                  value={hexInput}
                  maxLength={6}
                  onChange={(e) => handleHexInput(e.target.value)}
                />
                <input
                  type="number"
                  style={S.numInput}
                  value={Math.round(alpha)}
                  min={0} max={100}
                  onChange={(e) => handleAlphaChange(Math.max(0, Math.min(100, +e.target.value)))}
                />
                <span style={{ color: "#52525b", fontSize: 11 }}>%</span>
              </>
            ) : (
              <>
                {[r, g, b].map((val, i) => (
                  <input
                    key={i}
                    type="number"
                    style={S.numInput}
                    value={val}
                    min={0} max={255}
                    onChange={(e) => {
                      const rgb = [r, g, b];
                      rgb[i] = Math.max(0, Math.min(255, +e.target.value));
                      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
                      const [nh, ns, nv] = hexToHsv(hex);
                      setH(nh); setS(ns); setV(nv);
                      setHexInput(hex.replace("#", "").toUpperCase());
                      emit(hex);
                    }}
                  />
                ))}
              </>
            )}
          </div>

          {/* Recent colors */}
          {recentColors.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={S.label}>Recent</div>
              <div style={S.swatchRow}>
                {recentColors.slice(0, 12).map((c) => (
                  <Swatch key={c} color={c} active={c === currentHex} onClick={applyColor} />
                ))}
              </div>
            </div>
          )}

          {/* Page colors */}
          {pageColors.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={S.label}>On this page</div>
              <div style={S.swatchRow}>
                {pageColors.map((c) => (
                  <Swatch key={c} color={c} active={c === currentHex} onClick={applyColor} />
                ))}
              </div>
            </div>
          )}

          {/* Built-in palettes */}
          <div style={S.divider} />
          {PALETTES.map(({ name, colors }) => (
            <div key={name} style={{ marginBottom: 4 }}>
              <button
                onClick={() => setPaletteOpen(paletteOpen === name ? null : name)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", cursor: "pointer",
                  color: "#71717a", fontSize: 10,
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  marginBottom: 4, padding: 0,
                }}
              >
                <span style={{ display: "inline-block", transition: "transform .1s", transform: paletteOpen === name ? "rotate(90deg)" : "none" }}>▶</span>
                {name}
              </button>
              {paletteOpen === name && (
                <div style={{ ...S.swatchRow, marginBottom: 6 }}>
                  {colors.map((c) => (
                    <Swatch key={c} color={c} active={c === currentHex} onClick={applyColor} />
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Save-as-style footer — shown when triggered from Libraries tab */}
          {(pendingLibraryAdd || editingColorId) && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 10, paddingTop: 10 }}>
              <div style={{ ...S.label, marginBottom: 6 }}>
                {editingColorId ? "Update library color" : "Save as library color"}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ width: 16, height: 16, borderRadius: 3, background: currentHex, flexShrink: 0, border: "1px solid rgba(255,255,255,0.15)" }} />
                {editingColorId ? (
                  <>
                    <button
                      onClick={() => {
                        updateColorStyle(editingColorId, { color: currentHex });
                        setEditingColorId(null);
                        setTab("libraries");
                      }}
                      style={{ flex: 1, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}
                    >
                      Update color
                    </button>
                    <button
                      onClick={() => { setEditingColorId(null); setTab("libraries"); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", padding: "2px 4px", display: "flex" }}
                    >
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      autoFocus
                      value={newStyleName}
                      onChange={(e) => setNewStyleName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newStyleName.trim()) {
                          addColorStyle({ id: uid(), name: newStyleName.trim(), color: currentHex });
                          setNewStyleName(""); setPendingLibraryAdd(false); setTab("libraries");
                        }
                        if (e.key === "Escape") { setNewStyleName(""); setPendingLibraryAdd(false); setTab("libraries"); }
                        e.stopPropagation();
                      }}
                      placeholder="Color name…"
                      style={{ ...S.input, flex: 1 }}
                    />
                    <button
                      onClick={() => {
                        if (!newStyleName.trim()) return;
                        addColorStyle({ id: uid(), name: newStyleName.trim(), color: currentHex });
                        setNewStyleName(""); setPendingLibraryAdd(false); setTab("libraries");
                      }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#22c55e", padding: "2px 4px", display: "flex" }}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={() => { setNewStyleName(""); setPendingLibraryAdd(false); setTab("libraries"); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", padding: "2px 4px", display: "flex" }}
                    >
                      <X size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Libraries tab */
        <div style={{ ...S.section, maxHeight: 560, overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={S.label}>Saved colors</span>
            <button
              onClick={() => { setNewStyleName(""); setPendingLibraryAdd(true); setTab("custom"); }}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#a1a1aa", borderRadius: 6,
                padding: "3px 8px", cursor: "pointer", fontSize: 11,
              }}
            >
              <Plus size={11} /> New color
            </button>
          </div>

          {colorStyles.length === 0 && (
            <div style={{ color: "#52525b", fontSize: 11, textAlign: "center", padding: "24px 0" }}>
              <div>No saved colors.</div>
              <div style={{ fontSize: 10, marginTop: 4 }}>Click "New color" to add one.</div>
            </div>
          )}

          {colorStyles.map((style) => (
            <div
              key={style.id}
              onMouseEnter={() => setHoveredStyleId(style.id)}
              onMouseLeave={() => setHoveredStyleId(null)}
              onClick={() => { if (editingStyleId !== style.id) previewColor(style.color); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 6px", borderRadius: 6, cursor: "pointer",
                background: hoveredStyleId === style.id ? "rgba(255,255,255,0.06)" : "transparent",
                transition: "background .1s",
              }}
            >
              <div
                onClick={(e) => {
                  if (editingStyleId === style.id) return;
                  e.stopPropagation();
                  previewColor(style.color);
                  setEditingColorId(style.id);
                  setTab("custom");
                }}
                style={{
                  width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                  background: style.color,
                  border: "1px solid rgba(255,255,255,0.12)",
                  outline: currentHex === style.color ? "2px solid #3b82f6" : "none",
                  outlineOffset: 1,
                  cursor: "pointer",
                }}
                title="Click to edit color"
              />
              {editingStyleId === style.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (editingName.trim()) updateColorStyle(style.id, { name: editingName.trim() });
                    setEditingStyleId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                    if (e.key === "Escape") setEditingStyleId(null);
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ ...S.input, flex: 1, padding: "2px 6px" }}
                />
              ) : (
                <span style={{ flex: 1, fontSize: 12, color: "#d4d4d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {style.name}
                </span>
              )}
              {hoveredStyleId === style.id && editingStyleId !== style.id && (
                <div style={{ display: "flex", gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setEditingStyleId(style.id); setEditingName(style.name); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", padding: 2, display: "flex" }}
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => deleteColorStyle(style.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#71717a", padding: 2, display: "flex" }}
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(picker, document.body);
}
