import { useMemo } from "react";
import { toast } from "sonner";
import { Link2, Unlink, MousePointerClick, ArrowRight, Flag, ArrowDownLeft, ArrowUpRight, Zap } from "lucide-react";
import {
  TRIGGERS, ACTIONS, ANIMATIONS, EASINGS, DEFAULTS,
  parseInteractions, readInteraction, buildGraph,
} from "@/lib/pro/prototype";

function elLabel(html, elId) {
  if (!html || !elId) return null;
  const doc = new DOMParser().parseFromString(`<div id="__r">${html}</div>`, "text/html");
  const el = doc.querySelector(`#__r [data-mae-id="${CSS.escape(elId)}"]`);
  if (!el) return null;
  const txt = (el.textContent || "").trim();
  return `${el.tagName.toLowerCase()}${txt ? ` · ${txt.slice(0, 20)}` : ""}`;
}

const selCls = "w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500/60";

export default function PrototypePanel({
  screens = [], currentScreenId, selection, startScreen,
  onSwitch, setProtoSelection, applyInteraction, clearInteraction, setStart,
}) {
  const activeScreenId = selection?.screenId || currentScreenId;
  const activeElId = selection?.elId || null;

  const activeScreen = screens.find((s) => s.id === activeScreenId);
  const screenHtml = activeScreen?.html || "";

  const interaction = useMemo(
    () => (activeElId ? readInteraction(screenHtml, activeElId) || { ...DEFAULTS } : null),
    [screenHtml, activeElId]
  );
  const selLabel = useMemo(() => elLabel(screenHtml, activeElId), [screenHtml, activeElId]);
  const interactions = useMemo(() => parseInteractions(screenHtml), [screenHtml]);
  const graph = useMemo(() => buildGraph(screens), [screens]);
  const nameOf = (id) => screens.find((s) => s.id === id)?.name || id;
  const others = screens.filter((s) => s.id !== activeScreenId);

  const update = (patch) => {
    if (!activeScreenId || !activeElId) return;
    applyInteraction?.(activeScreenId, activeElId, patch);
  };
  const removeInteraction = (elId) => {
    clearInteraction?.(activeScreenId, elId);
    toast.success("Interaction removed");
  };

  const segBtn = (active, onClick, children, testid) => (
    <button key={testid} onClick={onClick} data-testid={testid}
      className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${active ? "bg-violet-500 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"}`}>
      {children}
    </button>
  );

  const needsTarget = interaction && (interaction.action === "navigate" || interaction.action === "overlay");

  return (
    <aside className="w-[320px] shrink-0 bg-[#0E0E13] border-l border-white/10 flex flex-col h-full" data-testid="prototype-panel">
      <div className="h-10 border-b border-white/10 flex items-center px-4 shrink-0">
        <span className="text-[11px] font-medium tracking-wider uppercase text-violet-300 flex items-center gap-1.5">
          <Link2 size={12} /> Prototype
        </span>
      </div>

      <div className="flex-1 p-4 space-y-5 overflow-y-auto">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Screen</div>
          <select value={activeScreenId || ""} onChange={(e) => { onSwitch?.(e.target.value); setProtoSelection?.(null); }} className={selCls} data-testid="proto-screen-select">
            {screens.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={() => { setStart?.(activeScreenId); toast.success(`"${nameOf(activeScreenId)}" is the flow start`); }}
            disabled={activeScreenId === startScreen}
            className={`mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium border transition-colors ${activeScreenId === startScreen ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/40 cursor-default" : "bg-black border-white/10 text-zinc-300 hover:border-emerald-400/50 hover:text-emerald-300"}`}
            data-testid="proto-set-start">
            <Flag size={12} /> {activeScreenId === startScreen ? "Flow starting point" : "Set as starting point"}
          </button>
        </div>

        <div className="pt-1 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 mt-3">Interaction</div>
          {!activeElId ? (
            <p className="text-xs text-zinc-500 leading-relaxed">Select an element on the flow canvas to add an interaction, or drag a connection handle between screens.</p>
          ) : (
            <div className="space-y-3">
              <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 flex items-center gap-2" data-testid="proto-selected">
                <MousePointerClick size={13} className="text-violet-400" /> {selLabel || activeElId}
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 mb-1.5">Trigger</div>
                <div className="flex bg-black border border-white/10 rounded-lg p-0.5">
                  {TRIGGERS.map((t) => segBtn(interaction.trigger === t.id, () => update({ trigger: t.id }), t.label, `trigger-${t.id}`))}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 mb-1.5">Action</div>
                <select value={interaction.action}
                  onChange={(e) => {
                    const action = e.target.value; const patch = { action };
                    if (action === "back" || action === "scroll") patch.target = "";
                    if ((action === "navigate" || action === "overlay") && !interaction.target && others[0]) patch.target = others[0].id;
                    update(patch);
                  }}
                  className={selCls} data-testid="proto-action-select">
                  {ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              {needsTarget && (
                <div>
                  <div className="text-[10px] text-zinc-500 mb-1.5">{interaction.action === "overlay" ? "Overlay screen" : "Destination"}</div>
                  <select value={interaction.target} onChange={(e) => update({ target: e.target.value })} className={selCls} data-testid="proto-target-select">
                    <option value="">— choose screen —</option>
                    {others.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <div className="text-[10px] text-zinc-500 mb-1.5">Animation</div>
                <select value={interaction.animation} onChange={(e) => update({ animation: e.target.value })} className={selCls} data-testid="proto-animation-select">
                  {ANIMATIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              {interaction.animation !== "instant" && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] text-zinc-500 mb-1.5">Duration</div>
                    <div className="flex items-center gap-2">
                      <input type="range" min="0" max="2000" step="50" value={interaction.duration} onChange={(e) => update({ duration: parseInt(e.target.value, 10) })} className="flex-1 accent-violet-500" data-testid="proto-duration-range" />
                      <span className="text-[11px] font-mono text-zinc-400 w-12 text-right">{interaction.duration}ms</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 mb-1.5">Easing</div>
                    <select value={interaction.easing} onChange={(e) => update({ easing: e.target.value })} className={selCls} data-testid="proto-easing-select">
                      {EASINGS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {interaction.trigger === "delay" && (
                <div>
                  <div className="text-[10px] text-zinc-500 mb-1.5">Delay before action</div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="0" max="5000" step="100" value={interaction.delay} onChange={(e) => update({ delay: parseInt(e.target.value, 10) })} className="flex-1 accent-violet-500" data-testid="proto-delay-range" />
                    <span className="text-[11px] font-mono text-zinc-400 w-12 text-right">{interaction.delay}ms</span>
                  </div>
                </div>
              )}
              <button onClick={() => removeInteraction(activeElId)} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400" data-testid="proto-unlink">
                <Unlink size={12} /> Remove interaction
              </button>
            </div>
          )}
        </div>

        <div className="pt-1 border-t border-white/10">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 mt-3">Interactions on this screen ({interactions.length})</div>
          <div className="space-y-1.5">
            {interactions.length === 0 && <p className="text-xs text-zinc-600">No interactions yet.</p>}
            {interactions.map((c, i) => (
              <button key={c.elId} onClick={() => setProtoSelection?.({ screenId: activeScreenId, elId: c.elId })}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 border text-left ${activeElId === c.elId ? "bg-violet-500/15 border-violet-400/40" : "bg-black/30 border-white/10 hover:border-white/20"}`}
                data-testid={`proto-conn-${i}`}>
                <span className="flex items-center gap-1.5 text-xs text-zinc-300 min-w-0">
                  <span className="truncate">{c.label}</span>
                  <ArrowRight size={11} className="text-zinc-600 shrink-0" />
                  <span className="text-violet-300 shrink-0 truncate">{c.action === "back" ? "Back" : c.action === "scroll" ? "Scroll" : nameOf(c.target)}</span>
                </span>
                <Unlink size={12} onClick={(e) => { e.stopPropagation(); removeInteraction(c.elId); }} className="text-zinc-600 hover:text-red-400 shrink-0 ml-2" />
              </button>
            ))}
          </div>
        </div>

        {activeScreenId && graph[activeScreenId] && (
          <div className="pt-1 border-t border-white/10">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2 mt-3 flex items-center gap-1.5"><Zap size={11} /> Screen graph</div>
            <div className="space-y-2.5">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 mb-1"><ArrowUpRight size={11} /> Outgoing ({graph[activeScreenId].out.length})</div>
                {graph[activeScreenId].out.length === 0 ? <p className="text-[11px] text-zinc-600">none</p> :
                  graph[activeScreenId].out.map((c, i) => (
                    <div key={i} className="text-[11px] text-zinc-400 flex items-center gap-1 pl-3">→ <span className="text-zinc-200">{nameOf(c.target)}</span></div>
                  ))}
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-sky-400 mb-1"><ArrowDownLeft size={11} /> Incoming ({graph[activeScreenId].in.length})</div>
                {graph[activeScreenId].in.length === 0 ? <p className="text-[11px] text-zinc-600">none</p> :
                  graph[activeScreenId].in.map((c, i) => (
                    <button key={i} onClick={() => { onSwitch?.(c.source); setProtoSelection?.(null); }} className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 pl-3">← <span className="text-zinc-200">{nameOf(c.source)}</span></button>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
