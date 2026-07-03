import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useEditorStore } from "@/store/editorStore";
import { api } from "@/lib/pro/api";
import { fileToDataUrl } from "@/lib/pro/file";
import FontPicker from "@/components/editor/FontPicker";
import ColorPicker from "@/components/editor/ColorPicker";
import EffectsPanel from "@/components/editor/EffectsPanel";
import LibraryPanel from "@/components/editor/LibraryPanel";
import CreateTextStyleModal from "@/components/editor/CreateTextStyleModal";
import { loadGoogleFont, readableFamily } from "@/lib/pro/fonts";
import { getTextStyles, applyTextStyle } from "@/lib/pro/textStyles";
import { splitBgLayers } from "@/lib/pro/effects";
import GradientEditor, { buildGradient } from "@/components/editor/GradientEditor";
import {
  Sparkles, Loader2, Trash2, Copy, Upload, ImageOff,
  MousePointerSquareDashed, Lock, Unlock,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Underline, Strikethrough, Minus, WrapText,
  ChevronDown, ChevronUp, BookMarked, Plus, Palette, ExternalLink, X as XIcon, GripHorizontal,
} from "lucide-react";

// ── Floating draggable panel (used for detached EffectsPanel) ─────────────────
function FloatingDraggablePanel({ title, onClose, children, initialPos }) {
  const [pos, setPos] = useState(initialPos || { top: 120, left: window.innerWidth - 340 });
  const posRef = useRef(pos);
  posRef.current = pos;

  const onGripMouseDown = useCallback((e) => {
    e.preventDefault();
    const ox = e.clientX - posRef.current.left;
    const oy = e.clientY - posRef.current.top;
    const onMove = (mv) => setPos({ left: mv.clientX - ox, top: mv.clientY - oy });
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div
      style={{
        position: "fixed", top: pos.top, left: pos.left, zIndex: 9998,
        width: 280, background: "#1c1c1e",
        border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10,
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.5)",
        overflow: "hidden", fontSize: 12, color: "#e4e4e7",
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Drag bar */}
      <div
        onMouseDown={onGripMouseDown}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 10px 6px", cursor: "grab", userSelect: "none",
          borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <GripHorizontal size={13} style={{ color: "rgba(255,255,255,0.3)" }} />
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#71717a" }}>
            {title}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#52525b", display: "flex", padding: 2 }}
          title="Dock back to panel"
        >
          <XIcon size={13} />
        </button>
      </div>
      <div style={{ padding: "12px 12px 14px", maxHeight: 420, overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}

const TEXT_LIKE_TAGS = new Set(["P","SPAN","H1","H2","H3","H4","H5","H6","LABEL","A","BUTTON","LI","TD","TH"]);

const rgbToHex = (rgb) => {
  if (!rgb) return "";
  if (rgb.startsWith("#")) return rgb;
  // Transparent / none
  if (rgb === "transparent" || rgb === "rgba(0, 0, 0, 0)" || rgb === "rgba(0,0,0,0)") return "";
  const m = rgb.match(/\d+/g);
  if (!m) return "";
  const [r, g, b] = m.map(Number);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

/**
 * Read the "user-set" background of an element.
 * Returns: hex string | gradient string | "" (transparent)
 * Never returns #000000 for a transparent or gradient element.
 */
function readElementBg(el, cs) {
  // 1. Inline background-color takes highest priority (explicit user or AI set)
  //    Guard: el.style.backgroundColor may return CSS keywords like 'initial'
  //    when only the `background` shorthand was set — only trust rgb/rgba/# values.
  const inlineBgColor = el.style.backgroundColor;
  if (inlineBgColor && /^(#|rgb)/.test(inlineBgColor) &&
      inlineBgColor !== "transparent" &&
      inlineBgColor !== "rgba(0, 0, 0, 0)" && inlineBgColor !== "rgba(0,0,0,0)") {
    return rgbToHex(inlineBgColor) || inlineBgColor;
  }

  // 2. Check inline background-image for user-set gradients
  //    (strip any layers that were written by the effects system)
  const inlineBgImage = el.style.backgroundImage;
  if (inlineBgImage && inlineBgImage !== "none") {
    const fxBg = el.getAttribute("data-mae-fx-bg") || "";
    const fxParts = fxBg ? fxBg.split("||").map((p) => p.trim()) : [];
    const userParts = splitBgLayers(inlineBgImage).filter((p) => !fxParts.includes(p));
    const gradient = userParts.find((p) => /gradient/.test(p));
    if (gradient) return gradient;
  }

  // 3. Fall back to computed background-color (from CSS classes)
  const bgColor = cs.backgroundColor;
  if (!bgColor || bgColor === "transparent" ||
      bgColor === "rgba(0, 0, 0, 0)" || bgColor === "rgba(0,0,0,0)") {
    // No colour set — check if a gradient comes from a CSS class
    const computedBgImage = cs.backgroundImage;
    if (computedBgImage && computedBgImage !== "none" && /gradient/.test(computedBgImage)) {
      return computedBgImage;
    }
    return ""; // genuinely transparent
  }
  return rgbToHex(bgColor);
}

const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? "" : Math.round(n);
};

const hexToRgb = (hex) => {
  const h = (hex || "#000000").replace("#", "");
  return [parseInt(h.slice(0,2),16)||0, parseInt(h.slice(2,4),16)||0, parseInt(h.slice(4,6),16)||0];
};
const rgbToHexStr = (r, g, b) => "#" + [r,g,b].map(v => Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("");

/**
 * BackgroundRow — handles flat color, transparent, and gradient backgrounds.
 * Clicking the swatch opens ColorPicker (flat) or GradientEditor (gradient).
 * The palette icon toggles between gradient and flat color.
 */
function BackgroundRow({ value, onColorChange, onGradientChange, opacity, onOpacityChange }) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [gradEditorOpen, setGradEditorOpen] = useState(false);
  const swatchRef = useRef(null);

  const isGradient = value && /gradient/.test(value);
  const isTransparent = !value;
  const safeHex = !isGradient && /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#ffffff";

  const handleSwatchClick = () => {
    if (isGradient) { setGradEditorOpen((v) => !v); }
    else { batchStart(); setColorPickerOpen((v) => !v); }
  };

  const convertToGradient = () => {
    const base = safeHex;
    const [r, g, b] = hexToRgb(base);
    const end = rgbToHexStr(Math.min(255,r+60), Math.min(255,g+40), Math.min(255,b+80));
    onGradientChange(`linear-gradient(135deg, ${base}, ${end})`);
    setColorPickerOpen(false);
    setGradEditorOpen(true);
  };

  const convertToFlat = () => {
    onColorChange(safeHex);
    setGradEditorOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5 flex-1">
      {/* Swatch */}
      <button
        ref={swatchRef}
        onClick={handleSwatchClick}
        className="w-7 h-7 rounded border border-white/10 shrink-0 cursor-pointer relative overflow-hidden"
        style={isGradient ? { backgroundImage: value } : isTransparent ? {} : { background: safeHex }}
        data-testid="prop-bg"
        title={isGradient ? "Edit gradient" : safeHex}
      >
        {isTransparent && (
          <div style={{ position:"absolute", inset:0, background:"repeating-linear-gradient(45deg,#555 0,#555 2px,transparent 0,transparent 50%)", backgroundSize:"6px 6px" }} />
        )}
      </button>

      {/* Hex input or Gradient label */}
      {isGradient ? (
        <span className="text-xs text-zinc-400 flex-1 cursor-pointer" onClick={() => setGradEditorOpen((v) => !v)} data-testid="prop-bg-text">Gradient</span>
      ) : (
        <input
          value={(isTransparent ? "" : safeHex).replace("#", "").toUpperCase()}
          onFocus={batchStart}
          onBlur={batchEnd}
          onChange={(e) => {
            const hex = "#" + e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6);
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) onColorChange(hex);
          }}
          className={inputCls + " font-mono"}
          placeholder="transparent"
          data-testid="prop-bg-text"
        />
      )}

      {/* Gradient / Flat toggle */}
      <button
        onClick={isGradient ? convertToFlat : convertToGradient}
        title={isGradient ? "Convert to flat color" : "Convert to gradient"}
        className={`w-5 h-5 flex items-center justify-center rounded transition-colors shrink-0 ${isGradient ? "text-violet-400 bg-violet-400/10" : "text-zinc-500 hover:text-white hover:bg-white/10"}`}
        data-testid={isGradient ? "bg-to-color-btn" : "bg-to-gradient-btn"}
      >
        <Palette size={11} />
      </button>

      {/* Pickers */}
      {colorPickerOpen && !isGradient && (
        <ColorPicker
          value={safeHex}
          onChange={onColorChange}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
          onClose={() => { setColorPickerOpen(false); batchEnd(); }}
          anchor={swatchRef.current}
        />
      )}
      {gradEditorOpen && (
        <GradientEditor
          value={value}
          onChange={onGradientChange}
          onClose={() => setGradEditorOpen(false)}
          anchor={swatchRef.current}
        />
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-b border-white/10 px-4 py-3.5">
      <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 mb-3">
        {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 flex items-center gap-1.5">{children}</div>
    </div>
  );
}

const inputCls =
  "w-full bg-black border border-white/10 text-white rounded px-2 py-1 text-xs focus:border-white/30 outline-none";

const batchStart = () => useEditorStore.getState().startBatch?.();
const batchEnd = () => useEditorStore.getState().endBatch?.();

function NumInput({ value, onChange, suffix = "px", testid, placeholder }) {
  return (
    <div className="relative flex-1">
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onFocus={batchStart}
        onBlur={batchEnd}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls + " pr-6"}
        data-testid={testid}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">
        {suffix}
      </span>
    </div>
  );
}

function ColorInput({ value, onChange, opacity, onOpacityChange, testid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  // value may be: "" (transparent), "#rrggbb", or "linear-gradient(...)"
  const isGradient = value && /gradient/.test(value);
  const isTransparent = !value;
  const safeHex = (!isGradient && value && /^#[0-9a-fA-F]{6}$/.test(value)) ? value : "#ffffff";

  return (
    <div className="flex items-center gap-1.5 flex-1">
      <button
        ref={ref}
        onClick={() => { if (!isGradient) { batchStart(); setOpen(true); } }}
        className="w-7 h-7 rounded border border-white/10 shrink-0 cursor-pointer relative overflow-hidden"
        style={
          isGradient
            ? { backgroundImage: value }
            : isTransparent
            ? {}
            : { background: safeHex }
        }
        data-testid={testid}
        title={isGradient ? "Gradient" : safeHex}
      >
        {isTransparent && (
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#555 0,#555 2px,transparent 0,transparent 50%)", backgroundSize: "6px 6px" }} />
        )}
      </button>
      {isGradient ? (
        <span className="text-xs text-zinc-500 flex-1 truncate" data-testid={`${testid}-text`}>Gradient</span>
      ) : (
        <input
          value={(safeHex || "").replace("#", "").toUpperCase()}
          onFocus={batchStart}
          onBlur={batchEnd}
          onChange={(e) => {
            const hex = "#" + e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6);
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) onChange(hex);
          }}
          className={inputCls + " font-mono"}
          data-testid={`${testid}-text`}
        />
      )}
      {!isGradient && open && (
        <ColorPicker
          value={safeHex}
          onChange={onChange}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
          onClose={() => { setOpen(false); batchEnd(); }}
          anchor={ref.current}
        />
      )}
    </div>
  );
}

// ── Alignment buttons ─────────────────────────────────────────────────────────
function AlignButtons({ ids, ops }) {
  const zoom = useEditorStore((s) => s.zoom);

  const align = (type) => {
    const root = ops?.getPageRoot?.();
    if (!root || !ids?.length) return;
    const z = zoom;

    const items = ids
      .map((id) => {
        const el = root.querySelector(`[data-mae-id="${id}"]`);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const pr = el.parentElement?.getBoundingClientRect() || r;
        return { el, r, pr };
      })
      .filter(Boolean);

    if (!items.length) return;

    const isSingle = items.length === 1;
    const minL = isSingle ? items[0].pr.left  : Math.min(...items.map((i) => i.r.left));
    const minT = isSingle ? items[0].pr.top   : Math.min(...items.map((i) => i.r.top));
    const maxR = isSingle ? items[0].pr.right  : Math.max(...items.map((i) => i.r.right));
    const maxB = isSingle ? items[0].pr.bottom : Math.max(...items.map((i) => i.r.bottom));
    const cX = (minL + maxR) / 2;
    const cY = (minT + maxB) / 2;

    const sortedH = [...items].sort((a, b) => a.r.left - b.r.left);
    const sortedV = [...items].sort((a, b) => a.r.top - b.r.top);

    items.forEach(({ el, r, pr }) => {
      let tL = r.left;
      let tT = r.top;

      if (type === "left")         tL = minL;
      else if (type === "centerH") tL = cX - r.width / 2;
      else if (type === "right")   tL = maxR - r.width;
      else if (type === "top")     tT = minT;
      else if (type === "centerV") tT = cY - r.height / 2;
      else if (type === "bottom")  tT = maxB - r.height;
      else if (type === "distribH") {
        const totalW = sortedH.reduce((s, i) => s + i.r.width, 0);
        const gap = (maxR - minL - totalW) / Math.max(1, sortedH.length - 1);
        let cursor = minL;
        sortedH.forEach((item) => { item._tL = cursor; cursor += item.r.width + gap; });
        const me = sortedH.find((i) => i.el === el);
        if (me?._tL !== undefined) tL = me._tL;
      } else if (type === "distribV") {
        const totalH = sortedV.reduce((s, i) => s + i.r.height, 0);
        const gap = (maxB - minT - totalH) / Math.max(1, sortedV.length - 1);
        let cursor = minT;
        sortedV.forEach((item) => { item._tT = cursor; cursor += item.r.height + gap; });
        const me = sortedV.find((i) => i.el === el);
        if (me?._tT !== undefined) tT = me._tT;
      }

      const newX = Math.round((tL - pr.left) / z);
      const newY = Math.round((tT - pr.top) / z);
      el.dataset.maeX = newX;
      el.dataset.maeY = newY;
      el.style.transform = `translate(${newX}px, ${newY}px)`;
    });

    ops.commit?.();
    requestAnimationFrame(() => ops.recompute?.());
  };

  const btnCls = "p-1.5 rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-colors";

  return (
    <div className="flex items-center gap-0.5 px-4 py-2 border-b border-white/[0.06]">
      <button className={btnCls} title="Align left"              onClick={() => align("left")}>    <AlignStartVertical size={14} /></button>
      <button className={btnCls} title="Align center"            onClick={() => align("centerH")}> <AlignCenterVertical size={14} /></button>
      <button className={btnCls} title="Align right"             onClick={() => align("right")}>   <AlignEndVertical size={14} /></button>
      <div className="w-px h-4 bg-white/10 mx-1" />
      <button className={btnCls} title="Align top"               onClick={() => align("top")}>     <AlignStartHorizontal size={14} /></button>
      <button className={btnCls} title="Align middle"            onClick={() => align("centerV")}> <AlignCenterHorizontal size={14} /></button>
      <button className={btnCls} title="Align bottom"            onClick={() => align("bottom")}>  <AlignEndHorizontal size={14} /></button>
      {ids?.length > 1 && (
        <>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <button className={btnCls} title="Distribute horizontally" onClick={() => align("distribH")}><AlignHorizontalDistributeCenter size={14} /></button>
          <button className={btnCls} title="Distribute vertically"   onClick={() => align("distribV")}><AlignVerticalDistributeCenter size={14} /></button>
        </>
      )}
    </div>
  );
}

// ── Toggle button group ───────────────────────────────────────────────────────
function ToggleGroup({ options, value, onChange, testPrefix }) {
  return (
    <div className="flex gap-0.5 flex-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          title={opt.title}
          onClick={() => onChange(opt.value === value ? "" : opt.value)}
          className={`flex-1 flex items-center justify-center py-1.5 rounded text-xs transition-colors border ${
            value === opt.value
              ? "bg-white/20 border-white/40 text-white"
              : "bg-black/40 border-white/10 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
          }`}
          data-testid={testPrefix ? `${testPrefix}-${opt.value}` : undefined}
        >
          {opt.icon || opt.label}
        </button>
      ))}
    </div>
  );
}

function PageColorInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const displayVal = (value && /^#[0-9a-fA-F]{6}$/.test(value)) ? value : null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={ref}
        onClick={() => { batchStart(); setOpen(true); }}
        className="w-7 h-7 rounded border border-white/10 shrink-0 cursor-pointer relative overflow-hidden"
        style={displayVal ? { background: displayVal } : {}}
        title="Canvas background color"
        data-testid="page-color"
      >
        {!displayVal && (
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(45deg,#555 0,#555 2px,transparent 0,transparent 50%)", backgroundSize: "6px 6px" }} />
        )}
      </button>
      <input
        type="text"
        value={(value || "").replace("#", "").toUpperCase()}
        onFocus={batchStart}
        onBlur={batchEnd}
        onChange={(e) => {
          const hex = "#" + e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6);
          if (/^#[0-9A-Fa-f]{6}$/.test(hex)) onChange(hex);
          if (e.target.value === "") onChange("");
        }}
        placeholder="Canvas color…"
        className="flex-1 bg-black border border-white/10 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-white/30"
        data-testid="page-color-hex"
      />
      {open && (
        <ColorPicker
          value={displayVal || "#131315"}
          onChange={onChange}
          onClose={() => { setOpen(false); batchEnd(); }}
          anchor={ref.current}
        />
      )}
    </div>
  );
}

// ── Figma-style Typography Section ───────────────────────────────────────────
function TypographySection({ v, set, apply, getEl }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [textStyles, setTextStyles] = useState(() => getTextStyles());

  useEffect(() => {
    const refresh = () => setTextStyles(getTextStyles());
    window.addEventListener("mae:text-styles-changed", refresh);
    return () => window.removeEventListener("mae:text-styles-changed", refresh);
  }, []);

  const WEIGHTS = [["100","Thin"],["200","ExtraLight"],["300","Light"],["400","Regular"],["500","Medium"],["600","SemiBold"],["700","Bold"],["800","ExtraBold"],["900","Black"]];
  const alignOpts = [
    { value: "left", title: "Left", icon: <AlignLeft size={12} /> },
    { value: "center", title: "Center", icon: <AlignCenter size={12} /> },
    { value: "right", title: "Right", icon: <AlignRight size={12} /> },
    { value: "justify", title: "Justify", icon: <AlignJustify size={12} /> },
  ];
  const decorOpts = [
    { value: "none", title: "None", icon: <Minus size={11} /> },
    { value: "underline", title: "Underline", icon: <Underline size={11} /> },
    { value: "line-through", title: "Strikethrough", icon: <Strikethrough size={11} /> },
  ];
  const caseOpts = [
    { value: "none", title: "None", icon: <span className="text-[9px] font-bold leading-none">—</span> },
    { value: "uppercase", title: "UPPERCASE", icon: <span className="text-[9px] font-bold leading-none">AG</span> },
    { value: "lowercase", title: "lowercase", icon: <span className="text-[9px] leading-none">ag</span> },
    { value: "capitalize", title: "Title Case", icon: <span className="text-[9px] leading-none">Ag</span> },
  ];
  const listOpts = [
    { value: "none", title: "No list", icon: <Minus size={11} /> },
    { value: "disc", title: "Bullets", icon: <List size={11} /> },
    { value: "decimal", title: "Numbered", icon: <ListOrdered size={11} /> },
  ];
  const overflowOpts = [
    { value: "wrap", title: "Wrap", icon: <WrapText size={11} /> },
    { value: "truncate", title: "Truncate", icon: <span className="text-[9px] leading-none">A…</span> },
  ];
  const getTextOverflow = () => v.textOverflow === "ellipsis" ? "truncate" : "wrap";
  const setTextOverflow = (val) => apply((el) => {
    if (val === "truncate") {
      el.style.setProperty("overflow","hidden");
      el.style.setProperty("text-overflow","ellipsis");
      el.style.setProperty("white-space","nowrap");
    } else {
      el.style.removeProperty("overflow");
      el.style.removeProperty("text-overflow");
      el.style.setProperty("white-space","normal");
    }
  });

  const iconBtn = (active, onClick, title, Icon) => (
    <button
      title={title}
      onClick={onClick}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-colors ${
        active ? "bg-white/20 text-white" : "text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
      }`}
    >
      {typeof Icon === "function" ? <Icon /> : Icon}
    </button>
  );

  return (
    <div className="border-b border-white/10">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-500">Typography</span>
        <div className="flex items-center gap-1">
          {/* Save to library */}
          <button
            onClick={() => setShowSaveModal(true)}
            title="Save as text style"
            className="text-zinc-500 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
            data-testid="save-to-library-btn"
          >
            <Plus size={13} />
          </button>
          {/* Open library popover */}
          <button
            onClick={() => setShowLibrary((v) => !v)}
            title="Text styles library"
            className={`p-1 rounded transition-colors ${showLibrary ? "text-white bg-white/10" : "text-zinc-500 hover:text-white hover:bg-white/10"}`}
            data-testid="text-library-btn"
          >
            <BookMarked size={13} />
          </button>
        </div>
      </div>

      {/* ── Library popover ── */}
      {showLibrary && (
        <div className="mx-4 mb-2 rounded-lg bg-[#1a1a1a] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Text Styles</span>
            <button onClick={() => setShowLibrary(false)} className="text-zinc-600 hover:text-white text-[10px]">✕</button>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {textStyles.length === 0 ? (
              <p className="text-[11px] text-zinc-600 text-center py-4">No styles saved yet.</p>
            ) : textStyles.map((s) => (
              <button
                key={s.id}
                onClick={() => { apply((el) => applyTextStyle(el, s)); toast.success(`Applied "${s.name}"`); setShowLibrary(false); }}
                className="w-full flex items-center px-3 py-1.5 hover:bg-white/6 transition-colors text-left"
                data-testid={`library-style-${s.id}`}
              >
                <span style={{ fontFamily: s.fontFamily ? `'${s.fontFamily}',sans-serif` : "inherit", fontWeight: s.fontWeight || 400, fontSize: Math.min(s.fontSize||14,16) }} className="flex-1 truncate text-zinc-200">
                  {s.name}
                </span>
                <span className="text-[10px] text-zinc-600 shrink-0 ml-2">{s.fontSize}px</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setShowSaveModal(true); setShowLibrary(false); }}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-zinc-500 hover:text-white hover:bg-white/6 border-t border-white/10 transition-colors"
          >
            <Plus size={11} /> Create text style
          </button>
        </div>
      )}

      <div className="px-4 pb-3.5 space-y-2">
        {/* ── Font family ── */}
        <FontPicker
          value={readableFamily(v.fontFamily)}
          onChange={(fam) => {
            loadGoogleFont(fam);
            set("fontFamily", "font-family", fam === "inherit" ? "inherit" : `'${fam}', sans-serif`, "");
          }}
          textStyles={textStyles}
          onApplyTextStyle={(s) => { apply((el) => applyTextStyle(el, s)); toast.success(`Applied "${s.name}"`); }}
        />

        {/* ── Weight + Size ── */}
        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={v.fontWeight}
            onChange={(e) => set("fontWeight", "font-weight", e.target.value)}
            className={inputCls}
            data-testid="prop-weight"
          >
            {WEIGHTS.map(([w,l]) => <option key={w} value={w} className="bg-zinc-900">{l}</option>)}
          </select>
          <NumInput value={v.fontSize} onChange={(val) => set("fontSize", "font-size", val, "px")} testid="prop-fontsize" suffix="px" />
        </div>

        {/* ── Line height + Letter spacing ── */}
        <div className="grid grid-cols-2 gap-1.5">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600 text-[10px] pointer-events-none select-none font-medium">A̲</span>
            <NumInput value={v.lineHeight} onChange={(val) => set("lineHeight","line-height",val,"px")} testid="prop-lineheight" suffix="px" />
          </div>
          <div className="relative">
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-zinc-600 text-[9px] pointer-events-none select-none">|A|</span>
            <NumInput value={v.letterSpacing} onChange={(val) => set("letterSpacing","letter-spacing",val,"px")} testid="prop-letterspacing" suffix="px" />
          </div>
        </div>

        {/* ── Alignment row + Details toggle ── */}
        <div className="flex items-center justify-between">
          <div className="flex gap-0.5">
            {alignOpts.map((o) => iconBtn(v.textAlign === o.value, () => set("textAlign","text-align",o.value), o.title, () => o.icon))}
          </div>
          <button
            onClick={() => setShowDetails((d) => !d)}
            title={showDetails ? "Hide details" : "More options"}
            className={`flex items-center gap-1 text-[10px] px-1.5 py-1 rounded transition-colors ${showDetails ? "text-white bg-white/10" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/10"}`}
            data-testid="typo-details-toggle"
          >
            {showDetails ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>

        {/* ── Details (expandable) ── */}
        {showDetails && (
          <div className="space-y-1.5 pt-1 border-t border-white/10">
            {/* Decoration */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-16 shrink-0">Decoration</span>
              <div className="flex gap-0.5 flex-1">
                {decorOpts.map((o) => iconBtn(v.textDecoration === o.value || (!v.textDecoration && o.value === "none"), () => set("textDecoration","text-decoration",o.value || "none"), o.title, () => o.icon))}
              </div>
            </div>

            {/* Case */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-16 shrink-0">Case</span>
              <div className="flex gap-0.5 flex-1">
                {caseOpts.map((o) => iconBtn(v.textTransform === o.value || (!v.textTransform && o.value === "none"), () => set("textTransform","text-transform",o.value || "none"), o.title, () => o.icon))}
              </div>
            </div>

            {/* List style */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-16 shrink-0">List</span>
              <div className="flex gap-0.5 flex-1">
                {listOpts.map((o) => iconBtn(v.listStyleType === o.value, () => apply((el) => {
                  if (!o.value || o.value === "none") { el.style.setProperty("list-style-type","none"); el.style.removeProperty("padding-left"); }
                  else { el.style.setProperty("list-style-type",o.value); el.style.setProperty("padding-left","1.5em"); }
                }), o.title, () => o.icon))}
              </div>
            </div>

            {/* Overflow */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 w-16 shrink-0">Overflow</span>
              <div className="flex gap-0.5 flex-1">
                {overflowOpts.map((o) => iconBtn(getTextOverflow() === o.value, () => setTextOverflow(o.value), o.title, () => o.icon))}
              </div>
            </div>

            {/* Paragraph spacing */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-500">Para spacing</span>
                <NumInput value={v.paragraphSpacing} onChange={(val) => set("paragraphSpacing","margin-bottom",val,"px")} testid="prop-paragraph-spacing" suffix="px" />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-500">Word spacing</span>
                <NumInput value={v.wordSpacing} onChange={(val) => set("wordSpacing","word-spacing",val,"px")} testid="prop-word-spacing" suffix="px" />
              </div>
            </div>

            {/* Text indent */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-500">Indent</span>
                <NumInput value={v.textIndent} onChange={(val) => set("textIndent","text-indent",val,"px")} testid="prop-text-indent" suffix="px" />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-zinc-500">Smoothing</span>
                <select value={v.fontSmoothing||"auto"} onChange={(e) => { const val=e.target.value; apply((el) => { if(val==="antialiased"){el.style.setProperty("-webkit-font-smoothing","antialiased");el.style.setProperty("-moz-osx-font-smoothing","grayscale");}else if(val==="subpixel"){el.style.setProperty("-webkit-font-smoothing","subpixel-antialiased");el.style.removeProperty("-moz-osx-font-smoothing");}else{el.style.removeProperty("-webkit-font-smoothing");el.style.removeProperty("-moz-osx-font-smoothing");} }); }} className={inputCls} data-testid="prop-font-smoothing">
                  <option value="auto" className="bg-zinc-900">Auto</option>
                  <option value="antialiased" className="bg-zinc-900">Antialias</option>
                  <option value="subpixel" className="bg-zinc-900">Subpixel</option>
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Save to library modal ── */}
      {showSaveModal && (
        <CreateTextStyleModal
          getEl={getEl}
          onCreated={(s) => { setTextStyles(getTextStyles()); toast.success(`Saved "${s.name}"`); }}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}

export default function PropertiesPanel() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const ops = useEditorStore((s) => s.ops);
  const aiBusy = useEditorStore((s) => s.aiBusy);
  const setAiBusy = useEditorStore((s) => s.setAiBusy);
  const liveSize = useEditorStore((s) => s.liveSize);
  const aspectLocked = useEditorStore((s) => s.aspectLocked);
  const setAspectLocked = useEditorStore((s) => s.setAspectLocked);
  const page = useEditorStore((s) => s.page);
  const setPage = useEditorStore((s) => s.setPage);

  const [v, setV] = useState(null);
  const [tag, setTag] = useState("");
  const [maeType, setMaeType] = useState("");
  const [prompt, setPrompt] = useState("");
  const [effectsFloat, setEffectsFloat] = useState(false);
  const imgInputRef = useRef(null);
  const promptRef = useRef(null);

  const getEl = () => ops?.getEl?.(selectedId);

  const read = () => {
    const el = getEl();
    if (!el) { setV(null); return; }
    const cs = getComputedStyle(el);
    const inlineSmoothing = el.style.getPropertyValue("-webkit-font-smoothing");
    setTag(el.tagName);
    setMaeType(el.dataset?.maeType || "");
    setV({
      x: num(el.dataset.maeX || 0),
      y: num(el.dataset.maeY || 0),
      width: el.style.width ? num(el.style.width) : num(cs.width),
      height: el.style.height ? num(el.style.height) : num(cs.height),
      padding: num(cs.paddingTop),
      margin: num(cs.marginTop),
      fontFamily: el.style.fontFamily || "inherit",
      fontSize: num(cs.fontSize),
      fontWeight: num(cs.fontWeight) || 400,
      lineHeight: cs.lineHeight === "normal" ? "" : num(cs.lineHeight),
      letterSpacing: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) || 0,
      textAlign: cs.textAlign || "left",
      textDecoration: cs.textDecorationLine === "none" ? "none" : (cs.textDecorationLine || "none"),
      textTransform: cs.textTransform || "none",
      listStyleType: cs.listStyleType || "none",
      paragraphSpacing: num(cs.marginBottom),
      wordSpacing: cs.wordSpacing === "normal" ? 0 : parseFloat(cs.wordSpacing) || 0,
      textIndent: num(cs.textIndent),
      textOverflow: cs.textOverflow || "clip",
      whiteSpace: cs.whiteSpace || "normal",
      textOpacity: parseFloat(cs.opacity) || 1,
      fontSmoothing: inlineSmoothing === "antialiased" ? "antialiased" : inlineSmoothing === "subpixel-antialiased" ? "subpixel" : "auto",
      color: rgbToHex(cs.color),
      bg: readElementBg(el, cs),
      borderColor: rgbToHex(cs.borderColor),
      radius: num(cs.borderTopLeftRadius),
      shadow: el.style.boxShadow || "none",
      opacity: cs.opacity || "1",
      blur: (el.style.filter.match(/blur\((\d+)px\)/) || [, 0])[1],
      src: el.tagName === "IMG" ? el.getAttribute("src") || "" : "",
    });
  };

  useEffect(() => {
    read();
    setAspectLocked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!liveSize || liveSize.id !== selectedId) return;
    setV((prev) =>
      prev ? { ...prev, width: liveSize.w, height: liveSize.h, x: liveSize.x, y: liveSize.y } : prev
    );
  }, [liveSize, selectedId]);

  useEffect(() => {
    const focusAi = () => promptRef.current?.focus();
    window.addEventListener("mae:focus-ai", focusAi);
    return () => window.removeEventListener("mae:focus-ai", focusAi);
  }, []);

  const apply = (fn) => {
    const el = getEl();
    if (!el) return;
    fn(el);
    ops.commit();
    ops.recompute();
    // Re-read all properties from the actual element after any change
    // (keeps panel in sync with what's really on the element)
    requestAnimationFrame(() => read());
  };

  const set = (key, cssProp, val, unit = "") => {
    setV((p) => ({ ...p, [key]: val }));
    apply((el) => {
      if (val === "" || val === null) el.style.removeProperty(cssProp);
      else el.style.setProperty(cssProp, `${val}${unit}`);
    });
  };

  const runAi = async () => {
    const el = getEl();
    if (!el || !prompt.trim()) return;
    setAiBusy(true);
    try {
      const { data } = await api.post("/ai/edit", { html: el.outerHTML, prompt: prompt.trim() });
      ops.replaceSelectedHtml(data.html);
      setPrompt("");
      toast.success("Element updated by AI");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "AI edit failed");
    } finally {
      setAiBusy(false);
    }
  };

  // ── Multi-selection ────────────────────────────────────────────────────────
  if (selectedIds.length > 1) {
    const root = ops?.getPageRoot?.();

    const getShared = (fn) => {
      if (!root) return "";
      const vals = selectedIds
        .map((sid) => { const el = root.querySelector(`[data-mae-id="${sid}"]`); return el ? fn(el) : null; })
        .filter((v) => v !== null);
      if (!vals.length) return "";
      return vals.every((v) => v === vals[0]) ? vals[0] : "mixed";
    };

    const applyAll = (fn) => {
      if (!root) return;
      selectedIds.forEach((sid) => { const el = root.querySelector(`[data-mae-id="${sid}"]`); if (el) fn(el); });
      ops.commit();
      ops.recompute();
    };

    const setAll = (cssProp, val, unit = "") =>
      applyAll((el) => {
        if (val === "" || val === null) el.style.removeProperty(cssProp);
        else el.style.setProperty(cssProp, `${val}${unit}`);
      });

    const sharedBg = getShared((el) => {
      const cs = getComputedStyle(el);
      return readElementBg(el, cs) || "#transparent";
    });
    const sharedColor = getShared((el) => rgbToHex(getComputedStyle(el).color) || "#000000");
    const sharedRadius = getShared((el) => String(num(getComputedStyle(el).borderTopLeftRadius)));
    const sharedOpacity = getShared((el) => getComputedStyle(el).opacity || "1");
    const sharedFontSize = getShared((el) => String(num(getComputedStyle(el).fontSize)));
    const sharedFontWeight = getShared((el) => String(num(getComputedStyle(el).fontWeight) || 400));
    const sharedBorderColor = getShared((el) => rgbToHex(getComputedStyle(el).borderColor) || "#000000");

    return (
      <aside className="w-[280px] shrink-0 bg-[#121212] border-l border-white/10 flex flex-col h-full" data-testid="properties-panel">
        <div className="h-10 border-b border-white/10 flex items-center px-4">
          <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-400">{selectedIds.length} selected</span>
        </div>
        <AlignButtons ids={selectedIds} ops={ops} />
        <div className="flex gap-2 px-4 py-3 border-b border-white/10">
          <button onClick={() => ops.duplicateSelected()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 rounded-md py-1.5 text-xs transition-colors" data-testid="multi-duplicate-btn"><Copy size={13} /> Duplicate</button>
          <button onClick={() => ops.deleteSelected()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-red-500/10 hover:text-red-400 rounded-md py-1.5 text-xs transition-colors" data-testid="multi-delete-btn"><Trash2 size={13} /> Delete</button>
        </div>
        <div className="flex-1 overflow-y-auto pb-12">
          <Section title="Colors">
            <Row label="Fill"><ColorInput value={sharedBg === "mixed" ? "#ffffff" : sharedBg || ""} onChange={(val) => setAll("background-color", val)} testid="multi-prop-bg" /></Row>
            <Row label="Text"><ColorInput value={sharedColor === "mixed" ? "#ffffff" : sharedColor || "#000000"} onChange={(val) => setAll("color", val)} testid="multi-prop-color" /></Row>
            <Row label="Border"><ColorInput value={sharedBorderColor === "mixed" ? "#ffffff" : sharedBorderColor || ""} onChange={(val) => setAll("border-color", val)} testid="multi-prop-border" /></Row>
          </Section>
          <Section title="Effects">
            <Row label="Radius"><NumInput value={sharedRadius === "mixed" ? "" : sharedRadius} onChange={(val) => setAll("border-radius", val, "px")} testid="multi-prop-radius" /></Row>
            <Row label="Opacity">
              <input type="range" min="0" max="1" step="0.05" value={sharedOpacity === "mixed" ? "1" : sharedOpacity || "1"} onPointerDown={batchStart} onPointerUp={batchEnd} onChange={(e) => setAll("opacity", e.target.value)} className="flex-1 accent-white" data-testid="multi-prop-opacity" />
              <span className="text-[10px] text-zinc-500 w-8">{sharedOpacity === "mixed" ? "—" : `${Math.round(Number(sharedOpacity) * 100)}%`}</span>
            </Row>
          </Section>
          <Section title="Typography">
            <Row label="Size"><NumInput value={sharedFontSize === "mixed" ? "" : sharedFontSize} onChange={(val) => setAll("font-size", val, "px")} testid="multi-prop-fontsize" /></Row>
            <Row label="Weight">
              <select value={sharedFontWeight === "mixed" ? "" : sharedFontWeight || "400"} onChange={(e) => setAll("font-weight", e.target.value)} className={inputCls} data-testid="multi-prop-weight">
                {sharedFontWeight === "mixed" && <option value="" className="bg-zinc-900">Mixed</option>}
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (<option key={w} value={w} className="bg-zinc-900">{w}</option>))}
              </select>
            </Row>
          </Section>
        </div>
      </aside>
    );
  }

  const isText = maeType === "text" || (!maeType && TEXT_LIKE_TAGS.has(tag));

  return (
    <aside className="w-[280px] shrink-0 bg-[#121212] border-l border-white/10 flex flex-col h-full" data-testid="properties-panel">
      <div className="h-10 border-b border-white/10 flex items-center px-4">
        <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-400">
          {v ? `${tag.toLowerCase()} properties` : "Properties"}
        </span>
      </div>

      {!v ? (
        <div className="flex-1 overflow-y-auto pb-12">
          {/* Canvas color */}
          <div className="border-b border-white/10 px-4 py-3.5">
            <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 mb-3">Page</div>
            <PageColorInput value={page.background || ""} onChange={(hex) => setPage({ background: hex })} />
          </div>
          {/* Color + Text library */}
          <LibraryPanel getEl={getEl} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pb-12">

          {/* AI EDIT */}
          <div className="border-b border-white/10 px-4 py-3.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider uppercase text-yellow-500 mb-2.5">
              <Sparkles size={12} /> AI edit
            </div>
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runAi(); }
                else if (e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); }
              }}
              placeholder="e.g. Make this button modern, like Stripe  ·  ⌘K"
              rows={2}
              className="w-full bg-black border border-white/10 rounded-md px-2.5 py-2 text-xs focus:border-yellow-500/50 outline-none resize-none"
              data-testid="ai-prompt-input"
            />
            <button
              onClick={runAi}
              disabled={aiBusy || !prompt.trim()}
              className="mt-2 w-full flex items-center justify-center gap-2 bg-gradient-to-r from-yellow-500/20 to-yellow-500/10 border border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/30 disabled:opacity-40 rounded-md py-1.5 text-xs font-medium transition-all"
              data-testid="ai-apply-btn"
            >
              {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {aiBusy ? "Applying…" : "Apply to selected"}
            </button>
          </div>

          {/* Quick actions */}
          <div className="flex gap-2 px-4 py-3 border-b border-white/10">
            <button onClick={() => ops.duplicateSelected()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 rounded-md py-1.5 text-xs transition-colors" data-testid="duplicate-btn"><Copy size={13} /> Duplicate</button>
            <button onClick={() => ops.deleteSelected()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-red-500/10 hover:text-red-400 rounded-md py-1.5 text-xs transition-colors" data-testid="delete-btn"><Trash2 size={13} /> Delete</button>
          </div>

          {/* IMAGE controls */}
          {tag === "IMG" && (
            <Section title="Image">
              <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = await fileToDataUrl(f);
                  setV((p) => ({ ...p, src: url }));
                  apply((el) => el.setAttribute("src", url));
                }}
                data-testid="img-file-input"
              />
              <div className="flex gap-2">
                <button onClick={() => imgInputRef.current?.click()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-zinc-800 rounded-md py-1.5 text-xs" data-testid="replace-img-btn"><Upload size={13} /> Replace</button>
                <button onClick={() => ops.deleteSelected()} className="flex-1 flex items-center justify-center gap-1.5 bg-zinc-900 border border-white/10 hover:bg-red-500/10 hover:text-red-400 rounded-md py-1.5 text-xs" data-testid="remove-img-btn"><ImageOff size={13} /> Remove</button>
              </div>
              <Row label="Source">
                <input value={v.src} onChange={(e) => { const url = e.target.value; setV((p) => ({ ...p, src: url })); apply((el) => el.setAttribute("src", url)); }} className={inputCls + " font-mono"} />
              </Row>
            </Section>
          )}

          {/* POSITION */}
          <Section title="Position">
            <AlignButtons ids={[selectedId]} ops={ops} />
            <Row label="X / Y">
              <NumInput value={v.x} onChange={(val) => { setV((p) => ({ ...p, x: val })); apply((el) => { el.dataset.maeX = val || 0; el.style.transform = `translate(${val || 0}px, ${el.dataset.maeY || 0}px)`; }); }} testid="pos-x" />
              <NumInput value={v.y} onChange={(val) => { setV((p) => ({ ...p, y: val })); apply((el) => { el.dataset.maeY = val || 0; el.style.transform = `translate(${el.dataset.maeX || 0}px, ${val || 0}px)`; }); }} testid="pos-y" />
            </Row>
          </Section>

          {/* LAYOUT */}
          <Section title="Layout">
            <Row label="W / H">
              <NumInput value={v.width} onChange={(val) => {
                const next = { ...v, width: val };
                if (aspectLocked && v.width && v.height) {
                  const newH = Math.round(val * (v.height / v.width));
                  next.height = newH;
                  apply((el) => { el.style.setProperty("width", `${val}px`); el.style.setProperty("height", `${newH}px`); });
                } else {
                  apply((el) => el.style.setProperty("width", `${val}px`));
                }
                setV(next);
              }} testid="prop-width" />
              <button onClick={() => setAspectLocked(!aspectLocked)} title={aspectLocked ? "Unlock aspect ratio" : "Lock aspect ratio"} className={`shrink-0 w-6 h-6 flex items-center justify-center rounded transition-colors ${aspectLocked ? "text-blue-400 bg-blue-400/10" : "text-zinc-600 hover:text-zinc-300"}`} data-testid="aspect-lock-btn">
                {aspectLocked ? <Lock size={11} /> : <Unlock size={11} />}
              </button>
              <NumInput value={v.height} onChange={(val) => {
                const next = { ...v, height: val };
                if (aspectLocked && v.width && v.height) {
                  const newW = Math.round(val * (v.width / v.height));
                  next.width = newW;
                  apply((el) => { el.style.setProperty("height", `${val}px`); el.style.setProperty("width", `${newW}px`); });
                } else {
                  apply((el) => el.style.setProperty("height", `${val}px`));
                }
                setV(next);
              }} testid="prop-height" />
            </Row>
            <Row label="Padding"><NumInput value={v.padding} onChange={(val) => set("padding", "padding", val, "px")} testid="prop-padding" /></Row>
            <Row label="Margin"><NumInput value={v.margin} onChange={(val) => set("margin", "margin", val, "px")} testid="prop-margin" /></Row>
          </Section>

          {/* ADVANCED TYPOGRAPHY — only for text-typed elements */}
          {isText && (
            <TypographySection v={v} set={set} apply={apply} getEl={getEl} />
          )}

          {/* COLORS */}
          <Section title="Colors">
            {isText && (
              <Row label="Text"><ColorInput value={v.color || "#000000"} onChange={(val) => set("color", "color", val)} testid="prop-color" /></Row>
            )}
            <Row label="Background">
              <BackgroundRow
                value={v.bg}
                onColorChange={(val) => set("bg", "background-color", val)}
                onGradientChange={(gradCSS) => {
                  setV((p) => ({ ...p, bg: gradCSS }));
                  apply((el) => {
                    // Preserve effect layers; write user gradient below them
                    const fxBg = el.getAttribute("data-mae-fx-bg") || "";
                    const fxParts = fxBg ? fxBg.split("||").filter(Boolean) : [];
                    const combined = [...fxParts, gradCSS].join(", ");
                    el.style.setProperty("background-image", combined);
                    el.style.removeProperty("background-color");
                  });
                }}
                opacity={Math.round(parseFloat(v.opacity || 1) * 100)}
                onOpacityChange={(pct) => set("opacity", "opacity", pct / 100)}
              />
            </Row>
            <Row label="Border"><ColorInput value={v.borderColor || ""} onChange={(val) => set("borderColor", "border-color", val)} testid="prop-border" /></Row>
          </Section>

          {/* EFFECTS — Figma-style layered effects panel */}
          <div className="border-b border-white/10 px-4 py-3.5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500">Effects</div>
              <button
                onClick={() => setEffectsFloat((v) => !v)}
                title={effectsFloat ? "Dock back" : "Open as floating panel"}
                className={`p-1 rounded transition-colors ${effectsFloat ? "text-blue-400 bg-blue-400/10" : "text-zinc-600 hover:text-white hover:bg-white/10"}`}
                data-testid="effects-float-btn"
              >
                <ExternalLink size={11} />
              </button>
            </div>
            <div className="space-y-2">
              <Row label="Radius"><NumInput value={v.radius} onChange={(val) => set("radius", "border-radius", val, "px")} testid="prop-radius" /></Row>
              <Row label="Opacity">
                <input type="range" min="0" max="1" step="0.05" value={v.opacity} onPointerDown={batchStart} onPointerUp={batchEnd} onChange={(e) => set("opacity", "opacity", e.target.value)} className="flex-1 accent-white" data-testid="prop-opacity" />
                <span className="text-[10px] text-zinc-500 w-8">{Math.round(v.opacity * 100)}%</span>
              </Row>
              <Row label="Blur"><NumInput value={v.blur} onChange={(val) => { setV((p) => ({ ...p, blur: val })); apply((el) => { el.style.filter = val && +val > 0 ? `blur(${val}px)` : ""; }); }} testid="prop-blur" /></Row>
            </div>

            {/* Figma-style effects (drop shadow, inner shadow, blur, glass, etc.) */}
            {!effectsFloat && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <EffectsPanel getEl={getEl} apply={apply} selKey={selectedId} />
              </div>
            )}
            {effectsFloat && createPortal(
              <FloatingDraggablePanel title="Effects" onClose={() => setEffectsFloat(false)}>
                <EffectsPanel getEl={getEl} apply={apply} selKey={selectedId} />
              </FloatingDraggablePanel>,
              document.body
            )}
          </div>

        </div>
      )}
    </aside>
  );
}
