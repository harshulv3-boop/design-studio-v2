import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Settings2, Trash2, Copy, Check, X, Pencil } from "lucide-react";
import {
  getTextStyles, createTextStyle, deleteTextStyle, duplicateTextStyle,
  renameTextStyle, updateTextStyle, applyTextStyle, captureTextStyle,
} from "@/lib/pro/textStyles";

const inp = "w-full bg-black border border-white/10 text-white rounded px-2 py-1 text-xs outline-none focus:border-white/30";

// Library > Text Styles: create/apply/manage reusable typography presets.
export default function TextStylesControl({ getEl, apply, onApplied }) {
  const [styles, setStyles] = useState(getTextStyles());
  const [manage, setManage] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const refresh = () => setStyles(getTextStyles());
    window.addEventListener("mae:text-styles-changed", refresh);
    return () => window.removeEventListener("mae:text-styles-changed", refresh);
  }, []);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setManage(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const applyStyle = (id) => {
    const s = styles.find((x) => x.id === id);
    if (!s) return;
    apply((el) => applyTextStyle(el, s));
    onApplied?.();
    toast.success(`Applied "${s.name}"`);
  };

  const saveCurrent = () => {
    const el = getEl();
    if (!el) return;
    const name = window.prompt("New text style name", "New style");
    if (!name) return;
    const [, created] = createTextStyle(captureTextStyle(el, name));
    setStyles(getTextStyles());
    apply((el2) => el2.setAttribute("data-mae-textstyle", created.id));
    toast.success(`Saved "${name}"`);
  };

  const updateFromCurrent = (id) => {
    const el = getEl();
    if (!el) return;
    const cap = captureTextStyle(el);
    delete cap.name;
    updateTextStyle(id, cap);
    setStyles(getTextStyles());
    toast.success("Style updated from selection");
  };

  return (
    <div className="flex items-center gap-1.5 flex-1" ref={ref}>
      <select
        value=""
        onChange={(e) => e.target.value && applyStyle(e.target.value)}
        className={inp}
        data-testid="text-style-select"
      >
        <option value="">Apply text style…</option>
        {styles.map((s) => (
          <option key={s.id} value={s.id} className="bg-zinc-900">{s.name}</option>
        ))}
      </select>
      <button onClick={saveCurrent} title="Save current as new style" className="shrink-0 w-7 h-7 flex items-center justify-center rounded bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-zinc-300" data-testid="text-style-save-btn">
        <Plus size={13} />
      </button>
      <div className="relative shrink-0">
        <button onClick={() => setManage((m) => !m)} title="Manage text styles" className="w-7 h-7 flex items-center justify-center rounded bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-zinc-300" data-testid="text-style-manage-btn">
          <Settings2 size={13} />
        </button>
        {manage && (
          <div className="absolute right-0 z-40 mt-1 w-60 bg-[#181818] border border-white/10 rounded-md shadow-2xl p-2" data-testid="text-style-manage-menu">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 pb-1.5">Text styles</div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {styles.map((s) => (
                <div key={s.id} className="flex items-center gap-1 bg-black/40 border border-white/10 rounded px-1.5 py-1" data-testid={`text-style-item-${s.id}`}>
                  {editingId === s.id ? (
                    <>
                      <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} className="flex-1 bg-black border border-white/10 rounded px-1.5 py-0.5 text-[11px] outline-none" />
                      <button onClick={() => { renameTextStyle(s.id, editName || s.name); setEditingId(null); setStyles(getTextStyles()); }} className="text-emerald-400"><Check size={12} /></button>
                      <button onClick={() => setEditingId(null)} className="text-zinc-500"><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => applyStyle(s.id)} className="flex-1 text-left text-[11px] text-zinc-200 truncate hover:text-white" title="Apply">{s.name}</button>
                      <button onClick={() => updateFromCurrent(s.id)} title="Update from selection" className="text-zinc-500 hover:text-white"><Pencil size={11} /></button>
                      <button onClick={() => { setEditingId(s.id); setEditName(s.name); }} title="Rename" className="text-zinc-500 hover:text-white text-[9px] font-bold px-0.5">Aa</button>
                      <button onClick={() => { duplicateTextStyle(s.id); setStyles(getTextStyles()); }} title="Duplicate" className="text-zinc-500 hover:text-white"><Copy size={11} /></button>
                      <button onClick={() => { deleteTextStyle(s.id); setStyles(getTextStyles()); }} title="Delete" className="text-zinc-600 hover:text-red-400"><Trash2 size={11} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
