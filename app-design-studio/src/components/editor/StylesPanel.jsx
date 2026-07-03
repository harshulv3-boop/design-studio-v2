import { useState, useRef } from "react";
import {
  Plus, Search, Check, Pencil, Trash2, Copy, RefreshCw, X, ChevronDown, ChevronRight, Type,
} from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { LIBRARY_PRESETS, PRESET_CATEGORIES } from "@/lib/pro/stylePresets";
import { captureFromElement, applyToElement, previewColor, styleId } from "@/lib/pro/styleEngine";
import TextStylesControl from "@/components/editor/TextStylesControl";
import { applyTextStyle } from "@/lib/pro/textStyles";

// ── Helpers ──────────────────────────────────────────────────────────────────

function hexFromStr(str) {
  // Try to extract a usable hex color from any CSS color value
  if (!str) return "#3f3f46";
  if (str.startsWith("#") && str.length >= 7) return str.slice(0, 7);
  return "#3f3f46";
}

function isLight(hex) {
  const h = hex.replace("#", "");
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function Swatch({ color, size = 24 }) {
  const hex = hexFromStr(previewColor({ preview: color }));
  const dark = isLight(hex) ? "#000" : "#fff";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: color,
        border: "1px solid rgba(255,255,255,0.12)",
        flexShrink: 0,
        color: dark,
      }}
    />
  );
}

// ── Custom Style Row ──────────────────────────────────────────────────────────

function StyleRow({ style, onApply, onUpdate, onRename, onDuplicate, onDelete, appliedIds }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(style.name);
  const inputRef = useRef(null);
  const color = previewColor(style);
  const linkedCount = appliedIds?.length || 0;

  const commitRename = () => {
    if (name.trim() && name.trim() !== style.name) onRename(style.id, name.trim());
    setEditing(false);
  };

  return (
    <div
      className="group flex items-center gap-2 h-9 px-3 rounded-md cursor-pointer hover:bg-white/5 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => !editing && onApply(style)}
      data-testid={`style-row-${style.id}`}
    >
      <Swatch color={color} size={20} />

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setName(style.name); setEditing(false); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-black border border-white/20 rounded px-1.5 py-0.5 text-xs outline-none text-white"
          />
        ) : (
          <span
            className="text-xs text-zinc-200 truncate block"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          >
            {style.name}
          </span>
        )}
      </div>

      {linkedCount > 0 && !hovered && (
        <span className="text-[10px] text-zinc-600 shrink-0">{linkedCount}</span>
      )}

      {hovered && !editing && (
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Apply to selection" onClick={() => onApply(style)}>
            <Check size={12} />
          </IconBtn>
          <IconBtn title="Update from selection" onClick={() => onUpdate(style)}>
            <RefreshCw size={12} />
          </IconBtn>
          <IconBtn title="Rename" onClick={() => { setEditing(true); setHovered(false); }}>
            <Pencil size={12} />
          </IconBtn>
          <IconBtn title="Duplicate" onClick={() => onDuplicate(style)}>
            <Copy size={12} />
          </IconBtn>
          <IconBtn title="Delete" onClick={() => onDelete(style)} danger>
            <Trash2 size={12} />
          </IconBtn>
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`p-1 rounded transition-colors ${
        danger
          ? "text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
          : "text-zinc-500 hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

// ── Library Preset Card ───────────────────────────────────────────────────────

function LibraryRow({ preset, onApply }) {
  const [hovered, setHovered] = useState(false);
  const color = previewColor(preset);

  return (
    <div
      className="group flex items-center gap-2 h-9 px-3 rounded-md cursor-pointer hover:bg-white/5 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onApply(preset)}
    >
      <Swatch color={color} size={20} />
      <span className="flex-1 text-xs text-zinc-300 truncate">{preset.name}</span>
      {hovered && (
        <span className="text-[10px] text-zinc-500 shrink-0 pr-1">Apply</span>
      )}
    </div>
  );
}

// ── Create Style inline form ──────────────────────────────────────────────────

function CreateForm({ onSave, onCancel }) {
  const [name, setName] = useState("");
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/10">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSave(name); }
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
        placeholder="Style name…"
        className="flex-1 bg-black border border-white/20 rounded px-2 py-1 text-xs outline-none text-white placeholder:text-zinc-600"
        data-testid="create-style-input"
      />
      <button
        onClick={() => onSave(name)}
        className="text-zinc-400 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
        title="Save"
      >
        <Check size={12} />
      </button>
      <button
        onClick={onCancel}
        className="text-zinc-600 hover:text-white p-1 rounded hover:bg-white/10 transition-colors"
        title="Cancel"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ── Main StylesPanel ──────────────────────────────────────────────────────────

export default function StylesPanel({ embedded = false }) {
  const styles = useEditorStore((s) => s.styles);
  const addStyle = useEditorStore((s) => s.addStyle);
  const updateStyle = useEditorStore((s) => s.updateStyle);
  const deleteStyle = useEditorStore((s) => s.deleteStyle);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  const [tab, setTab] = useState("custom");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState({});

  // For text styles tab
  const selectedId = useEditorStore((s) => s.selectedId);
  const ops = useEditorStore((s) => s.ops);
  const getEl = () => useEditorStore.getState().ops?.getEl?.(selectedId);
  const apply = (fn) => {
    const el = getEl();
    if (!el) return;
    fn(el);
    ops?.commit?.();
    ops?.recompute?.();
  };

  const hasSelection = selectedIds.length > 0;

  // DOM access helpers
  const getRoot = () => useEditorStore.getState().ops?.getPageRoot?.();
  const commit = () => useEditorStore.getState().ops?.commit?.();

  // Count live elements linked to each style
  const countLinked = (styleId) => {
    const root = getRoot();
    return root ? root.querySelectorAll(`[data-mae-style="${styleId}"]`).length : 0;
  };

  // Apply a style to all selected elements
  const handleApply = (style) => {
    const root = getRoot();
    if (!root) return;
    const ids = selectedIds.length ? selectedIds : [];
    if (!ids.length) return;
    ids.forEach((id) => {
      const el = root.querySelector(`[data-mae-id="${id}"]`);
      if (!el) return;
      applyToElement(el, style.properties);
      el.dataset.maeStyle = style.id;
    });
    commit();
  };

  // Update a style's properties from the first selected element,
  // then re-apply to all linked elements.
  const handleUpdateFromSelection = (style) => {
    const root = getRoot();
    if (!root || !selectedIds.length) return;
    const el = root.querySelector(`[data-mae-id="${selectedIds[0]}"]`);
    if (!el) return;
    const newProps = captureFromElement(el);
    updateStyle(style.id, { properties: newProps });
    // Propagate to all linked elements in the live DOM
    root.querySelectorAll(`[data-mae-style="${style.id}"]`).forEach((linked) => {
      applyToElement(linked, newProps);
    });
    commit();
  };

  // Create a new style from the current selection
  const handleCreate = (name) => {
    if (!name.trim()) return;
    const root = getRoot();
    const el = selectedIds[0] ? root?.querySelector(`[data-mae-id="${selectedIds[0]}"]`) : null;
    const properties = el ? captureFromElement(el) : {};
    addStyle({ id: styleId(), name: name.trim(), createdAt: Date.now(), properties });
    setCreating(false);
  };

  // Delete a style and detach it from any linked elements
  const handleDelete = (style) => {
    const root = getRoot();
    if (root) {
      root.querySelectorAll(`[data-mae-style="${style.id}"]`).forEach((el) => {
        el.removeAttribute("data-mae-style");
      });
      commit();
    }
    deleteStyle(style.id);
  };

  const handleDuplicate = (style) => {
    addStyle({ ...style, id: styleId(), name: `${style.name} Copy`, createdAt: Date.now() });
  };

  const handleRename = (id, name) => updateStyle(id, { name });

  const filteredCustom = styles.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const filteredLibrary = LIBRARY_PRESETS.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleCat = (cat) =>
    setCollapsedCats((c) => ({ ...c, [cat]: !c[cat] }));

  const tabCls = (t) =>
    `flex-1 py-1.5 text-[11px] font-medium transition-colors rounded-md ${
      tab === t
        ? "bg-white/10 text-white"
        : "text-zinc-500 hover:text-zinc-300"
    }`;

  // Default to "libraries" (not custom) since we removed custom
  // Make sure initial state is libraries if tab was "custom"
  const effectiveTab = tab === "custom" ? "libraries" : tab;

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="styles-panel">
      {/* Tab bar — Libraries and Text only */}
      <div className="flex gap-1 px-2 py-2 border-b border-white/10">
        <button className={tabCls(effectiveTab === "libraries" ? "libraries" : effectiveTab)} onClick={() => setTab("libraries")}>Libraries</button>
        <button className={tabCls("text")} onClick={() => setTab("text")} data-testid="text-styles-tab">Text</button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5">
          <Search size={12} className="text-zinc-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search styles…"
            className="flex-1 bg-transparent text-xs text-zinc-300 placeholder:text-zinc-600 outline-none"
            data-testid="styles-search"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-zinc-600 hover:text-white">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === "text" ? (
          /* Text Styles tab */
          <div className="flex flex-col p-3 gap-3">
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Save typography presets and apply them to text elements.
            </p>
            <TextStylesControl
              getEl={getEl}
              apply={apply}
              onApplied={() => {}}
            />
          </div>
        ) : (
          /* Libraries tab */
          <div className="pb-4">
            {PRESET_CATEGORIES.map((cat) => {
              const items = filteredLibrary.filter((p) => p.category === cat);
              if (!items.length) return null;
              const collapsed = collapsedCats[cat];
              return (
                <div key={cat}>
                  <button
                    className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] font-medium tracking-wider uppercase text-zinc-500 hover:text-zinc-300 transition-colors"
                    onClick={() => toggleCat(cat)}
                  >
                    {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                    {cat}
                  </button>
                  {!collapsed && (
                    <div className="px-1">
                      {items.map((preset) => (
                        <LibraryRow
                          key={preset.id}
                          preset={preset}
                          onApply={handleApply}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {filteredLibrary.length === 0 && (
              <p className="text-[11px] text-zinc-600 px-4 py-8 text-center">
                No presets match your search.
              </p>
            )}

            {/* Future extensibility note */}
            <div className="mx-3 mt-4 px-3 py-2.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
              <p className="text-[10px] text-zinc-700 leading-relaxed">
                Team libraries and marketplace styles will appear here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer — selection status */}
      <div className="border-t border-white/10 px-3 py-2">
        <p className="text-[10px] text-zinc-700">
          {selectedIds.length
            ? `${selectedIds.length} element${selectedIds.length > 1 ? "s" : ""} selected — click a style to apply`
            : "Select elements on canvas to apply styles"}
        </p>
      </div>
    </div>
  );
}
