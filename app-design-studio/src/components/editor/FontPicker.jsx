import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { getFonts, loadGoogleFont } from "@/lib/pro/fonts";

// Searchable Google Fonts picker. Loads the full family list lazily and
// injects the selected font's stylesheet on demand (no upfront bulk load).
export default function FontPicker({ value, onChange, textStyles = [], onApplyTextStyle }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fonts, setFonts] = useState([]);
  const ref = useRef(null);

  useEffect(() => {
    if (open && fonts.length === 0) getFonts().then(setFonts);
  }, [open, fonts.length]);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const list = ["inherit", ...fonts];
  const filtered = query
    ? list.filter((f) => f.toLowerCase().includes(query.toLowerCase())).slice(0, 60)
    : list.slice(0, 60);

  const pick = (f) => {
    loadGoogleFont(f);
    onChange(f);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="relative flex-1" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-black border border-white/10 text-white rounded px-2 py-1 text-xs focus:border-white/30 outline-none"
        data-testid="font-picker-trigger"
      >
        <span className="truncate" style={{ fontFamily: value !== "inherit" ? `'${value}'` : undefined }}>
          {value || "inherit"}
        </span>
        <ChevronDown size={12} className="text-zinc-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-[#181818] border border-white/10 rounded-md shadow-2xl" data-testid="font-picker-menu">
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/10">
            <Search size={12} className="text-zinc-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fonts…"
              className="flex-1 bg-transparent text-xs outline-none text-white"
              data-testid="font-search-input"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {!query && textStyles.length > 0 && (
              <div className="border-b border-white/10 pb-1 mb-1">
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-zinc-600">Saved Text Styles</div>
                {textStyles.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onApplyTextStyle?.(s); setOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-violet-300 hover:bg-white/10 transition-colors"
                    data-testid={`font-textstyle-${s.id}`}
                  >
                    {s.name}
                  </button>
                ))}
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-zinc-600 mt-1">Typography</div>
              </div>
            )}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-600">No fonts</div>
            ) : (
              filtered.map((f) => (
                <button
                  key={f}
                  onMouseEnter={() => loadGoogleFont(f)}
                  onClick={() => pick(f)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors ${
                    f === value ? "text-white bg-white/5" : "text-zinc-300"
                  }`}
                  style={{ fontFamily: f !== "inherit" ? `'${f}'` : undefined }}
                  data-testid={`font-option-${f}`}
                >
                  {f}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
