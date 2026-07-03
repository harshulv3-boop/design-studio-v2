import { useEditorStore } from "@/store/editorStore";
import {
  MousePointer2,
  Hand,
  Type,
  Square,
  SquareDashed,
  Circle,
  Image as ImageIcon,
} from "lucide-react";

const TOOLS = [
  { key: "select",  icon: MousePointer2, label: "Move",      shortcut: "V" },
  { key: "hand",    icon: Hand,          label: "Hand",      shortcut: "H" },
  { key: "text",    icon: Type,          label: "Text",      shortcut: "T" },
  { key: "frame",   icon: SquareDashed,  label: "Frame",     shortcut: "F" },
  { key: "rect",    icon: Square,        label: "Rectangle", shortcut: "R" },
  { key: "ellipse", icon: Circle,        label: "Ellipse",   shortcut: "O" },
  { key: "image",   icon: ImageIcon,     label: "Image",     shortcut: "I" },
];

// Figma-style floating toolbar, pinned bottom-center of the canvas.
export default function Toolbar() {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);

  return (
    <div
      className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex flex-row items-center gap-1 bg-[#181818]/90 backdrop-blur border border-white/10 rounded-2xl p-1.5 shadow-2xl"
      data-testid="canvas-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = tool === t.key;
        return (
          <button
            key={t.key}
            onClick={() => setTool(t.key)}
            title={`${t.label} (${t.shortcut})`}
            data-active={active ? "true" : "false"}
            className={`group relative w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
              active
                ? "bg-white text-black"
                : "text-zinc-400 hover:text-white hover:bg-white/10"
            }`}
            data-testid={`tool-${t.key}`}
          >
            <Icon size={18} />
            <span className="pointer-events-none absolute bottom-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#181818] border border-white/10 px-2 py-1 text-[11px] text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity">
              {t.label} <span className="text-zinc-500 ml-1 font-mono">{t.shortcut}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
