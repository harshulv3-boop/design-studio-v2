import { useEffect, useRef, useState } from "react";
import { X, ChevronDown, MoreHorizontal } from "lucide-react";
import { createTextStyle, updateTextStyle } from "@/lib/pro/textStyles";
import { loadGoogleFont, getFonts } from "@/lib/pro/fonts";
import { toast } from "sonner";

const WEIGHTS = [
  ["100","Thin"], ["200","ExtraLight"], ["300","Light"], ["400","Regular"],
  ["500","Medium"], ["600","SemiBold"], ["700","Bold"], ["800","ExtraBold"], ["900","Black"],
];

const field =
  "w-full bg-[#3a3a3a] border-0 text-white rounded-md px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-white/20 placeholder-zinc-500 leading-tight";

const sel =
  "w-full bg-[#3a3a3a] border-0 text-white rounded-md px-3 py-2 text-sm outline-none appearance-none cursor-pointer leading-tight";

/**
 * Figma-style "Create / Edit text style" modal.
 */
export default function CreateTextStyleModal({ getEl, editStyle, onClose, onCreated }) {
  const isEdit = Boolean(editStyle);
  const [name, setName] = useState(editStyle?.name ?? "New text style");
  const [description, setDescription] = useState(editStyle?.description ?? "");
  const [fontFamily, setFontFamily] = useState(editStyle?.fontFamily ?? "Inter");
  const [fontWeight, setFontWeight] = useState(String(editStyle?.fontWeight ?? "400"));
  const [fontSize, setFontSize] = useState(String(editStyle?.fontSize ?? "12"));
  const [lineHeight, setLineHeight] = useState(
    editStyle
      ? (editStyle.lineHeight === "normal" || !editStyle.lineHeight ? "Auto" : String(editStyle.lineHeight))
      : "Auto"
  );
  const [letterSpacing, setLetterSpacing] = useState(
    editStyle ? `${editStyle.letterSpacing ?? 0}%` : "0%"
  );
  const [color, setColor] = useState(editStyle?.color ?? "#ffffff");
  const [textAlign, setTextAlign] = useState(editStyle?.textAlign ?? "left");
  const [fontSearch, setFontSearch] = useState("");
  const [fontDropOpen, setFontDropOpen] = useState(false);
  const [allFonts, setAllFonts] = useState([]);
  const nameRef = useRef(null);
  const fontDropRef = useRef(null);

  useEffect(() => { getFonts().then(setAllFonts); }, []);

  // Pre-fill from selected element (create mode only)
  useEffect(() => {
    if (isEdit) return;
    const el = getEl?.();
    if (!el) return;
    const cs = getComputedStyle(el);
    const ff = (el.style.fontFamily || "").replace(/['"]/g, "").split(",")[0].trim();
    if (ff && ff !== "inherit") setFontFamily(ff);
    setFontWeight(String(parseInt(cs.fontWeight) || 400));
    setFontSize(String(Math.round(parseFloat(cs.fontSize)) || 12));
    if (cs.lineHeight !== "normal") setLineHeight(String(Math.round(parseFloat(cs.lineHeight))));
    if (cs.letterSpacing !== "normal") setLetterSpacing(`${Math.round(parseFloat(cs.letterSpacing)) || 0}%`);
    const hex = rgbToHex(cs.color);
    if (hex) setColor(hex);
    setTextAlign(cs.textAlign || "left");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setTimeout(() => nameRef.current?.select(), 80); }, []);
  useEffect(() => { loadGoogleFont(fontFamily); }, [fontFamily]);

  // Close font dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (fontDropRef.current && !fontDropRef.current.contains(e.target)) setFontDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredFonts = allFonts
    .filter((f) => f.toLowerCase().includes(fontSearch.toLowerCase()))
    .slice(0, 60);

  const previewStyle = {
    fontFamily: `'${fontFamily}', sans-serif`,
    fontWeight,
    fontSize: Math.min(parseInt(fontSize) || 16, 32) + "px",
    lineHeight: lineHeight === "Auto" ? "normal" : `${lineHeight}px`,
    letterSpacing: `${parseFloat(letterSpacing) || 0}px`,
    color,
    textAlign,
  };

  const handleCreate = () => {
    if (!name.trim()) { toast.error("Enter a name"); return; }
    const lsNum = parseFloat(letterSpacing) || 0;
    const lhVal = lineHeight === "Auto" ? "normal" : parseFloat(lineHeight);
    const style = {
      name: name.trim(),
      description: description.trim(),
      fontFamily,
      fontWeight,
      fontSize: parseFloat(fontSize) || 12,
      lineHeight: lhVal,
      letterSpacing: lsNum,
      color,
      textAlign,
    };
    if (isEdit) {
      updateTextStyle(editStyle.id, style);
      onCreated?.({ ...editStyle, ...style });
      toast.success(`Updated "${style.name}"`);
    } else {
      const [, created] = createTextStyle(style);
      onCreated?.(created);
      toast.success(`Created "${created.name}"`);
    }
    onClose?.();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        className="bg-[#2c2c2c] rounded-xl shadow-2xl w-[460px] overflow-hidden"
        data-testid="create-text-style-modal"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-white font-semibold text-[15px]">
            {isEdit ? "Edit text style" : "Create new text style"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div
          className="mx-5 mb-5 rounded-lg bg-[#3a3a3a] flex items-center justify-center"
          style={{ minHeight: 90 }}
        >
          <span
            style={previewStyle}
            className="px-4 py-3 text-center truncate max-w-full"
          >
            {name || "New text style"}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 mx-0" />

        {/* Form */}
        <div className="px-5 pt-4 pb-3 space-y-2.5">
          {/* Name row */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-300 w-24 shrink-0">Name</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New text style"
              className={field}
              data-testid="text-style-name-input"
            />
          </div>

          {/* Description row */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-300 w-24 shrink-0">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's it for?"
              className={field}
              data-testid="text-style-description-input"
            />
          </div>

          {/* Properties heading */}
          <p className="text-sm font-semibold text-white pt-1">Properties</p>

          {/* Font family — custom dropdown */}
          <div className="relative" ref={fontDropRef}>
            <button
              type="button"
              onClick={() => { setFontDropOpen((v) => !v); setFontSearch(""); }}
              className="w-full bg-[#3a3a3a] rounded-md px-3 py-2 text-sm text-white flex items-center justify-between outline-none hover:bg-[#444] transition-colors"
              data-testid="text-style-font-input"
            >
              <span style={{ fontFamily: `'${fontFamily}', sans-serif` }} className="font-medium truncate">
                {fontFamily}
              </span>
              <ChevronDown size={14} className="text-zinc-400 shrink-0 ml-2" />
            </button>
            {fontDropOpen && (
              <div className="absolute left-0 right-0 mt-1 z-50 bg-[#2c2c2c] border border-white/10 rounded-lg shadow-xl overflow-hidden">
                <div className="px-2 pt-2 pb-1">
                  <input
                    autoFocus
                    value={fontSearch}
                    onChange={(e) => setFontSearch(e.target.value)}
                    placeholder="Search fonts…"
                    className="w-full bg-[#3a3a3a] rounded px-2.5 py-1.5 text-xs text-white outline-none placeholder-zinc-500"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {filteredFonts.map((f) => (
                    <button
                      key={f}
                      onClick={() => { setFontFamily(f); setFontDropOpen(false); setFontSearch(""); }}
                      className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                        f === fontFamily ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Weight + Size */}
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <select
                value={fontWeight}
                onChange={(e) => setFontWeight(e.target.value)}
                className={sel}
                data-testid="text-style-weight"
              >
                {WEIGHTS.map(([v, l]) => (
                  <option key={v} value={v} className="bg-[#2c2c2c]">{l}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
            <div className="relative">
              <select
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
                className={sel}
                data-testid="text-style-size"
              >
                {[8,9,10,11,12,13,14,15,16,18,20,22,24,28,32,36,40,48,56,64,72,96].map((s) => (
                  <option key={s} value={s} className="bg-[#2c2c2c]">{s}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            </div>
          </div>

          {/* Line height + Letter spacing + ... */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs select-none pointer-events-none font-medium">
                Ā
              </span>
              <input
                type="text"
                value={lineHeight}
                onChange={(e) => setLineHeight(e.target.value)}
                placeholder="Auto"
                className="w-full bg-[#3a3a3a] rounded-md pl-7 pr-2.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
                data-testid="text-style-lineheight"
              />
            </div>
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs select-none pointer-events-none font-medium">
                |A|
              </span>
              <input
                type="text"
                value={letterSpacing}
                onChange={(e) => setLetterSpacing(e.target.value)}
                placeholder="0%"
                className="w-full bg-[#3a3a3a] rounded-md pl-8 pr-2.5 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-white/20"
                data-testid="text-style-letterspacing"
              />
            </div>
            <button
              className="w-9 h-9 flex items-center justify-center rounded-md bg-[#3a3a3a] text-zinc-400 hover:text-white hover:bg-[#444] transition-colors shrink-0"
              title="More options"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>

        {/* Divider + footer */}
        <div className="border-t border-white/10" />
        <div className="flex justify-end px-5 py-3">
          <button
            onClick={handleCreate}
            className="bg-blue-500 hover:bg-blue-400 text-white rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
            data-testid="create-style-confirm-btn"
          >
            {isEdit ? "Save changes" : "Create style"}
          </button>
        </div>
      </div>
    </div>
  );
}

function rgbToHex(rgb) {
  if (!rgb) return "#ffffff";
  if (rgb.startsWith("#")) return rgb;
  const m = rgb.match(/\d+/g);
  if (!m) return "#ffffff";
  const [r, g, b] = m.map(Number);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
