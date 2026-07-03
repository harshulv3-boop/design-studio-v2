import { useRef, useState } from "react";
import { Plus, Trash2, Pencil, Check, Copy, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/store/editorStore";
import { getTextStyles, deleteTextStyle, duplicateTextStyle, renameTextStyle, applyTextStyle } from "@/lib/pro/textStyles";
import ColorPicker from "@/components/editor/ColorPicker";
import CreateTextStyleModal from "@/components/editor/CreateTextStyleModal";

function uid() { return Math.random().toString(36).slice(2); }

/**
 * Clean library panel — Color and Text tabs only.
 * Used in the right Properties panel when nothing is selected.
 */
export default function LibraryPanel({ getEl, apply }) {
  const [tab, setTab] = useState("color");

  const tabCls = (t) =>
    `flex-1 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
      tab === t ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div className="border-t border-white/10">
      <div className="px-4 pt-3 pb-1">
        <div className="text-[10px] font-medium tracking-wider uppercase text-zinc-500 mb-2">Library</div>
        <div className="flex gap-1 bg-black/40 rounded-lg p-0.5">
          <button className={tabCls("color")} onClick={() => setTab("color")} data-testid="library-color-tab">Color</button>
          <button className={tabCls("text")} onClick={() => setTab("text")} data-testid="library-text-tab">Text</button>
        </div>
      </div>
      {tab === "color" ? (
        <ColorLibrary />
      ) : (
        <TextLibrary getEl={getEl} apply={apply} />
      )}
    </div>
  );
}

// ── Color Library ─────────────────────────────────────────────────────────────
function ColorLibrary() {
  const colorStyles = useEditorStore((s) => s.colorStyles);
  const addColorStyle = useEditorStore((s) => s.addColorStyle);
  const updateColorStyle = useEditorStore((s) => s.updateColorStyle);
  const deleteColorStyle = useEditorStore((s) => s.deleteColorStyle);

  const [showPicker, setShowPicker] = useState(false);
  const [pickColor, setPickColor] = useState("#6366f1");
  const [pendingName, setPendingName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const addBtnRef = useRef(null);

  const saveColor = () => {
    if (!pickColor) return;
    addColorStyle({ id: uid(), name: pendingName || pickColor, color: pickColor });
    setShowPicker(false);
    setPendingName("");
    toast.success("Color saved to library");
  };

  return (
    <div className="px-4 pb-4 space-y-2">
      {/* Swatches grid */}
      {colorStyles.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-3 text-center">No saved colors yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2 py-1">
          {colorStyles.map((cs) => (
            <div key={cs.id} className="group relative">
              <button
                className="w-8 h-8 rounded-md border border-white/10 hover:scale-110 transition-transform"
                style={{ background: cs.color }}
                title={cs.name || cs.color}
                data-testid={`color-swatch-${cs.id}`}
                onClick={() => {
                  if (editingId !== cs.id) {
                    navigator.clipboard?.writeText(cs.color).catch(() => {});
                    toast.success(`Copied ${cs.color}`);
                  }
                }}
              />
              {/* Hover actions */}
              <div className="absolute -top-1 -right-1 hidden group-hover:flex gap-0.5">
                <button
                  onClick={() => { setEditingId(cs.id); setEditName(cs.name || ""); }}
                  className="w-4 h-4 bg-zinc-800 rounded flex items-center justify-center text-zinc-400 hover:text-white"
                >
                  <Pencil size={8} />
                </button>
                <button
                  onClick={() => deleteColorStyle(cs.id)}
                  className="w-4 h-4 bg-zinc-800 rounded flex items-center justify-center text-zinc-400 hover:text-red-400"
                >
                  <Trash2 size={8} />
                </button>
              </div>
              {/* Inline rename */}
              {editingId === cs.id && (
                <div className="absolute top-full left-0 mt-1 z-20 bg-zinc-900 border border-white/10 rounded-lg p-2 shadow-xl flex gap-1 min-w-[120px]">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { updateColorStyle(cs.id, { name: editName }); setEditingId(null); }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 bg-black border border-white/10 rounded px-1.5 py-0.5 text-xs text-white outline-none"
                    autoFocus
                  />
                  <button onClick={() => { updateColorStyle(cs.id, { name: editName }); setEditingId(null); }}>
                    <Check size={12} className="text-green-400" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add color */}
      <button
        ref={addBtnRef}
        onClick={() => setShowPicker(true)}
        className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-white transition-colors py-1 px-2 rounded-md hover:bg-white/10"
        data-testid="add-color-btn"
      >
        <Plus size={12} /> Add color
      </button>

      {showPicker && (
        <>
          {/* Pending name input */}
          <div className="flex gap-1.5">
            <input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder="Color name (optional)"
              className="flex-1 bg-black border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-white/30"
              data-testid="new-color-name"
            />
            <button
              onClick={saveColor}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
              data-testid="save-color-btn"
            >
              Save
            </button>
            <button onClick={() => setShowPicker(false)} className="text-zinc-500 hover:text-white">
              <Check size={14} />
            </button>
          </div>
          <ColorPicker
            value={pickColor}
            onChange={setPickColor}
            onClose={() => {}}
            anchor={addBtnRef.current}
          />
        </>
      )}
    </div>
  );
}

// ── Text Library ──────────────────────────────────────────────────────────────
function TextLibrary({ getEl, apply }) {
  const [styles, setStyles] = useState(getTextStyles());
  const [showModal, setShowModal] = useState(false);
  const [editingStyle, setEditingStyle] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  const refresh = () => setStyles(getTextStyles());
  const closeMenu = () => setMenuOpenId(null);

  const handleApply = (style) => {
    if (!apply) return toast.error("Select a text element first");
    apply((el) => applyTextStyle(el, style));
    toast.success(`Applied "${style.name}"`);
  };

  const getWeightLabel = (w) => {
    const map = { 100:"Thin", 200:"ExtraLight", 300:"Light", 400:"Regular", 500:"Medium", 600:"SemiBold", 700:"Bold", 800:"ExtraBold", 900:"Black" };
    return map[parseInt(w)] || `${w}`;
  };

  return (
    <div className="px-4 pb-4">
      {styles.length === 0 ? (
        <p className="text-[11px] text-zinc-600 py-3 text-center">No text styles yet.</p>
      ) : (
        <div>
          {styles.map((s) => (
            <div
              key={s.id}
              className="group relative flex items-start justify-between py-2.5 rounded-lg hover:bg-white/5 px-2 -mx-2 transition-colors cursor-pointer"
              data-testid={`text-style-${s.id}`}
              onClick={() => renamingId !== s.id && handleApply(s)}
            >
              {/* Name + metadata */}
              <div className="flex-1 min-w-0 pr-1">
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => { if (renameVal.trim()) { renameTextStyle(s.id, renameVal.trim()); refresh(); } setRenamingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { if (renameVal.trim()) { renameTextStyle(s.id, renameVal.trim()); refresh(); } setRenamingId(null); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-black border border-white/20 rounded px-1.5 py-0.5 text-xs text-white outline-none focus:border-blue-500"
                    data-testid={`rename-input-${s.id}`}
                  />
                ) : (
                  <>
                    <div
                      className="leading-tight truncate"
                      style={{
                        fontFamily: s.fontFamily ? `'${s.fontFamily}', sans-serif` : "inherit",
                        fontWeight: s.fontWeight || 400,
                        fontSize: Math.min(s.fontSize || 14, 22) + "px",
                        color: s.color || "#a0aec0",
                      }}
                    >
                      {s.name}
                    </div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">
                      {[s.fontFamily, getWeightLabel(s.fontWeight), `${s.fontSize}px`].filter(Boolean).join(" · ")}
                    </div>
                  </>
                )}
              </div>

              {/* ... menu trigger */}
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.id ? null : s.id); }}
                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-white/10 transition-all shrink-0 mt-0.5"
                data-testid={`style-menu-${s.id}`}
              >
                <MoreHorizontal size={13} />
              </button>

              {/* Dropdown */}
              {menuOpenId === s.id && (
                <div
                  className="absolute right-0 top-8 z-50 bg-[#1e1e1e] border border-white/10 rounded-lg shadow-xl py-1 min-w-[130px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {[
                    { label: "Edit",      icon: <Pencil size={11} />, testid: `edit-text-style-${s.id}`,      danger: false, action: () => { setEditingStyle(s); setShowModal(true); closeMenu(); } },
                    { label: "Rename",    icon: <span className="text-[9px] font-bold">Aa</span>, testid: `rename-text-style-${s.id}`, danger: false, action: () => { setRenamingId(s.id); setRenameVal(s.name); closeMenu(); } },
                    { label: "Duplicate", icon: <Copy size={11} />,   testid: `duplicate-text-style-${s.id}`, danger: false, action: () => { duplicateTextStyle(s.id); refresh(); closeMenu(); toast.success("Style duplicated"); } },
                    { label: "Delete",    icon: <Trash2 size={11} />, testid: `delete-text-style-${s.id}`,    danger: true,  action: () => { deleteTextStyle(s.id); refresh(); closeMenu(); toast.success("Style deleted"); } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={item.action}
                      data-testid={item.testid}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                        item.danger ? "text-zinc-400 hover:text-red-400 hover:bg-red-500/10" : "text-zinc-300 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      {item.icon} {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pt-2">
        <button
          onClick={() => { setEditingStyle(null); setShowModal(true); }}
          className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors py-1"
          data-testid="create-text-style-btn"
        >
          <Plus size={13} /> Create text style
        </button>
      </div>

      {showModal && (
        <CreateTextStyleModal
          getEl={getEl}
          editStyle={editingStyle}
          onCreated={refresh}
          onClose={() => { setShowModal(false); setEditingStyle(null); }}
        />
      )}
    </div>
  );
}
