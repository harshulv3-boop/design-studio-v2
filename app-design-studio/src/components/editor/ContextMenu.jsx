import { useEffect } from "react";
import { MOD, SHIFT } from "@/lib/pro/platform";
import { useEditorStore } from "@/store/editorStore";

export default function ContextMenu({ x, y, ops, onClose }) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const hiddenIds = useEditorStore((s) => s.hiddenIds);
  const lockedIds = useEditorStore((s) => s.lockedIds);
  const toggleHidden = useEditorStore((s) => s.toggleHidden);
  const toggleLock = useEditorStore((s) => s.toggleLock);

  const isHidden = selectedIds.some((id) => hiddenIds[id]);
  const isLocked = selectedIds.some((id) => lockedIds[id]);

  useEffect(() => {
    const close = () => onClose();
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", close);
      window.addEventListener("blur", close);
      window.addEventListener("resize", close);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const items = [
    {
      label: isHidden ? "Show" : "Hide",
      hint: `${MOD} ${SHIFT} H`,
      action: () => selectedIds.forEach((id) => toggleHidden(id)),
    },
    {
      label: isLocked ? "Unlock" : "Lock",
      hint: `${MOD} ${SHIFT} L`,
      action: () => selectedIds.forEach((id) => toggleLock(id)),
    },
    { sep: true },
    { label: "Copy", hint: `${MOD} C`, action: ops.copySelected },
    { label: "Cut", hint: `${MOD} X`, action: ops.cut },
    { label: "Paste", hint: `${MOD} V`, action: ops.paste },
    { label: "Paste to Replace", action: ops.pasteToReplace },
    { label: "Duplicate", hint: `${MOD} D`, action: ops.duplicateSelected },
    { sep: true },
    { label: "Flip Horizontal", action: ops.flipH },
    { label: "Flip Vertical", action: ops.flipV },
    { sep: true },
    { label: "Group Selection", hint: `${MOD} G`, action: ops.group },
    { label: "Rename", hint: "F2", action: ops.startRename },
    { sep: true },
    { label: "Bring to front", hint: `${MOD} ${SHIFT} ]`, action: ops.bringToFront },
    { label: "Bring forward", hint: `${MOD} ]`, action: ops.bringForward },
    { label: "Send backward", hint: `${MOD} [`, action: ops.sendBackward },
    { label: "Send to back", hint: `${MOD} ${SHIFT} [`, action: ops.sendToBack },
    { sep: true },
    { label: "Edit text", hint: "Enter", action: ops.startEditingSelected },
    { label: "Outline Stroke", disabled: true },
    { label: "Delete", hint: "Del", action: ops.deleteSelected, danger: true },
  ];

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 560);

  return (
    <div
      className="fixed z-50 w-52 bg-[#181818] border border-white/10 rounded-lg shadow-2xl py-1.5 text-sm"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid="context-menu"
    >
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} className="h-px bg-white/10 my-1.5" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              if (!it.disabled) { it.action?.(); onClose(); }
            }}
            className={`w-full flex items-center justify-between px-3 py-1.5 transition-colors ${
              it.disabled
                ? "text-zinc-600 cursor-not-allowed"
                : it.danger
                ? "text-red-400 hover:bg-red-500/10"
                : "text-zinc-200 hover:bg-white/10"
            }`}
            data-testid={`ctx-${it.label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <span>{it.label}</span>
            <span className="text-[11px] text-zinc-500 font-mono">{it.hint}</span>
          </button>
        )
      )}
    </div>
  );
}
