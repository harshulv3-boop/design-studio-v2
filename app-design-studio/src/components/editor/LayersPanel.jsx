import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { buildTree } from "@/lib/pro/htmlUtils";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Type,
  Square,
  Circle,
  Image as ImageIcon,
  MousePointerClick,
  Layers,
  Link,
  List,
  Video,
  Pen,
  Navigation,
  Heading,
  FormInput,
  PanelTop,
  PanelBottom,
  LayoutDashboard,
} from "lucide-react";

const TYPE_ICON = {
  Image: <ImageIcon size={13} />,
  SVG: <Pen size={13} />,
  Button: <MousePointerClick size={13} />,
  Input: <FormInput size={13} />,
  Video: <Video size={13} />,
  Link: <Link size={13} />,
  List: <List size={13} />,
  "List item": <List size={13} />,
  Navigation: <Navigation size={13} />,
  Header: <PanelTop size={13} />,
  Footer: <PanelBottom size={13} />,
  Section: <LayoutDashboard size={13} />,
  Heading: <Heading size={13} />,
  Text: <Type size={13} />,
  Ellipse: <Circle size={13} />,
  Group: <Layers size={13} />,
  Frame: <Square size={13} />,
  Rectangle: <Square size={13} />,
};

const typeIcon = (type) => TYPE_ICON[type] || <Square size={13} />;

function findPath(nodes, targetId) {
  for (const n of nodes) {
    if (n.id === targetId) return [n.id];
    const sub = findPath(n.children, targetId);
    if (sub) return [n.id, ...sub];
  }
  return null;
}

function flatten(nodes, depth, collapsed, out) {
  // Reversed: top of DOM (highest z-index) appears first, like Figma
  const reversed = [...nodes].reverse();
  for (const n of reversed) {
    out.push({ node: n, depth });
    if (n.children.length && !collapsed[n.id]) {
      flatten(n.children, depth + 1, collapsed, out);
    }
  }
  return out;
}

export default function LayersPanel({ embedded = false }) {
  const html = useEditorStore((s) => s.html);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const hiddenIds = useEditorStore((s) => s.hiddenIds);
  const lockedIds = useEditorStore((s) => s.lockedIds);
  const names = useEditorStore((s) => s.names);
  const toggleHidden = useEditorStore((s) => s.toggleHidden);
  const toggleLock = useEditorStore((s) => s.toggleLock);
  const rename = useEditorStore((s) => s.rename);

  const [collapsed, setCollapsed] = useState({});
  const [editingId, setEditingId] = useState(null);
  // Website imports: a cloned page has thousands of nodes — start with
  // everything below the top-level sections collapsed so the tree reads as
  // Page → Hero / Features / Pricing / Footer and stays responsive.
  const project = useEditorStore((s) => s.project);
  const didInitCollapseRef = useRef(false);
  useEffect(() => {
    if (didInitCollapseRef.current) return;
    if (project?.format_config?.artifactType !== "website" || !html) return;
    didInitCollapseRef.current = true;
    const doc = new DOMParser().parseFromString(`<div id="__r">${html}</div>`, "text/html");
    const tree = buildTree(doc.getElementById("__r"));
    const next = {};
    const walk = (nodes, depth) =>
      nodes.forEach((n) => {
        if (n.children.length) {
          if (depth >= 1) next[n.id] = true;
          walk(n.children, depth + 1);
        }
      });
    walk(tree, 0);
    setCollapsed(next);
  }, [html, project]);
  const [dragOverId, setDragOverId] = useState(null);
  // Last non-shift-clicked id — anchor for shift range selection
  const anchorIdRef = useRef(null);

  // Listen for rename events from context menu / keyboard shortcut
  useEffect(() => {
    const handler = (e) => {
      setEditingId(e.detail.id);
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-testid="layer-${e.detail.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("mae:rename", handler);
    return () => window.removeEventListener("mae:rename", handler);
  }, []);

  // Auto-expand ancestors and scroll to the selected layer
  useEffect(() => {
    if (!selectedIds.length) return;
    const targetId = selectedIds[selectedIds.length - 1];
    const currentHtml = useEditorStore.getState().html;
    const doc = new DOMParser().parseFromString(
      `<div id="__r">${currentHtml || ""}</div>`,
      "text/html"
    );
    const tree = buildTree(doc.getElementById("__r"));
    const path = findPath(tree, targetId);
    if (path && path.length > 1) {
      const ancestorIds = path.slice(0, -1);
      setCollapsed((c) => {
        const next = { ...c };
        ancestorIds.forEach((id) => { next[id] = false; });
        return next;
      });
    }
    setTimeout(() => {
      document
        .querySelector(`[data-testid="layer-${targetId}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
  }, [selectedIds]);

  const rows = useMemo(() => {
    const doc = new DOMParser().parseFromString(
      `<div id="__r">${html || ""}</div>`,
      "text/html"
    );
    const tree = buildTree(doc.getElementById("__r"));
    return flatten(tree, 0, collapsed, []);
  }, [html, collapsed]);

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData("mae/id");
    if (!draggedId || draggedId === targetId) return;
    // Delegate to Canvas's reparentTo op which handles coordinate conversion,
    // DOM reparenting, selection update, commit and recompute.
    useEditorStore.getState().ops?.reparentTo?.(draggedId, targetId);
  };

  return (
    <aside
      className={
        embedded
          ? "flex flex-col h-full w-full"
          : "w-[280px] shrink-0 bg-[#121212] border-r border-white/10 flex flex-col h-full"
      }
      data-testid="layers-panel"
    >
      {/* Header */}
      {!embedded && (
        <div className="px-4 py-2.5 border-b border-white/10 shrink-0">
          <span className="text-[11px] font-medium tracking-wider uppercase text-zinc-500">Layers</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="text-xs text-zinc-600 px-2 py-4">No elements yet.</p>
        ) : (
          rows.map(({ node, depth }) => {
            const isSel = selectedIds.includes(node.id);
            const isDragTarget = dragOverId === node.id;
            const label = names[node.id] || node.label;
            const hasChildren = node.children.length > 0;
            return (
              <div
                key={node.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("mae/id", node.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.stopPropagation();
                }}
                onDragEnd={() => setDragOverId(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverId(node.id);
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDragOverId(null);
                }}
                onDrop={(e) => handleDrop(e, node.id)}
                className={`group flex items-center h-7 pr-2 rounded-md cursor-pointer transition-colors ${
                  isSel
                    ? "bg-white/10"
                    : isDragTarget
                    ? "bg-blue-500/20 ring-1 ring-inset ring-blue-500/50"
                    : "hover:bg-white/5"
                }`}
                style={{ paddingLeft: depth * 12 + 4 }}
                onClick={(e) => {
                  if (e.shiftKey && anchorIdRef.current) {
                    // Range selection: select all rows between anchor and target
                    const anchorIdx = rows.findIndex((r) => r.node.id === anchorIdRef.current);
                    const targetIdx = rows.findIndex((r) => r.node.id === node.id);
                    if (anchorIdx !== -1 && targetIdx !== -1) {
                      const lo = Math.min(anchorIdx, targetIdx);
                      const hi = Math.max(anchorIdx, targetIdx);
                      const rangeIds = rows.slice(lo, hi + 1).map((r) => r.node.id);
                      useEditorStore.getState().setSelection(rangeIds);
                      return;
                    }
                  }
                  anchorIdRef.current = node.id;
                  select(node.id);
                }}
                data-testid={`layer-${node.id}`}
              >
                <button
                  className="w-4 h-4 flex items-center justify-center text-zinc-500 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hasChildren)
                      setCollapsed((c) => ({ ...c, [node.id]: !c[node.id] }));
                  }}
                >
                  {hasChildren && (
                    <ChevronRight
                      size={12}
                      className={`transition-transform ${collapsed[node.id] ? "" : "rotate-90"}`}
                    />
                  )}
                </button>
                <span className="text-zinc-400 mr-1.5 shrink-0">{typeIcon(node.type)}</span>
                {editingId === node.id ? (
                  <input
                    autoFocus
                    defaultValue={label}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      rename(node.id, e.target.value);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                      if (e.key === "Escape") { setEditingId(null); }
                    }}
                    className="flex-1 bg-black border border-white/20 rounded px-1 text-xs outline-none"
                    data-testid={`rename-input-${node.id}`}
                  />
                ) : (
                  <span
                    className={`flex-1 truncate text-xs ${isSel ? "text-white" : "text-zinc-300"}`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(node.id);
                    }}
                  >
                    {label}
                  </span>
                )}
                <div className="flex items-center gap-0.5 ml-1 shrink-0">
                  <button
                    className={`p-1 rounded text-zinc-500 hover:text-white hover:bg-white/10 ${
                      lockedIds[node.id] ? "opacity-100 text-amber-400" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLock(node.id);
                    }}
                    data-testid={`lock-${node.id}`}
                  >
                    {lockedIds[node.id] ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                  <button
                    className={`p-1 rounded text-zinc-500 hover:text-white hover:bg-white/10 ${
                      hiddenIds[node.id] ? "opacity-100 text-zinc-300" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHidden(node.id);
                    }}
                    data-testid={`hide-${node.id}`}
                  >
                    {hiddenIds[node.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
