/**
 * GradientEditor — Figma-style gradient editor
 * Floating panel anchored to the background swatch button.
 *
 * Props:
 *   value    — CSS gradient string (linear-gradient(...) | radial-gradient(...))
 *   onChange — fn(gradientCSS) called live as user edits
 *   onClose  — fn()
 *   anchor   — DOM element to position relative to
 */
import { useEffect, useRef, useState } from "react";
import { X, Trash2 } from "lucide-react";
import ColorPicker from "./ColorPicker";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = (hex || "#000000").replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) || 0,
    parseInt(h.slice(2, 4), 16) || 0,
    parseInt(h.slice(4, 6), 16) || 0,
  ];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function colorStrToHex(str) {
  if (!str) return "#ffffff";
  str = str.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(str)) return str.slice(0, 7).padEnd(7, "0");
  const m = str.match(/\d+/g);
  if (m && m.length >= 3) return rgbToHex(+m[0], +m[1], +m[2]);
  return "#ffffff";
}

/** Split a string on top-level commas only (safe inside nested functions). */
function splitTop(str) {
  const result = [];
  let depth = 0, current = "";
  for (const c of str || "") {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

// ─── Parse / build ───────────────────────────────────────────────────────────

export function parseGradient(css) {
  const def = {
    type: "linear", angle: 135,
    stops: [
      { id: "s0", color: "#6366f1", pos: 0 },
      { id: "s1", color: "#8b5cf6", pos: 100 },
    ],
  };
  if (!css || !css.includes("gradient")) return def;

  const type = css.includes("radial") ? "radial" : "linear";
  const inner = css.match(/gradient\((.+)\)$/s)?.[1] || "";
  if (!inner) return def;

  const parts = splitTop(inner);
  if (!parts.length) return def;

  let angle = 135;
  let stopParts = parts;
  const first = parts[0].trim();

  const angMatch = first.match(/^(-?\d+(?:\.\d+)?)\s*deg$/i);
  if (angMatch) {
    angle = parseFloat(angMatch[1]);
    stopParts = parts.slice(1);
  } else if (first.startsWith("to ")) {
    const map = {
      "to right": 90, "to left": 270, "to bottom": 180, "to top": 0,
      "to bottom right": 135, "to bottom left": 225,
      "to top right": 45, "to top left": 315,
    };
    angle = map[first] ?? 135;
    stopParts = parts.slice(1);
  }

  if (!stopParts.length) return { type, angle, stops: def.stops };

  const stops = stopParts.map((p, i) => {
    const posMatch = p.match(/(\d+(?:\.\d+)?)%\s*$/);
    const pos = posMatch
      ? parseFloat(posMatch[1])
      : (i / Math.max(1, stopParts.length - 1)) * 100;
    const colorStr = posMatch
      ? p.slice(0, p.lastIndexOf(posMatch[0])).trim()
      : p.trim();
    return {
      id: `s${i}_${Math.random().toString(36).slice(2, 5)}`,
      color: colorStrToHex(colorStr),
      pos: Math.round(pos * 10) / 10,
    };
  });

  return { type, angle, stops };
}

export function buildGradient({ type, angle, stops }) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const stopStr = sorted.map((s) => `${s.color} ${s.pos.toFixed(1)}%`).join(", ");
  if (type === "radial") return `radial-gradient(circle at center, ${stopStr})`;
  return `linear-gradient(${Math.round(angle)}deg, ${stopStr})`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function GradientEditor({ value, onChange, onClose, anchor }) {
  const [grad, setGrad] = useState(() => parseGradient(value));
  const [selId, setSelId] = useState(() => {
    const g = parseGradient(value);
    return g.stops[0]?.id || null;
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const barRef = useRef(null);
  const colorBtnRef = useRef(null);
  const dragging = useRef(null);

  // Recalculate position — anchor to the swatch button
  const panelStyle = {};
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    panelStyle.position = "fixed";
    panelStyle.top = r.bottom + 8;
    panelStyle.left = Math.max(8, Math.min(r.left, window.innerWidth - 274));
    panelStyle.zIndex = 9999;
  } else {
    panelStyle.position = "fixed";
    panelStyle.top = 200;
    panelStyle.right = 320;
    panelStyle.zIndex = 9999;
  }

  const commit = (next) => {
    setGrad(next);
    onChange(buildGradient(next));
  };

  const updateStop = (id, patch) =>
    commit({ ...grad, stops: grad.stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const selStop = grad.stops.find((s) => s.id === selId) ?? grad.stops[0];

  // ── Bar interactions ────────────────────────────────────────────────────

  const getPos = (clientX) => {
    const bar = barRef.current;
    if (!bar) return 0;
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
  };

  const onBarClick = (e) => {
    // Only add stop on direct bar click (not handle drag release)
    if (dragging.current) return;
    const pos = getPos(e.clientX);
    // Interpolate color
    const sorted = [...grad.stops].sort((a, b) => a.pos - b.pos);
    const before = [...sorted].reverse().find((s) => s.pos <= pos) || sorted[0];
    const after = sorted.find((s) => s.pos > pos) || sorted[sorted.length - 1];
    const t = before === after ? 0 : (pos - before.pos) / Math.max(0.001, after.pos - before.pos);
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    const [br, bg, bb] = hexToRgb(before.color);
    const [ar, ag, ab] = hexToRgb(after.color);
    const color = rgbToHex(lerp(br, ar), lerp(bg, ag), lerp(bb, ab));
    const newStop = { id: `s${Date.now()}`, color, pos: Math.round(pos * 10) / 10 };
    const next = { ...grad, stops: [...grad.stops, newStop] };
    commit(next);
    setSelId(newStop.id);
  };

  const startDrag = (e, id) => {
    e.stopPropagation();
    e.preventDefault();
    setSelId(id);
    dragging.current = id;

    const onMove = (ev) => {
      if (!dragging.current) return;
      const pos = getPos(ev.clientX);
      setGrad((prev) => {
        const next = {
          ...prev,
          stops: prev.stops.map((s) =>
            s.id === dragging.current ? { ...s, pos: Math.round(pos * 10) / 10 } : s
          ),
        };
        onChange(buildGradient(next));
        return next;
      });
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Close on outside click
  useEffect(() => {
    const handle = (e) => {
      const panel = document.querySelector("[data-gradient-editor]");
      if (panel && !panel.contains(e.target) && anchor && !anchor.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [anchor, onClose]);

  const gradientCss = buildGradient(grad);

  return (
    <div
      style={panelStyle}
      data-gradient-editor
      data-testid="gradient-editor"
      className="bg-[#1e1e1e] border border-white/10 rounded-xl shadow-2xl w-[264px] overflow-visible"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        {/* Type toggle */}
        <div className="flex bg-white/5 rounded-md p-0.5 gap-0.5">
          {["linear", "radial"].map((t) => (
            <button
              key={t}
              onClick={() => commit({ ...grad, type: t })}
              className={`text-[10px] px-2.5 py-0.5 rounded capitalize transition-colors ${
                grad.type === t
                  ? "bg-white/15 text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              data-testid={`gradient-type-${t}`}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-white transition-colors ml-2"
          data-testid="gradient-editor-close"
        >
          <X size={13} />
        </button>
      </div>

      {/* Gradient bar + stop handles */}
      <div className="px-3 pb-1">
        <div className="relative pb-4">
          {/* Bar */}
          <div
            ref={barRef}
            onClick={onBarClick}
            className="h-7 rounded-md cursor-crosshair border border-white/10 select-none"
            style={{ backgroundImage: gradientCss, backgroundSize: "100% 100%" }}
            data-testid="gradient-bar"
          />

          {/* Stop handles — positioned below bar */}
          {grad.stops.map((s) => (
            <div
              key={s.id}
              onMouseDown={(e) => startDrag(e, s.id)}
              onClick={(e) => { e.stopPropagation(); setSelId(s.id); }}
              style={{
                backgroundColor: s.color,
                left: `calc(${s.pos}% - 7px)`,
                bottom: 2,
                position: "absolute",
              }}
              className={`w-3.5 h-3.5 rounded-full border-2 cursor-grab select-none transition-all ${
                selId === s.id
                  ? "border-white shadow-md shadow-white/20 scale-110 z-10"
                  : "border-white/50 z-0"
              }`}
              data-testid={`gradient-stop-handle`}
            />
          ))}
        </div>
      </div>

      {/* Selected stop controls */}
      {selStop && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex items-center gap-2">
            {/* Color swatch */}
            <button
              ref={colorBtnRef}
              onClick={() => setPickerOpen((v) => !v)}
              className="w-7 h-7 rounded border border-white/20 shrink-0 cursor-pointer"
              style={{ backgroundColor: selStop.color }}
              data-testid="gradient-stop-color-btn"
            />
            {/* Hex input */}
            <input
              value={(selStop.color || "").replace("#", "").toUpperCase()}
              onChange={(e) => {
                const hex = "#" + e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6);
                if (/^#[0-9A-Fa-f]{6}$/.test(hex)) updateStop(selStop.id, { color: hex });
              }}
              className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-white/30"
              data-testid="gradient-stop-color-input"
            />
            {/* Position */}
            <div className="relative w-14 shrink-0">
              <input
                type="number"
                min="0"
                max="100"
                value={Math.round(selStop.pos)}
                onChange={(e) =>
                  updateStop(selStop.id, {
                    pos: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)),
                  })
                }
                className="w-full bg-black border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-white/30 pr-4"
                data-testid="gradient-stop-pos-input"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">%</span>
            </div>
            {/* Remove stop */}
            {grad.stops.length > 2 && (
              <button
                onClick={() => {
                  const next = { ...grad, stops: grad.stops.filter((s) => s.id !== selStop.id) };
                  commit(next);
                  setSelId(next.stops[0]?.id || null);
                }}
                className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                data-testid="gradient-stop-remove"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>

          {/* Angle (linear only) */}
          {grad.type === "linear" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-8 shrink-0">Angle</span>
              <input
                type="range"
                min="0"
                max="359"
                value={Math.round(grad.angle)}
                onChange={(e) => commit({ ...grad, angle: parseInt(e.target.value) })}
                className="flex-1 h-1 rounded-full appearance-none bg-white/10 accent-violet-500 cursor-pointer"
                data-testid="gradient-angle-slider"
              />
              <div className="relative w-12 shrink-0">
                <input
                  type="number"
                  min="0"
                  max="359"
                  value={Math.round(grad.angle)}
                  onChange={(e) => commit({ ...grad, angle: parseInt(e.target.value) || 0 })}
                  className="w-full bg-black border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-white/30 pr-3"
                  data-testid="gradient-angle-input"
                />
                <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">°</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color picker for selected stop */}
      {pickerOpen && selStop && (
        <ColorPicker
          value={selStop.color}
          onChange={(hex) => updateStop(selStop.id, { color: hex })}
          onClose={() => setPickerOpen(false)}
          anchor={colorBtnRef.current}
        />
      )}
    </div>
  );
}
