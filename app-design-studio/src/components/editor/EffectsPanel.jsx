import { useEffect, useRef, useState } from "react";
import { Plus, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import { EFFECT_TYPES, defaultEffect, parseEffects, applyEffects, splitBgLayers } from "@/lib/pro/effects";

const lbl = "text-[10px] text-zinc-500";
const inp = "w-full bg-black border border-white/10 text-white rounded px-1.5 py-1 text-[11px] outline-none focus:border-white/30";

function Num({ v, on, suffix }) {
  return (
    <div className="relative">
      <input type="number" value={v} onChange={(e) => on(e.target.value)} className={inp + " pr-4"} />
      {suffix && <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">{suffix}</span>}
    </div>
  );
}

/**
 * Try to recover effects from an element that has CSS box-shadow / filter set
 * directly (e.g. from AI edit or original HTML) but no data-mae-effects attr.
 */
function recoverEffectsFromCSS(el) {
  if (!el) return [];
  const recovered = [];
  const bs = el.style.boxShadow || getComputedStyle(el).boxShadow;
  if (bs && bs !== "none") {
    // Parse first shadow value into a drop-shadow effect
    const parts = bs.split(/,(?![^(]*\))/)[0].trim();
    const inset = parts.startsWith("inset");
    const nums = parts.replace("inset", "").trim().match(/-?\d+(?:\.\d+)?/g) || [];
    const [x = 0, y = 4, blur = 8, spread = 0] = nums.map(Number);
    // Extract color from the shadow string
    const colorMatch = parts.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);
    const color = colorMatch ? colorMatch[0] : "#000000";
    const hexColor = color.startsWith("#") ? color.slice(0, 7) : "#000000";
    const id = "fx-" + Math.random().toString(36).slice(2, 8);
    recovered.push({
      id, type: inset ? "inner-shadow" : "drop-shadow",
      enabled: true, x, y, blur, spread, color: hexColor, opacity: 30,
    });
  }
  return recovered;
}

// Figma-style effects: multiple, toggleable, reorderable effects per element.
export default function EffectsPanel({ getEl, apply, selKey }) {
  const [effects, setEffects] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState(false);
  const addRef = useRef(null);

  useEffect(() => {
    const el = getEl();
    const stored = parseEffects(el);
    // If element has no saved effects but has CSS shadows (from HTML/AI), recover them
    const effects = stored.length > 0 ? stored : recoverEffectsFromCSS(el);
    setEffects(effects);
    setOpenId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  useEffect(() => {
    const onDoc = (e) => { if (addRef.current && !addRef.current.contains(e.target)) setAdding(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const commit = (next) => {
    setEffects(next);
    apply((el) => applyEffects(el, next));
  };
  const patch = (id, p) => commit(effects.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const add = (type) => {
    const e = defaultEffect(type);
    commit([...effects, e]);
    setOpenId(e.id);
    setAdding(false);
  };
  const remove = (id) => commit(effects.filter((e) => e.id !== id));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= effects.length) return;
    const next = [...effects];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const numRow = (e, fields) => (
    <div className="grid grid-cols-2 gap-1.5 mt-2">
      {fields.map((f) => (
        <label key={f.k} className="space-y-0.5">
          <span className={lbl}>{f.label}</span>
          <Num v={e[f.k]} suffix={f.suffix} on={(val) => patch(e.id, { [f.k]: f.int ? parseInt(val || 0) : parseFloat(val || 0) })} />
        </label>
      ))}
    </div>
  );

  const editor = (e) => {
    switch (e.type) {
      case "drop-shadow":
      case "inner-shadow":
        return (
          <>
            {numRow(e, [
              { k: "x", label: "X" }, { k: "y", label: "Y" },
              { k: "blur", label: "Blur" }, { k: "spread", label: "Spread" },
            ])}
            <div className="grid grid-cols-2 gap-1.5 mt-1.5 items-end">
              <label className="space-y-0.5">
                <span className={lbl}>Color</span>
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(e.color) ? e.color : "#000000"} onChange={(ev) => patch(e.id, { color: ev.target.value })} className="w-full h-6 bg-transparent rounded cursor-pointer border border-white/10" />
              </label>
              <label className="space-y-0.5">
                <span className={lbl}>Opacity %</span>
                <Num v={e.opacity} on={(val) => patch(e.id, { opacity: parseInt(val || 0) })} />
              </label>
            </div>
          </>
        );
      case "layer-blur":
        return numRow(e, [{ k: "blur", label: "Blur", suffix: "px" }]);
      case "background-blur":
        return numRow(e, [{ k: "blur", label: "Blur", suffix: "px" }, { k: "transparency", label: "Transparency %" }]);
      case "noise":
        return numRow(e, [{ k: "intensity", label: "Intensity" }, { k: "scale", label: "Scale" }, { k: "opacity", label: "Opacity %" }]);
      case "texture":
        return (
          <>
            <label className="space-y-0.5 block mt-2">
              <span className={lbl}>Pattern</span>
              <select value={e.pattern} onChange={(ev) => patch(e.id, { pattern: ev.target.value })} className={inp}>
                {["dots", "grid", "lines", "cross"].map((p) => <option key={p} value={p} className="bg-zinc-900">{p}</option>)}
              </select>
            </label>
            {numRow(e, [{ k: "scale", label: "Scale" }, { k: "opacity", label: "Opacity %" }])}
          </>
        );
      case "glass":
        return numRow(e, [
          { k: "blur", label: "Blur", suffix: "px" }, { k: "transparency", label: "Transparency %" },
          { k: "borderOpacity", label: "Border %" }, { k: "saturation", label: "Saturation %" },
          { k: "reflection", label: "Reflection %" },
        ]);
      default: return null;
    }
  };

  const typeLabel = (t) => EFFECT_TYPES.find((x) => x.type === t)?.label || t;

  return (
    <div className="space-y-1.5" data-testid="effects-panel">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-500">{effects.length} effect{effects.length !== 1 ? "s" : ""}</span>
        <div className="relative" ref={addRef}>
          <button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white" data-testid="effect-add-btn">
            <Plus size={12} /> Add
          </button>
          {adding && (
            <div className="absolute right-0 z-30 bottom-full mb-1 w-40 bg-[#181818] border border-white/10 rounded-md shadow-2xl py-1" data-testid="effect-add-menu">
              {EFFECT_TYPES.map((t) => (
                <button key={t.type} onClick={() => add(t.type)} className="w-full text-left px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10" data-testid={`effect-add-${t.type}`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {effects.map((e, i) => (
        <div key={e.id} className="bg-black/40 border border-white/10 rounded-md" data-testid={`effect-row-${e.type}`}>
          <div className="flex items-center gap-1 px-2 py-1.5">
            <button onClick={() => setOpenId(openId === e.id ? null : e.id)} className="text-zinc-500 hover:text-white">
              {openId === e.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            <span className="flex-1 text-[11px] text-zinc-200 truncate">{typeLabel(e.type)}</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="text-zinc-600 hover:text-white disabled:opacity-30"><ChevronUp size={12} /></button>
            <button onClick={() => move(i, 1)} disabled={i === effects.length - 1} className="text-zinc-600 hover:text-white disabled:opacity-30"><ChevronDown size={12} /></button>
            <button onClick={() => patch(e.id, { enabled: !e.enabled })} className="text-zinc-400 hover:text-white" data-testid={`effect-toggle-${e.type}`}>
              {e.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button onClick={() => remove(e.id)} className="text-zinc-600 hover:text-red-400" data-testid={`effect-remove-${e.type}`}><Trash2 size={12} /></button>
          </div>
          {openId === e.id && <div className="px-2 pb-2.5">{editor(e)}</div>}
        </div>
      ))}
    </div>
  );
}
