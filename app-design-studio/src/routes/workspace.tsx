import { PhoneScreenFrame } from "@/components/PhoneScreenFrame";
import ColorPickerComponent from "@/components/editor/ColorPicker";
import { remapHtmlColors } from "@/lib/color-remap";
import { prettyCss, prettyHtml } from "@/lib/format-export";
import { createProjectZip } from "@/lib/project-export";
import {
  buildAngularProjectExport,
  buildFigmaExport,
  buildHtmlExport,
  buildReactTsx,
  buildReactProjectExport,
  buildVueProjectExport,
} from "@/lib/ir";
import { ensureIds } from "@/lib/pro/htmlUtils";
import { applyInteractionToHtml, clearInteractionFromHtml } from "@/lib/pro/prototype";
import { loadProject, loadProjectById, saveProject } from "@/lib/project-store";
import type { Project } from "@/lib/screen-schema";
import { useEditorStore } from "@/store/editorStore";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  CreditCard,
  Download,
  Figma,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Megaphone,
  MonitorPlay,
  Moon,
  Plug,
  Plus,
  Redo2,
  Settings,
  Share2,
  Sparkle,
  Sparkles,
  Undo2,
  User as UserIcon,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

// Pro-mode editor pieces (lazy — big bundle we only need on desktop).
const Canvas = lazy(() => import("@/components/editor/Canvas"));
const LayersPanel = lazy(() => import("@/components/editor/LayersPanel"));
const PropertiesPanel = lazy(() => import("@/components/editor/PropertiesPanel"));
// Connect-mode (prototype) pieces — lazy.
const FlowCanvas = lazy(
  () => import("@/components/flow/FlowCanvas"),
) as unknown as ComponentType<FlowCanvasProps>;
const PrototypePanel = lazy(
  () => import("@/components/flow/PrototypePanel"),
) as unknown as ComponentType<PrototypePanelProps>;

// Palette key → CSS variable name (matches Phase-1 system prompt).
const PALETTE_CSS_VAR: Record<string, string> = {
  background: "--bg",
  surface: "--surface",
  text: "--text",
  muted: "--muted",
  accent: "--accent",
  accentText: "--accent-text",
};

type Search = { idea?: string; platform?: "ios" | "android"; share?: string; project?: string };

export const Route = createFileRoute("/workspace")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    idea: typeof s.idea === "string" ? s.idea : undefined,
    platform: s.platform === "android" ? "android" : s.platform === "ios" ? "ios" : undefined,
    share: typeof s.share === "string" ? s.share : undefined,
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  component: Workspace,
});

type ChatMsg = { role: "user" | "assistant"; text: string };
type ProtoSelection = { screenId: string; elId: string } | null;
type FlowCanvasProps = {
  screens: Project["screens"];
  css: string;
  startScreen: string | null;
  selection: ProtoSelection;
  setSelection: Dispatch<SetStateAction<ProtoSelection>>;
  selectedConnection: string | null;
  setSelectedConnection: Dispatch<SetStateAction<string | null>>;
  applyInteraction: (screenId: string, elId: string, attrs: Record<string, unknown>) => void;
  clearInteraction: (screenId: string, elId: string) => void;
  initialPositions?: Record<string, { x: number; y: number }>;
  onPositions: (pos: Record<string, { x: number; y: number }>) => void;
  onOpenScreen: (id: string) => void;
};
type PrototypePanelProps = {
  screens: Project["screens"];
  currentScreenId: string | null;
  selection: ProtoSelection;
  startScreen: string | null;
  onSwitch: Dispatch<SetStateAction<string | null>>;
  setProtoSelection: Dispatch<SetStateAction<ProtoSelection>>;
  applyInteraction: (screenId: string, elId: string, attrs: Record<string, unknown>) => void;
  clearInteraction: (screenId: string, elId: string) => void;
  setStart: (screenId: string) => void;
};
type GenerationJob = {
  id: string;
  status: "queued" | "planning" | "generating" | "completed" | "failed" | "cancelled";
  progress: string[];
  project: Project | null;
  error?: string;
};

const FALLBACK_DESIGN_SYSTEM: Project["designSystem"] = {
  palette: {
    background: "#0B0D12",
    surface: "#151923",
    text: "#F8FAFC",
    muted: "#94A3B8",
    accent: "#FF7A2F",
    accentText: "#FFFFFF",
  },
  radius: "lg",
  font: "Inter",
};

const FALLBACK_DESIGN_CSS = `:root{--bg:#0B0D12;--surface:#151923;--text:#F8FAFC;--muted:#94A3B8;--accent:#FF7A2F;--accent-text:#FFFFFF;--radius:18px;--font:Inter,system-ui,sans-serif}.screen{width:375px;height:812px;background:var(--bg);color:var(--text);font-family:var(--font);overflow:hidden}`;

function normalizeProject(project: Project | null): Project | null {
  if (!project) return null;
  return {
    ...project,
    idea: project.idea || project.name || "Untitled project",
    platform: project.platform ?? "ios",
    designSystem: project.designSystem?.palette ? project.designSystem : FALLBACK_DESIGN_SYSTEM,
    designSystemCss: project.designSystemCss || FALLBACK_DESIGN_CSS,
    screens: (project.screens || []).map((screen, index) => ({
      id: screen.id || `screen-${index + 1}`,
      name: screen.name || `Screen ${index + 1}`,
      role: screen.role || screen.name || `Screen ${index + 1}`,
      html: screen.html || "",
    })),
  } as Project;
}

const AI_REQUEST_TIMEOUT_MS = 15_000;
const AI_GENERATION_REQUEST_TIMEOUT_MS = 120_000;

async function fetchAi(path: string, init: RequestInit, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted)
      throw new Error("The AI request timed out. Try a smaller change or retry in a moment.");
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function encodeShare(p: Project): string {
  const json = JSON.stringify(p);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeShare(s: string): Project | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const json = decodeURIComponent(escape(atob(b64 + pad)));
    return JSON.parse(json) as Project;
  } catch {
    return null;
  }
}

function Workspace() {
  const { idea, platform: platformParam, share, project: projectIdParam } = Route.useSearch();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "refining">("idle");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "theme">("chat");
  const [mode, setMode] = useState<"pro" | "lite" | "connect">(() =>
    typeof window !== "undefined" && window.innerWidth >= 1024 ? "pro" : "lite",
  );
  // Connect (prototype) mode state.
  const [protoSelection, setProtoSelection] = useState<{ screenId: string; elId: string } | null>(
    null,
  );
  // Lite-mode element selection: click an element to target it for AI edits.
  const [liteSel, setLiteSel] = useState<{ screenId: string; elId: string } | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [connectScreenId, setConnectScreenId] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  // ---- editor store wiring -------------------------------------------------
  const editorHtml = useEditorStore((s: any) => s.html) as string;
  const loadHtml = useEditorStore((s: any) => s.loadHtml) as (html: string) => void;
  const undo = useEditorStore((s: any) => s.undo) as () => void;
  const redo = useEditorStore((s: any) => s.redo) as () => void;
  const canUndo = useEditorStore((s: any) => s.history.length > 0) as boolean;
  const canRedo = useEditorStore((s: any) => s.future.length > 0) as boolean;
  const editorResetForScreen = useCallback(
    (html: string) => {
      const withIds = html ? ensureIds(html) : "";
      // loadHtml clears history — screen navigation must never appear in the
      // undo stack (prevents black-render on undo and canvas/selector desync).
      loadHtml(withIds);
    },
    [loadHtml],
  );

  // Keep the Pro editor's project reference in sync. The design-system CSS is
  // read directly off project.designSystemCss in the Canvas — no cached copy.
  useEffect(() => {
    useEditorStore.setState({ project });
  }, [project]);

  // Track the last html the editor pushed into project — so we can distinguish
  // "editor -> project" writes from "external -> project" writes (generation,
  // refine, screen switch) and avoid a reload/write feedback loop.
  const lastEditorPushRef = useRef<string | null>(null);
  const lastLoadedRef = useRef<string | null>(null);

  // Reactive sync: whenever the SELECTED screen's html in project changes to
  // something that isn't the editor's own recent push, reload the editor from
  // it. This keys on the html VALUE (not just selectedId) so any external
  // update — generation, refine, undo elsewhere — is picked up live, exactly
  // like Lite reads project.screens[].html live every render.
  const selectedHtml = selectedId
    ? (project?.screens.find((x) => x.id === selectedId)?.html ?? "")
    : "";
  useEffect(() => {
    if (!project || !selectedId) return;
    const screenSwitched = lastLoadedRef.current !== selectedId;
    // If this html is exactly what the editor just pushed upstream, it's not
    // an external change — ignore to prevent a reload loop.
    if (!screenSwitched && selectedHtml === lastEditorPushRef.current) return;
    if (!screenSwitched && selectedHtml === editorHtml) return;
    lastLoadedRef.current = selectedId;
    lastEditorPushRef.current = selectedHtml;
    editorResetForScreen(selectedHtml);
  }, [selectedHtml, selectedId, project, editorHtml, editorResetForScreen]);

  // Persist editor edits back into the active screen's html (debounced).
  useEffect(() => {
    if (!project || !selectedId) return;
    if (lastLoadedRef.current !== selectedId) return;
    const s = project.screens.find((x) => x.id === selectedId);
    if (!s || s.html === editorHtml) return;
    const t = setTimeout(() => {
      lastEditorPushRef.current = editorHtml;
      setProject((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          screens: prev.screens.map((x) => (x.id === selectedId ? { ...x, html: editorHtml } : x)),
        };
        saveProject(next);
        return next;
      });
    }, 200);
    return () => clearTimeout(t);
  }, [editorHtml, project, selectedId]);

  // ---- generation ----------------------------------------------------------
  const generate = useCallback(async (ideaText: string, plat: "ios" | "android") => {
    setStatus("generating");
    setChat([
      {
        role: "assistant",
        text: `Starting a ${plat === "ios" ? "iOS" : "Android"} generation job for: "${ideaText}"...`,
      },
    ]);
    try {
      const startRes = await fetchAi("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "start-generation", idea: ideaText, platform: plat }),
      });

      if (!startRes.ok) throw new Error((await startRes.text()) || `HTTP ${startRes.status}`);
      const { jobId } = (await startRes.json()) as { jobId: string };
      let seenProgress = 0;
      let lastScreenCount = 0;
      // Cache ensureIds() output per raw html so a finished screen is parsed +
      // sanitized ONCE, not re-parsed on every poll tick for the rest of the job.
      const idCache = new Map<string, string>();
      // Signature of the last screen set we pushed to React/localStorage, so we
      // skip setProject()/saveProject() on ticks where nothing changed (the
      // common case: most polls return the same in-progress project).
      let lastScreensSig = "";

      navigate({ to: "/workspace", search: {}, replace: true });

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const statusRes = await fetchAi("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "generation-status", jobId }),
        });

        if (!statusRes.ok) throw new Error((await statusRes.text()) || `HTTP ${statusRes.status}`);
        const { job } = (await statusRes.json()) as { job: GenerationJob };

        const newProgress = job.progress.slice(seenProgress);
        if (newProgress.length) {
          seenProgress = job.progress.length;
          setChat((c) => [
            ...c,
            ...newProgress.map((text) => ({ role: "assistant" as const, text })),
          ]);
        }

        if (job.project) {
          // Cheap change check first — only touch React state + localStorage when
          // the actual screen payloads changed since the last tick.
          const sig = `${job.project.screens.length}:${job.project.screens.map((s) => s.html.length).join(",")}`;
          if (sig !== lastScreensSig) {
            lastScreensSig = sig;
            const screens = job.project.screens.map((screen) => {
              let html = idCache.get(screen.html);
              if (html === undefined) {
                html = ensureIds(screen.html);
                idCache.set(screen.html, html);
              }
              return { ...screen, html };
            });
            const projectSnapshot = normalizeProject({ ...job.project, screens } as Project)!;
            setProject(projectSnapshot);
            saveProject(projectSnapshot);
            if (screens.length > lastScreenCount) {
              setSelectedId((current) => current ?? screens[0]?.id ?? null);
              lastScreenCount = screens.length;
              lastLoadedRef.current = null;
            }
          }
        }

        if (job.status === "completed") break;
        if (job.status === "failed" || job.status === "cancelled") {
          throw new Error(job.error || `Generation ${job.status}`);
        }
      }

      setChat((c) => [
        ...c,
        { role: "assistant", text: "Generation complete. You can edit the app now." },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Generation failed: ${message}`);
      setChat((c) => [...c, { role: "assistant", text: `Generation failed: ${message}` }]);
    } finally {
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    // Async: website-clone projects are stored in IndexedDB (see project-store).
    void (async () => {
      if (share) {
        const p = decodeShare(share);
        if (p && p.screens?.[0]?.html) {
          const normalized = normalizeProject(p)!;
          setProject(normalized);
          setSelectedId(normalized.screens[0]?.id ?? null);
          saveProject(normalized);
          setChat([{ role: "assistant", text: `Loaded a shared project — "${p.name}".` }]);
          return;
        }
        toast.error("Shared link is invalid or from an older version.");
      }
      // Opening a specific saved project from the Home page (?project=<id>).
      if (projectIdParam) {
        const p = await loadProjectById(projectIdParam);
        if (p && p.screens?.[0]?.html) {
          const normalized = normalizeProject(p)!;
          setProject(normalized);
          setSelectedId(normalized.screens[0]?.id ?? null);
          const cs = (normalized as any).canvas_state;
          if (cs) useEditorStore.getState().restore(cs);
          setChat([
            { role: "assistant", text: `Reopened "${p.name}". Pick up where you left off.` },
          ]);
          return;
        }
        toast.error("That project could not be found.");
      }
      const saved = await loadProject();
      const savedIsCurrent = !!saved && saved.screens?.[0]?.html && (!idea || saved.idea === idea);
      if (savedIsCurrent) {
        // Load the saved project directly — NO AI call. Covers every reload path
        // (hard refresh, reopened tab, back-nav) even if ?idea is still in the URL.
        const normalized = normalizeProject(saved)!;
        setProject(normalized);
        setSelectedId(normalized.screens[0]?.id ?? null);
        const cs = (normalized as any).canvas_state;
        if (cs) useEditorStore.getState().restore(cs);
      } else if (idea) {
        // Genuinely new idea (no matching saved project) → generate once.
        generate(idea, platformParam ?? "ios");
      } else if (saved) {
        // Legacy block-based project — retire it silently.
        toast.message("Your previous project was on an older format", {
          description: "Start a new one to use the HTML editor.",
        });
      }
    })();
  }, [idea, platformParam, share, projectIdParam, generate]);

  // ---- Autosave (debounced) — mirrors the reference editor's live-save -------
  const projectRef = useRef<Project | null>(null);
  projectRef.current = project;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didInitSaveRef = useRef(false);
  // Live-save status lives in the editor store (not React state here) so that
  // flipping it re-renders ONLY the navbar indicator, never this Workspace tree.
  // Updating Workspace state here re-rendered Canvas, which wrote to the store,
  // which re-entered the html-sync effects and called setProject — an infinite
  // update loop on direct page loads. Routing status through the store avoids it.
  const markSaving = () => (useEditorStore.getState() as any).setSaveStatus("saving");
  const markSaved = () => (useEditorStore.getState() as any).setSaveStatus("saved");

  // 1) Content autosave + the live-save indicator. Keyed on `project` ONLY.
  //    The first assignment (initial load) is skipped so the indicator doesn't
  //    flash "Saving…" on open.
  useEffect(() => {
    if (!project) return;
    if (!didInitSaveRef.current) {
      didInitSaveRef.current = true;
      return;
    }
    markSaving();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const cs = (useEditorStore.getState() as any).canvasState?.();
      saveProject({ ...(project as any), canvas_state: cs } as Project);
      markSaved();
    }, 450);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [project]);

  // 2) Editor-only metadata (zoom / pan / layer names / locks / hidden /
  //    color+text styles) — persist even when the project object didn't change.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditorStore.subscribe(() => {
      if (!projectRef.current) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        const cs = (useEditorStore.getState() as any).canvasState?.();
        if (projectRef.current)
          saveProject({ ...(projectRef.current as any), canvas_state: cs } as Project);
      }, 700);
    });
    return () => {
      if (t) clearTimeout(t);
      unsub();
    };
  }, []);

  // 3) When undo/redo restores a palette CSS snapshot, sync it back into React
  //    project state. paletteRestored is set ONLY by undo/redo (not by normal
  //    palette edits), so this never creates a feedback loop.
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state: any) => {
      const restored = state.paletteRestored;
      if (!restored) return;
      useEditorStore.setState({ paletteRestored: null });
      setProject((prev) => {
        if (!prev) return prev;
        // A whole-project restyle snapshot also carries all screens; restore them
        // too. (A plain palette tweak has no screens and only swaps css/palette.)
        const screensChanged = Array.isArray(restored.screens);
        if (!screensChanged && prev.designSystemCss === restored.css) return prev;
        const next = {
          ...prev,
          designSystemCss: restored.css,
          designSystem: { ...prev.designSystem, palette: restored.palette },
          ...(screensChanged ? { screens: restored.screens } : {}),
        } as Project;
        saveProject(next);
        // Force the editor to reload the selected screen from the restored html.
        lastLoadedRef.current = null;
        return next;
      });
    });
    return unsub;
  }, []);

  function handleShare() {
    if (!project) return;
    if ((project as any)?.format_config?.artifactType === "website") {
      toast.message("Sharing isn't available for website imports yet", {
        description: "The page payload is too large for a share link.",
      });
      return;
    }
    const link = `${window.location.origin}/workspace?share=${encodeShare(project)}`;
    navigator.clipboard.writeText(link).then(
      () => toast.success("Share link copied to clipboard"),
      () => toast.error("Couldn't copy — clipboard blocked"),
    );
  }

  async function refine() {
    if (!input.trim() || !project || status !== "idle" || !selectedId) return;
    const screen = project.screens.find((s) => s.id === selectedId);
    if (!screen) return;
    const instruction = input.trim();

    // Website imports: the full page is far too large for a model call, so AI
    // edits are scoped to ONE selected element (Lite click-target or the Pro
    // canvas selection) and the result is spliced back by data-mae-id.
    if ((project as any)?.format_config?.artifactType === "website") {
      const proSel = (useEditorStore.getState() as any).selectedId as string | null;
      const elId =
        liteSel && liteSel.screenId === selectedId ? liteSel.elId : mode === "pro" ? proSel : null;
      if (!elId) {
        setChat((c) => [
          ...c,
          {
            role: "assistant",
            text: "Select an element first — click one in Lite mode or select it on the Pro canvas — then tell me what to change.",
          },
        ]);
        return;
      }
      const doc = new DOMParser().parseFromString(
        `<div id="__r">${screen.html}</div>`,
        "text/html",
      );
      const el = doc.querySelector(`#__r [data-mae-id="${CSS.escape(elId)}"]`);
      if (!el) {
        toast.error("Selected element not found — try selecting it again.");
        return;
      }
      const elementHtml = el.outerHTML;
      if (elementHtml.length > 60000) {
        setChat((c) => [
          ...c,
          {
            role: "assistant",
            text: "That element is too large for an AI edit — select something more specific inside it (use the Layers panel).",
          },
        ]);
        return;
      }
      setInput("");
      setChat((c) => [...c, { role: "user", text: instruction }]);
      setStatus("refining");
      try {
        const res = await fetchAi(
          "/api/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "refine-element",
              instruction,
              elementHtml,
              projectContext: { name: project.name, platform: "web" },
            }),
          },
          AI_GENERATION_REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const { html } = (await res.json()) as { html: string };
        const frag = new DOMParser().parseFromString(`<div id="__f">${html}</div>`, "text/html");
        const replacement = frag.querySelector("#__f > *");
        if (!replacement) throw new Error("AI returned an empty element");
        replacement.setAttribute("data-mae-id", elId);
        el.replaceWith(replacement);
        const updated = ensureIds(doc.querySelector("#__r")!.innerHTML);
        setProject((prev) => {
          if (!prev) return prev;
          const next = {
            ...prev,
            screens: prev.screens.map((x) => (x.id === selectedId ? { ...x, html: updated } : x)),
          };
          saveProject(next);
          return next;
        });
        setChat((c) => [...c, { role: "assistant", text: "Updated the selected element." }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Refine failed: ${message}`);
        setChat((c) => [...c, { role: "assistant", text: `Refine failed: ${message}` }]);
      } finally {
        setStatus("idle");
      }
      return;
    }

    // If an element is selected in Lite, focus the AI edit on just that element.
    const focused = liteSel && liteSel.screenId === selectedId;
    const sentInstruction = focused
      ? `${instruction}\n\n[Apply this change ONLY to the element with data-mae-id="${liteSel!.elId}"${liteSelLabel ? ` (the ${liteSelLabel})` : ""}. Keep every other element in the screen exactly as-is, including their data-mae-id attributes.]`
      : instruction;
    setInput("");
    setChat((c) => [
      ...c,
      {
        role: "user",
        text: focused && liteSelLabel ? `${instruction}  ·  on ${liteSelLabel}` : instruction,
      },
    ]);
    setStatus("refining");
    try {
      const res = await fetchAi(
        "/api/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "refine",
            instruction: sentInstruction,
            screenHtml: screen.html,
            designSystemCss: project.designSystemCss,
            projectContext: { name: project.name, platform: project.platform },
          }),
        },
        AI_GENERATION_REQUEST_TIMEOUT_MS,
      );
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const { html } = (await res.json()) as { html: string };
      const withIds = ensureIds(html);
      // Update project only — the reactive sync effect above will push the
      // new html into the editor store (single source of truth: project).
      setProject((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          screens: prev.screens.map((x) => (x.id === selectedId ? { ...x, html: withIds } : x)),
        };
        saveProject(next);
        return next;
      });
      setChat((c) => [...c, { role: "assistant", text: `Updated "${screen.name}".` }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Refine failed: ${message}`);
      setChat((c) => [...c, { role: "assistant", text: `Refine failed: ${message}` }]);
    } finally {
      setStatus("idle");
    }
  }

  // Update a single palette color instantly — no AI call.
  // Patches both the designSystem.palette record and the CSS variable in
  // designSystemCss so all screens (Lite and Pro) reflect the change immediately.
  const updatePaletteColor = useCallback((key: string, hex: string) => {
    setProject((prev) => {
      if (!prev) return prev;
      const varName = PALETTE_CSS_VAR[key] ?? `--${key}`;
      const newCss = prev.designSystemCss.replace(
        new RegExp(`(${varName}\\s*:\\s*)[^;\\n]+`, "g"),
        `$1${hex}`,
      );
      const newPalette = { ...prev.designSystem.palette, [key]: hex };
      // Push old CSS/palette to the shared undo history before overwriting.
      (useEditorStore.getState() as any).commitDesignCss(
        newCss,
        newPalette,
        prev.designSystemCss,
        prev.designSystem.palette,
      );
      const next = {
        ...prev,
        designSystem: { ...prev.designSystem, palette: newPalette },
        designSystemCss: newCss,
      } as Project;
      saveProject(next);
      return next;
    });
  }, []);

  const applyGeneratedDesignSystem = useCallback(
    async (payload: { instruction?: string; sourceUrl?: string }) => {
      if (!project || status !== "idle") return;
      const isWebsite = (project as any)?.format_config?.artifactType === "website";
      const snapshot = {
        ...project,
        screens: project.screens.map((screen) =>
          screen.id === selectedId ? { ...screen, html: editorHtml } : screen,
        ),
      } as Project;
      setStatus("refining");
      try {
        const res = await fetchAi(
          "/api/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: isWebsite ? "website-design-system" : "design-system",
              project: snapshot,
              ...(isWebsite
                ? {
                    screenHtml: selectedId ? editorHtml : snapshot.screens[0]?.html,
                    websiteCss: snapshot.designSystemCss,
                  }
                : {}),
              ...payload,
            }),
          },
          AI_GENERATION_REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const data = (await res.json()) as {
          designSystem: Project["designSystem"];
          designSystemCss: string;
        };
        const oldPalette = snapshot.designSystem.palette;
        const newPalette = data.designSystem.palette;
        // Screens hardcode inline colors instead of using CSS variables, so a new
        // designSystemCss alone won't restyle them. Deterministically remap EVERY
        // color in EVERY screen from the old palette to the new one (nearest-anchor
        // + preserved offset) — this is what actually re-themes all screens
        // consistently. Applies to native app AND website projects.
        const nextScreens = snapshot.screens.map((screen) => ({
          ...screen,
          html: remapHtmlColors(screen.html, oldPalette, newPalette),
        }));
        const next = {
          ...snapshot,
          designSystem: data.designSystem,
          designSystemCss: data.designSystemCss,
          screens: nextScreens,
        } as Project;
        // Record the full restyle (old css + palette + all screens) in the shared
        // undo history BEFORE applying, so Ctrl+Z / the toolbar buttons revert it.
        (useEditorStore.getState() as any).commitDesignRestyle(
          data.designSystemCss,
          newPalette,
          snapshot.designSystemCss,
          oldPalette,
          snapshot.screens,
        );
        setProject(next);
        saveProject(next);
        lastLoadedRef.current = null; // reload editor from the remapped selected screen
        toast.success(payload.sourceUrl ? "Applied AI style reference" : "Design system updated");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Design system update failed: ${message}`);
      } finally {
        setStatus("idle");
      }
    },
    [editorHtml, project, selectedId, status],
  );

  const addExtraScreen = useCallback(
    async (screenName: string, purpose: string) => {
      if (!project || status !== "idle") return;
      setStatus("generating");
      try {
        const snapshot = {
          ...project,
          screens: project.screens.map((screen) =>
            screen.id === selectedId ? { ...screen, html: editorHtml } : screen,
          ),
        } as Project;
        const res = await fetchAi(
          "/api/generate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "extra-screen", project: snapshot, screenName, purpose }),
          },
          AI_GENERATION_REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const { screen } = (await res.json()) as { screen: Project["screens"][number] };
        const nextScreen = { ...screen, html: ensureIds(screen.html) };
        const next = { ...snapshot, screens: [...snapshot.screens, nextScreen] } as Project;
        setProject(next);
        setSelectedId(nextScreen.id);
        saveProject(next);
        toast.success(`"${nextScreen.name}" generated`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Could not generate screen: ${message}`);
      } finally {
        setStatus("idle");
      }
    },
    [editorHtml, project, selectedId, status],
  );

  function setPlatform(p: "ios" | "android") {
    if (!project) return;
    const next = { ...project, platform: p };
    setProject(next);
    saveProject(next);
  }

  // ---- Connect (prototype) mode -------------------------------------------
  const startScreen =
    ((project as any)?.flowStart as string | undefined) || project?.screens[0]?.id || null;

  // Elements need a stable data-mae-id to be addressable (Lite element select,
  // Connect linking, Pro editing). Normalize any screen missing ids — idempotent.
  useEffect(() => {
    if (!project) return;
    if (!project.screens.some((s) => s.html && !/data-mae-id/.test(s.html))) return;
    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        screens: prev.screens.map((s) => ({ ...s, html: s.html ? ensureIds(s.html) : s.html })),
      };
      saveProject(next);
      return next;
    });
  }, [project]);

  useEffect(() => {
    if (mode === "connect" && !connectScreenId && project?.screens[0])
      setConnectScreenId(project.screens[0].id);
  }, [mode, connectScreenId, project]);

  const applyInteraction = useCallback(
    (screenId: string, elId: string, attrs: Record<string, unknown>) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          screens: prev.screens.map((s) =>
            s.id === screenId
              ? { ...s, html: applyInteractionToHtml(s.html || "", elId, attrs) }
              : s,
          ),
        };
        saveProject(next);
        return next;
      });
    },
    [],
  );

  const clearInteraction = useCallback((screenId: string, elId: string) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        screens: prev.screens.map((s) =>
          s.id === screenId ? { ...s, html: clearInteractionFromHtml(s.html || "", elId) } : s,
        ),
      };
      saveProject(next);
      return next;
    });
  }, []);

  const setStart = useCallback((screenId: string) => {
    setProject((prev) => {
      if (!prev) return prev;
      const next = { ...(prev as any), flowStart: screenId } as Project;
      saveProject(next);
      return next;
    });
  }, []);

  // Lite element selection: focus the screen and remember the targeted element.
  const onLiteSelectElement = useCallback((screenId: string, elId: string | null) => {
    setSelectedId(screenId);
    setLiteSel(elId ? { screenId, elId } : null);
  }, []);

  // Human-readable label for the Lite-selected element (shown in the chat).
  const liteSelLabel = useMemo(() => {
    if (!liteSel) return null;
    const s = project?.screens.find((x) => x.id === liteSel.screenId);
    if (!s?.html) return null;
    try {
      const doc = new DOMParser().parseFromString(`<div id="__r">${s.html}</div>`, "text/html");
      const el = doc.querySelector(`#__r [data-mae-id="${CSS.escape(liteSel.elId)}"]`);
      if (!el) return null;
      const txt = (el.textContent || "").trim();
      return `${el.tagName.toLowerCase()}${txt ? ` · ${txt.slice(0, 22)}` : ""}`;
    } catch {
      return null;
    }
  }, [liteSel, project]);

  const selected = project?.screens.find((s) => s.id === selectedId) ?? null;
  const isBusy = status !== "idle";
  const isWebsiteProject = (project as any)?.format_config?.artifactType === "website";
  const websiteFrameWidth =
    ((project as any)?.format_config?.frame?.width as number | undefined) ?? null;

  // Keyboard shortcuts — active in Pro mode (the canvas editor). Ported from the
  // reference editor so the full shortcut set is restored, not just undo/redo.
  useEffect(() => {
    if (mode !== "pro") return;
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.getAttribute("contenteditable") === "true")
      );
    };
    const onKey = (e: KeyboardEvent) => {
      const s = useEditorStore.getState() as any;
      const ops = s.ops || {};
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping();

      // Hold Space to pan.
      if (e.code === "Space" && !typing && !mod) {
        if (!s.spaceDown) s.setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (typing) {
        if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      if (mod) {
        const k = e.key.toLowerCase();
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            s.redo();
          } else {
            if (s.inBatch) s.endBatch();
            s.undo();
          }
          return;
        }
        if (k === "s") {
          e.preventDefault();
          if (project) saveProject(project);
          return;
        }
        if (k === "y") {
          e.preventDefault();
          s.redo();
          return;
        }
        if (k === "d") {
          e.preventDefault();
          ops.duplicateSelected?.();
          return;
        }
        if (k === "c") {
          e.preventDefault();
          ops.copySelected?.();
          return;
        }
        if (k === "x") {
          e.preventDefault();
          ops.cut?.();
          return;
        }
        if (k === "v") {
          e.preventDefault();
          ops.paste?.();
          return;
        }
        if (k === "a") {
          e.preventDefault();
          ops.selectAll?.();
          return;
        }
        if (k === "k") {
          e.preventDefault();
          if (s.selectedId) window.dispatchEvent(new CustomEvent("mae:focus-ai"));
          return;
        }
        if (k === "g" && !e.shiftKey) {
          e.preventDefault();
          ops.group?.();
          return;
        }
        if (k === "h" && e.shiftKey) {
          e.preventDefault();
          s.selectedIds.forEach((id: string) => s.toggleHidden(id));
          return;
        }
        if (k === "l" && e.shiftKey) {
          e.preventDefault();
          s.selectedIds.forEach((id: string) => s.toggleLock(id));
          return;
        }
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          ops.zoomIn?.();
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          ops.zoomOut?.();
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          e.shiftKey ? ops.bringToFront?.() : ops.bringForward?.();
          return;
        }
        if (e.key === "[") {
          e.preventDefault();
          e.shiftKey ? ops.sendToBack?.() : ops.sendBackward?.();
          return;
        }
        return;
      }

      if (e.shiftKey && e.key === "1") {
        e.preventDefault();
        ops.fitToScreen?.();
        return;
      }
      if (e.shiftKey && e.key === "2") {
        e.preventDefault();
        ops.zoomToSelection?.();
        return;
      }
      if (e.shiftKey && (e.key === "0" || e.key === ")")) {
        e.preventDefault();
        ops.resetZoom?.();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        e.shiftKey ? ops.selectPrev?.() : ops.selectNext?.();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedIds.length) {
        e.preventDefault();
        ops.deleteSelected?.();
        return;
      }
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        s.selectedIds.length
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const map: Record<string, [number, number]> = {
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
        };
        const [dx, dy] = map[e.key];
        ops.nudge?.(dx, dy);
        return;
      }
      if (e.key === "Enter" && s.selectedId) {
        e.preventDefault();
        ops.startEditingSelected?.();
        return;
      }
      if (e.key === "F2" && s.selectedId) {
        e.preventDefault();
        ops.startRename?.();
        return;
      }
      if (e.key === "Escape") {
        s.select(null);
        return;
      }
      if (!e.shiftKey && !e.altKey) {
        const toolMap: Record<string, string> = {
          v: "select",
          h: "hand",
          t: "text",
          f: "frame",
          r: "rect",
          o: "ellipse",
          i: "image",
        };
        const t = toolMap[e.key.toLowerCase()];
        if (t) {
          s.setTool(t);
          return;
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") (useEditorStore.getState() as any).setSpaceDown(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [mode, project]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-surface text-foreground">
      {/* Top bar */}
      <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5">
        <Link to="/" className="flex items-center gap-2">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-brand shadow-[0_0_20px_-2px_var(--brand)]">
            <span className="font-serif text-base font-bold italic leading-none text-white">S</span>
          </div>
          <span className="font-semibold tracking-tight">
            sleek<span className="text-muted-foreground">.design</span>
          </span>
        </Link>

        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-sm text-foreground/85">
          <span className="text-muted-foreground">Dashboard</span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">
            {project?.name ?? (isBusy ? "Generating…" : "Untitled Project")}
          </span>
          {project && <SaveIndicator />}
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-1 rounded-full border border-border bg-panel/40 p-1">
            {(isWebsiteProject
              ? (["lite", "pro"] as const)
              : (["lite", "pro", "connect"] as const)
            ).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  mode === m ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "pro" && <Zap className="h-3 w-3" />}
                {m === "connect" && <Share2 className="h-3 w-3" />}
                {m === "pro" ? "Pro" : m === "connect" ? "Connect" : "Lite"}
              </button>
            ))}
          </div>

          {mode === "pro" && (
            <div className="ml-1 flex items-center gap-1 rounded-full border border-border bg-panel/40 p-1">
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⇧⌘Z)"
                className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {[Moon, HelpCircle, Megaphone].map((Icon, i) => (
            <button
              key={i}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-panel/40 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <div className="ml-1 flex items-center gap-1 rounded-full border border-border bg-panel/40 p-1">
            <button
              onClick={() => project && setPreviewOpen(true)}
              disabled={!project}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-panel disabled:opacity-40"
            >
              <MonitorPlay className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              onClick={handleShare}
              disabled={!project}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-panel disabled:opacity-40"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={!project}
              className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-40"
            >
              Export
            </button>
          </div>
          <button className="flex items-center gap-1.5 rounded-full border border-border bg-panel/40 px-3 py-1.5 text-xs font-medium text-foreground/90 hover:bg-panel">
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            Upgrade
          </button>
          <div className="relative ml-1">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-brand text-xs font-bold text-white ring-offset-surface transition-all hover:ring-2 hover:ring-brand/50 hover:ring-offset-2"
              aria-label="Profile menu"
            >
              T
            </button>
            {profileOpen && <ProfileDropdown onClose={() => setProfileOpen(false)} />}
          </div>
        </div>

        {exportOpen && <ExportDropdown project={project} onClose={() => setExportOpen(false)} />}
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — chat + theme (both modes), plus Layers in Pro */}
        <aside className="flex w-[320px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="flex items-center justify-between px-4 pt-4">
            <div className="flex items-center gap-1 rounded-full bg-panel/70 p-1">
              {(mode === "pro" ? (["chat", "theme"] as const) : (["chat", "theme"] as const)).map(
                (t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                      tab === t
                        ? "bg-brand text-white"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ),
              )}
            </div>
          </div>

          {tab === "chat" ? (
            <ChatPanel
              project={project}
              chat={chat}
              isBusy={isBusy}
              status={status}
              input={input}
              setInput={setInput}
              refine={refine}
              screens={project?.screens ?? []}
              selectedId={selectedId}
              onSelectScreen={setSelectedId}
              onAddScreen={addExtraScreen}
              focusLabel={liteSel ? liteSelLabel : null}
              onClearFocus={() => setLiteSel(null)}
            />
          ) : (
            <ThemePanel
              project={project}
              setPlatform={setPlatform}
              onPaletteChange={updatePaletteColor}
              onApplyDesignSystem={applyGeneratedDesignSystem}
              isBusy={status !== "idle"}
            />
          )}

          {mode === "pro" && project && (
            <div className="max-h-[40%] shrink-0 overflow-y-auto border-t border-border">
              <Suspense
                fallback={<div className="p-3 text-xs text-muted-foreground">Loading layers…</div>}
              >
                <LayersPanel embedded />
              </Suspense>
            </div>
          )}
        </aside>

        {/* Canvas */}
        <main
          className="relative flex-1 overflow-hidden"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        >
          {mode === "pro" ? (
            <ProCanvasHost project={project} isBusy={isBusy} />
          ) : mode === "connect" ? (
            project ? (
              <Suspense
                fallback={<div className="p-6 text-sm text-muted-foreground">Loading flow…</div>}
              >
                <FlowCanvas
                  screens={project.screens}
                  css={project.designSystemCss}
                  startScreen={startScreen}
                  selection={protoSelection}
                  setSelection={setProtoSelection}
                  selectedConnection={selectedConnection}
                  setSelectedConnection={setSelectedConnection}
                  applyInteraction={applyInteraction}
                  clearInteraction={clearInteraction}
                  initialPositions={(project as any).flow_positions}
                  onPositions={(pos: Record<string, { x: number; y: number }>) => {
                    setProject((prev) =>
                      prev ? ({ ...(prev as any), flow_positions: pos } as Project) : prev,
                    );
                  }}
                  onOpenScreen={(id: string) => {
                    setSelectedId(id);
                    setMode("pro");
                  }}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState isBusy={isBusy} />
              </div>
            )
          ) : (
            <LiteCanvas
              project={project}
              selectedId={selectedId}
              onSelectScreen={(id) => {
                setSelectedId(id);
                setLiteSel(null);
              }}
              selElId={liteSel}
              onSelectElement={onLiteSelectElement}
              isBusy={isBusy}
            />
          )}
        </main>

        {/* Right panel — Properties (Pro) or Prototype (Connect) */}
        {mode === "pro" && project && (
          <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-border bg-surface">
            <Suspense
              fallback={
                <div className="p-3 text-xs text-muted-foreground">Loading properties…</div>
              }
            >
              <PropertiesPanel />
            </Suspense>
          </aside>
        )}
        {mode === "connect" && project && (
          <Suspense
            fallback={
              <div className="w-[320px] shrink-0 p-3 text-xs text-muted-foreground">
                Loading prototype…
              </div>
            }
          >
            <PrototypePanel
              screens={project.screens}
              currentScreenId={connectScreenId}
              selection={protoSelection}
              startScreen={startScreen}
              onSwitch={setConnectScreenId}
              setProtoSelection={setProtoSelection}
              applyInteraction={applyInteraction}
              clearInteraction={clearInteraction}
              setStart={setStart}
            />
          </Suspense>
        )}
      </div>

      {previewOpen && project && (
        <PreviewModal
          project={project}
          onClose={() => setPreviewOpen(false)}
          initialId={selectedId}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// Live-save status pill for the navbar. Reads status straight from the editor
// store so status updates re-render only this pill (never the Workspace tree).
function SaveIndicator() {
  const status = useEditorStore((s: any) => s.saveStatus) as "saved" | "saving";
  const saving = status === "saving";
  return (
    <span
      className={`ml-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        saving
          ? "border-brand/40 bg-brand/10 text-brand"
          : "border-border bg-panel/50 text-muted-foreground"
      }`}
      title={saving ? "Saving your changes…" : "All changes saved locally"}
      data-testid="save-indicator"
      data-status={status}
      aria-live="polite"
    >
      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      {saving ? "Saving…" : "Saved"}
    </span>
  );
}

function LiteCanvas({
  project,
  selectedId,
  onSelectScreen,
  selElId,
  onSelectElement,
  isBusy,
}: {
  project: Project | null;
  selectedId: string | null;
  onSelectScreen: (id: string) => void;
  selElId: { screenId: string; elId: string } | null;
  onSelectElement: (screenId: string, elId: string | null) => void;
  isBusy: boolean;
}) {
  return (
    <div className="h-full w-full overflow-auto">
      <div className="min-h-full p-14">
        {project ? (
          <div className="flex min-w-max items-start justify-center gap-10">
            {project.screens.map((s, i) => (
              <LitePhoneScreen
                key={s.id}
                screenId={s.id}
                platform={project.platform}
                html={s.html}
                css={project.designSystemCss}
                label={s.name}
                index={i}
                selected={s.id === selectedId}
                selectedElId={selElId && selElId.screenId === s.id ? selElId.elId : null}
                onClick={() => onSelectScreen(s.id)}
                onSelectElement={onSelectElement}
                isWebsite={(project as any)?.format_config?.artifactType === "website"}
                frameWidth={
                  ((project as any)?.format_config?.frame?.width as number | undefined) ?? null
                }
                frameHeight={
                  (project as any)?.format_config?.artifactType === "figma"
                    ? (((project as any)?.format_config?.frame?.height as number | undefined) ?? null)
                    : null
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState isBusy={isBusy} />
        )}
      </div>
    </div>
  );
}

function ProCanvasHost({ project, isBusy }: { project: Project | null; isBusy: boolean }) {
  return (
    <div className="relative h-full w-full">
      {project ? (
        <Suspense
          fallback={<div className="p-6 text-sm text-muted-foreground">Loading editor…</div>}
        >
          <Canvas />
        </Suspense>
      ) : (
        <div className="flex h-full items-center justify-center">
          <EmptyState isBusy={isBusy} />
        </div>
      )}
    </div>
  );
}

function LitePhoneScreen({
  screenId,
  platform,
  html,
  css,
  label,
  index,
  selected,
  selectedElId,
  onClick,
  onSelectElement,
  isWebsite = false,
  frameWidth = null,
  frameHeight = null,
}: {
  screenId?: string;
  platform: "ios" | "android";
  html: string;
  css: string;
  label: string;
  index: number;
  selected: boolean;
  selectedElId?: string | null;
  onClick: () => void;
  onSelectElement?: (screenId: string, elId: string | null) => void;
  isWebsite?: boolean;
  frameWidth?: number | null;
  frameHeight?: number | null;
}) {
  // Element selection: click content to target a specific element (for focused
  // AI edits), click empty screen area to select the whole screen. Uses
  // coordinate hit-testing (deepest tagged element first).
  const onClickCapture = onSelectElement
    ? (e: ReactMouseEvent<HTMLDivElement>) => {
        const el = document
          .elementsFromPoint(e.clientX, e.clientY)
          .find(
            (x) =>
              x.hasAttribute("data-mae-id") && !(x as HTMLElement).classList.contains("screen"),
          );
        e.preventDefault();
        e.stopPropagation();
        if (el && screenId) onSelectElement(screenId, el.getAttribute("data-mae-id"));
        else {
          onClick();
          if (screenId) onSelectElement(screenId, null);
        }
      }
    : undefined;

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div className="ml-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        <span className="text-brand">{String(index + 1).padStart(2, "0")}</span>
        <span>{label}</span>
      </div>
      <PhoneScreenFrame
        platform={platform}
        html={html}
        css={css}
        isWebsite={isWebsite}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
        onSelect={onClick}
        onClickCapture={onClickCapture}
        wrapperData={{ "data-phone-frame-button": "" }}
        wrapperClassName={`group relative cursor-default ${isWebsite || frameHeight != null ? "rounded-xl" : "rounded-[48px]"} transition-all ${
          selected
            ? "shadow-[0_0_0_2px_var(--brand),0_30px_60px_-15px_rgba(99,102,241,0.4)]"
            : "shadow-2xl hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)]"
        }`}
      >
        {selectedElId && (
          <style
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: `[data-mae-id="${selectedElId}"]{outline:2px solid #6366f1 !important;outline-offset:2px;border-radius:4px;}`,
            }}
          />
        )}
      </PhoneScreenFrame>
    </div>
  );
}

function EmptyState({ isBusy }: { isBusy: boolean }) {
  return (
    <div className="flex h-[70vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/15">
        {isBusy ? (
          <Loader2 className="h-6 w-6 animate-spin text-brand" />
        ) : (
          <Sparkle className="h-6 w-6 text-brand" />
        )}
      </div>
      <div className="text-lg font-semibold">
        {isBusy ? "Composing your app…" : "Nothing on the canvas yet"}
      </div>
      <div className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isBusy
          ? "Sleek is generating a shared design system and a set of high-fidelity screens."
          : "Describe an app in the chat panel to generate a set of screens."}
      </div>
    </div>
  );
}

function ChatPanel({
  project,
  chat,
  isBusy,
  status,
  input,
  setInput,
  refine,
  screens,
  selectedId,
  onSelectScreen,
  onAddScreen,
  focusLabel,
  onClearFocus,
}: {
  project: Project | null;
  chat: ChatMsg[];
  isBusy: boolean;
  status: "idle" | "generating" | "refining";
  input: string;
  setInput: (v: string) => void;
  refine: () => void | Promise<void>;
  screens: Project["screens"];
  selectedId: string | null;
  onSelectScreen: (id: string) => void;
  onAddScreen: (screenName: string, purpose: string) => Promise<void>;
  focusLabel?: string | null;
  onClearFocus?: () => void;
}) {
  const [showAddScreen, setShowAddScreen] = useState(false);
  const [screenName, setScreenName] = useState("");
  const [screenPurpose, setScreenPurpose] = useState("");
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {project?.idea && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-panel/60 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/15">
              <Sparkles className="h-4 w-4 text-brand" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Project brief
              </div>
              <div className="truncate text-sm font-semibold">{project.name}</div>
            </div>
          </div>
        )}
        {chat.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="ml-auto max-w-[85%] rounded-2xl bg-panel px-4 py-2 text-sm text-foreground/90"
            >
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className="mr-auto max-w-[92%] rounded-2xl border border-border/60 bg-panel/40 px-4 py-2.5 text-sm text-foreground/90"
            >
              {m.text}
            </div>
          ),
        )}
        {isBusy && (
          <div className="mr-auto flex max-w-[92%] items-center gap-2 rounded-2xl border border-border/60 bg-panel/40 px-4 py-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
            {status === "generating" ? "Composing screens…" : "Applying refinement…"}
          </div>
        )}
        {screens.length > 0 && (
          <div className="pt-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Screens
              </div>
              <button
                onClick={() => setShowAddScreen((v) => !v)}
                disabled={isBusy}
                className="flex items-center gap-1 text-[11px] font-medium text-brand hover:brightness-110 disabled:opacity-40"
                data-testid="add-screen-toggle"
              >
                {showAddScreen ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                {showAddScreen ? "Cancel" : "Add"}
              </button>
            </div>
            {showAddScreen && (
              <div className="mb-2 space-y-2 rounded-xl border border-border bg-panel/40 p-2">
                <input
                  value={screenName}
                  onChange={(e) => setScreenName(e.target.value)}
                  placeholder="Settings, Profile, Notifications..."
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand/60"
                  data-testid="new-screen-name"
                />
                <input
                  value={screenPurpose}
                  onChange={(e) => setScreenPurpose(e.target.value)}
                  placeholder="Purpose, content, or user goal"
                  className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand/60"
                  data-testid="new-screen-purpose"
                />
                <button
                  onClick={async () => {
                    if (!screenName.trim()) return toast.error("Name the screen.");
                    await onAddScreen(screenName.trim(), screenPurpose.trim());
                    setShowAddScreen(false);
                    setScreenName("");
                    setScreenPurpose("");
                  }}
                  disabled={isBusy || !screenName.trim()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  data-testid="confirm-add-screen"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Generating...
                    </>
                  ) : (
                    <>Generate screen</>
                  )}
                </button>
              </div>
            )}
            <div className="space-y-1">
              {screens.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => onSelectScreen(s.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                    selectedId === s.id
                      ? "bg-brand/15 text-foreground"
                      : "text-muted-foreground hover:bg-panel"
                  }`}
                >
                  <span className="w-5 font-mono text-[10px] text-brand">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4">
        {focusLabel && (
          <div
            className="mb-2 flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-xs"
            data-testid="lite-focus-chip"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand">
              Editing
            </span>
            <span className="flex-1 truncate text-foreground/90">{focusLabel}</span>
            <button
              onClick={onClearFocus}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear element focus"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-panel/60 p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void refine();
              }
            }}
            disabled={!project || isBusy}
            placeholder={
              project
                ? focusLabel
                  ? `Change the ${focusLabel}…`
                  : "Change the selected screen…"
                : "What do you want to design?"
            }
            className="min-h-[64px] w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none disabled:opacity-50"
          />
          <div className="mt-1 flex items-center justify-between">
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              aria-label="Attach"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => void refine()}
              disabled={!project || isBusy || !input.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-[0_6px_20px_-6px_rgba(255,120,40,0.9)] transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemePanel({
  project,
  setPlatform,
  onPaletteChange,
  onApplyDesignSystem,
  isBusy,
}: {
  project: Project | null;
  setPlatform: (p: "ios" | "android") => void;
  onPaletteChange?: (key: string, hex: string) => void;
  onApplyDesignSystem: (payload: { instruction?: string; sourceUrl?: string }) => Promise<void>;
  isBusy: boolean;
}) {
  const [editSwatch, setEditSwatch] = useState<{
    key: string;
    color: string;
    anchor: HTMLElement;
  } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [styleUrl, setStyleUrl] = useState("");
  const swatchRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const designSystem = project?.designSystem?.palette
    ? project.designSystem
    : FALLBACK_DESIGN_SYSTEM;
  const isWebsite = project && (project as any)?.format_config?.artifactType === "website";

  if (isWebsite) {
    const src = (project as any)?.format_config?.source?.url as string | undefined;
    const w = (project as any)?.format_config?.frame?.width ?? 1440;
    return (
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-brand">
            <Sparkles className="h-3 w-3" /> System Design
          </div>
          <div className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            Restyle this website with AI-generated original CSS. Reference URLs are interpreted for
            mood and brand direction only; CSS is not cloned.
          </div>
          <div className="space-y-2">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={2}
              placeholder="e.g. darker SaaS landing page, editorial luxury, playful fintech..."
              className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-brand/60"
              data-testid="ds-ai-prompt"
            />
            <button
              onClick={async () => {
                if (!instruction.trim()) return toast.error("Describe the design change.");
                await onApplyDesignSystem({ instruction: instruction.trim() });
                setInstruction("");
              }}
              disabled={isBusy || !instruction.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-xs font-semibold text-white disabled:opacity-40"
              data-testid="ds-ai-prompt-btn"
            >
              {isBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
              Regenerate website theme
            </button>
          </div>
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            <input
              value={styleUrl}
              onChange={(e) => setStyleUrl(e.target.value)}
              placeholder="reference URL, e.g. https://stripe.com"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brand/60"
              data-testid="ds-ai-url"
            />
            <button
              onClick={async () => {
                if (!styleUrl.trim()) return toast.error("Enter a website URL.");
                await onApplyDesignSystem({ sourceUrl: styleUrl.trim() });
                setStyleUrl("");
              }}
              disabled={isBusy || !styleUrl.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-panel py-2 text-xs font-semibold hover:bg-panel/80 disabled:opacity-40"
              data-testid="ds-ai-url-btn"
            >
              {isBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Globe className="h-3 w-3" />
              )}
              Use as AI style reference
            </button>
          </div>
        </div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Website import
        </div>
        <div className="rounded-xl border border-border bg-panel/40 p-3">
          <div className="truncate text-sm font-semibold">{project.name}</div>
          {src && (
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{src}</div>
          )}
          <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Captured at {w}px desktop width. AI theme updates replace the captured CSS while
            preserving page HTML and data-mae-id edit targets.
          </div>
        </div>
        <div className="mb-3 mt-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Theme Snapshot
        </div>
        <div className="rounded-xl border border-border bg-panel/40 p-3 text-xs text-muted-foreground">
          <div className="flex justify-between gap-2">
            <span>Font</span>
            <span className="truncate text-foreground">{designSystem.font}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span>Radius</span>
            <span className="text-foreground">{designSystem.radius}</span>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1">
            {Object.entries(designSystem.palette).map(([k, v]) => (
              <div
                key={k}
                className="h-6 rounded border border-white/10"
                style={{ background: v }}
                title={`${k}: ${v}`}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {project ? (
        <>
          <div className="mb-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-brand">
              <Sparkles className="h-3 w-3" /> System Design
            </div>
            <div className="space-y-2">
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                placeholder="e.g. make it darker, more premium, playful, editorial..."
                className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-brand/60"
                data-testid="ds-ai-prompt"
              />
              <button
                onClick={async () => {
                  if (!instruction.trim()) return toast.error("Describe the design change.");
                  await onApplyDesignSystem({ instruction: instruction.trim() });
                  setInstruction("");
                }}
                disabled={isBusy || !instruction.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand py-2 text-xs font-semibold text-white disabled:opacity-40"
                data-testid="ds-ai-prompt-btn"
              >
                {isBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3" />
                )}
                Regenerate with AI
              </button>
            </div>
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <input
                value={styleUrl}
                onChange={(e) => setStyleUrl(e.target.value)}
                placeholder="reference URL, e.g. https://stripe.com"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brand/60"
                data-testid="ds-ai-url"
              />
              <button
                onClick={async () => {
                  if (!styleUrl.trim()) return toast.error("Enter a website URL.");
                  await onApplyDesignSystem({ sourceUrl: styleUrl.trim() });
                  setStyleUrl("");
                }}
                disabled={isBusy || !styleUrl.trim()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-panel py-2 text-xs font-semibold hover:bg-panel/80 disabled:opacity-40"
                data-testid="ds-ai-url-btn"
              >
                {isBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
                Use as AI style reference
              </button>
            </div>
          </div>

          <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Palette
          </div>
          <p className="mb-3 text-[10px] text-muted-foreground/60">
            Click any swatch to edit. Changes update all screens instantly.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(designSystem.palette).map(([k, v]) => (
              <div key={k} className="rounded-xl border border-border p-2">
                <button
                  ref={(el) => {
                    swatchRefs.current[k] = el;
                  }}
                  className={`h-10 w-full rounded-md transition-all hover:scale-[1.04] focus:outline-none ${
                    editSwatch?.key === k
                      ? "ring-2 ring-brand ring-offset-1 ring-offset-surface"
                      : "hover:ring-1 hover:ring-white/30"
                  }`}
                  style={{ background: v }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editSwatch?.key === k) {
                      setEditSwatch(null);
                      return;
                    }
                    setEditSwatch({ key: k, color: v, anchor: e.currentTarget });
                  }}
                  title={`Edit ${k}`}
                  data-testid={`palette-swatch-${k}`}
                />
                <div className="mt-1.5 text-[10px] font-medium capitalize">{k}</div>
                <div className="text-[9px] text-muted-foreground font-mono">{v}</div>
              </div>
            ))}
          </div>

          {editSwatch && (
            <ColorPickerComponent
              value={editSwatch.color}
              onChange={(hex: string) => {
                setEditSwatch((prev) => (prev ? { ...prev, color: hex } : null));
                onPaletteChange?.(editSwatch.key, hex);
              }}
              onOpacityChange={() => {}}
              onClose={() => setEditSwatch(null)}
              anchor={editSwatch.anchor}
            />
          )}

          <div className="mb-3 mt-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Platform
          </div>
          <div className="flex items-center gap-1 rounded-full bg-panel/70 p-1">
            {(["ios", "android"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatform(p)}
                className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  (project.platform ?? "ios") === p
                    ? "bg-brand text-white"
                    : "text-muted-foreground"
                }`}
              >
                {p === "ios" ? "iOS" : "Android"}
              </button>
            ))}
          </div>
          <div className="mb-3 mt-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Typography
          </div>
          <div className="rounded-xl border border-border bg-panel/40 p-3 text-sm">
            {designSystem.font}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          Theme appears once screens are generated.
        </div>
      )}
    </div>
  );
}

function ProfileDropdown({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-profile-dropdown]")) onClose();
    }
    setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => document.removeEventListener("click", onDoc);
  }, [onClose]);

  const items = [
    { icon: UserIcon, label: "Account", hint: "Guest" },
    { icon: Settings, label: "Settings" },
    { icon: CreditCard, label: "Billing" },
    { icon: HelpCircle, label: "Help & Support" },
  ];
  return (
    <div
      data-profile-dropdown
      className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-2xl border border-border bg-panel/95 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center gap-3 border-b border-border p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-brand text-sm font-bold text-white">
          T
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Guest Designer</div>
          <div className="truncate text-xs text-muted-foreground">Sign in to save projects</div>
        </div>
      </div>
      <div className="p-1">
        {items.map((it) => (
          <button
            key={it.label}
            onClick={() => {
              toast.message(it.label, { description: "Coming soon" });
              onClose();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface"
          >
            <it.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-[10px] text-muted-foreground">{it.hint}</span>}
          </button>
        ))}
      </div>
      <div className="border-t border-border p-1">
        <button
          onClick={() => {
            toast.message("Sign in", { description: "Auth coming soon" });
            onClose();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand hover:bg-brand/10"
        >
          <LogOut className="h-4 w-4" />
          Sign in
        </button>
      </div>
    </div>
  );
}

function PreviewModal({
  project,
  onClose,
  initialId,
}: {
  project: Project;
  onClose: () => void;
  initialId: string | null;
}) {
  const isWebsite = (project as any)?.format_config?.artifactType === "website";
  const isFigma = (project as any)?.format_config?.artifactType === "figma";
  const frameW = ((project as any)?.format_config?.frame?.width as number | undefined) ?? null;
  const frameH = isFigma
    ? (((project as any)?.format_config?.frame?.height as number | undefined) ?? null)
    : null;
  const flowStart = (project as any).flowStart as string | undefined;
  const [id, setId] = useState<string>(flowStart ?? initialId ?? project.screens[0]?.id ?? "");
  const screen = project.screens.find((s) => s.id === id) ?? project.screens[0];
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prototype click-through: clicking an element with a data-nav-to link
  // navigates to the linked screen (like Figma present mode).
  const onNavClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest?.("[data-nav-to]");
    const target = el?.getAttribute("data-nav-to");
    if (target && project.screens.some((s) => s.id === target)) {
      e.preventDefault();
      e.stopPropagation();
      setId(target);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <button
        onClick={onClose}
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-panel/80 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Close preview"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="absolute left-5 top-5 flex items-center gap-2 text-sm">
        <Sparkle className="h-4 w-4 text-brand" />
        <span className="font-medium">Preview — {project.name}</span>
      </div>
      <div className="flex items-center gap-10">
        <div className="pointer-events-auto flex max-h-[80vh] w-64 flex-col gap-1 overflow-y-auto rounded-2xl border border-border bg-panel/60 p-2">
          {project.screens.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setId(s.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                s.id === id
                  ? "bg-brand/20 text-foreground"
                  : "text-muted-foreground hover:bg-surface"
              }`}
            >
              <span className="w-5 font-mono text-[10px] text-brand">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 truncate">{s.name}</span>
            </button>
          ))}
        </div>
        {screen && (
          <div
            onClickCapture={onNavClick}
            data-testid="preview-stage"
            style={
              isWebsite || isFigma
                ? { maxHeight: "84vh", maxWidth: "72vw", overflow: "auto", borderRadius: 12 }
                : undefined
            }
          >
            <LitePhoneScreen
              platform={project.platform}
              html={screen.html}
              css={project.designSystemCss}
              label={screen.name}
              index={0}
              selected={false}
              onClick={() => {}}
              isWebsite={isWebsite}
              frameWidth={frameW}
              frameHeight={frameH}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports — all derived from HTML
// ---------------------------------------------------------------------------

function figmaJson(project: Project) {
  const frame = (project as any)?.format_config?.frame as
    { width?: number; height?: number } | undefined;
  const width = frame?.width ?? 375;
  const height = frame?.height ?? 812;
  return {
    name: project.name,
    designSystem: project.designSystem,
    designSystemCss: project.designSystemCss,
    frames: project.screens.map((s) => ({
      name: s.name,
      id: s.id,
      width,
      height,
      role: s.role,
      html: s.html,
    })),
    note: "Import via a Figma HTML-to-Figma plugin (e.g. html.to.design) for full fidelity.",
  };
}

function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportDropdown({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const disabled = !project;
  const isWebsite = (project as any)?.format_config?.artifactType === "website";
  const sourceUrl = (project as any)?.format_config?.source?.url as string | undefined;
  const [zipState, setZipState] = useState<"idle" | "preparing">("idle");

  // Download-on-demand (nothing stored): re-clone the source URL, poll, then
  // stream the interactive ZIP. Covers the engine's 30-min artifact TTL.
  async function downloadWebsiteZip() {
    if (!sourceUrl || zipState !== "idle") return;
    setZipState("preparing");
    toast.message("Preparing interactive ZIP…", {
      description: "Re-cloning the live site. This takes a minute.",
    });
    try {
      const res = await fetch("/api/clone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl }),
      });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !data.jobId) throw new Error(data.error || `HTTP ${res.status}`);
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const st = await fetch(`/api/clone/${data.jobId}/status`);
        if (!st.ok) continue;
        const s = (await st.json()) as { status: string; message?: string };
        if (s.status === "done") {
          window.location.href = `/api/clone/${data.jobId}/download`;
          toast.success("ZIP ready — downloading");
          return;
        }
        if (s.status === "error") throw new Error(s.message || "Clone failed");
      }
      throw new Error("Timed out preparing the ZIP");
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setZipState("idle");
    }
  }

  return (
    <div className="absolute right-24 top-[52px] z-50 w-[420px] overflow-hidden rounded-2xl border border-border bg-panel/95 p-5 shadow-2xl backdrop-blur">
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Build with AI
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Copy an AI prompt for your coding tool of choice.
      </p>
      <div className="mt-3 space-y-2">
        <button
          disabled={disabled}
          onClick={() => {
            if (!project) return;
            const prompt = `Design brief: ${project.name}\n\nIdea: ${project.idea}\n\nShared CSS:\n${project.designSystemCss}\n\nScreens:\n${project.screens.map((s, i) => `${i + 1}. ${s.name} (${s.role})\n${s.html}`).join("\n\n---\n\n")}`;
            navigator.clipboard.writeText(prompt);
            toast.success("AI prompt copied");
            onClose();
          }}
          className="flex w-full items-center gap-3 rounded-xl border border-brand/40 bg-gradient-to-b from-brand/5 to-transparent p-3 text-left transition-colors hover:border-brand/70 disabled:opacity-40"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-panel">
            <Code2 className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Copy AI Prompt</div>
            <div className="text-xs text-muted-foreground">
              Paste into Claude Code, Codex, Cursor to implement designs
            </div>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-panel">
            <Copy className="h-3.5 w-3.5" />
          </div>
        </button>
        <button
          disabled
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface/60 p-3 text-left opacity-70"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-panel">
            <Plug className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold">Use Agent Skill</div>
            <div className="text-xs text-muted-foreground">Coming soon</div>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      <div className="my-5 h-px bg-border" />
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Manual Export
      </div>
      <div className="mt-2 space-y-1">
        {isWebsite && (
          <button
            disabled={disabled || !sourceUrl || zipState === "preparing"}
            onClick={() => void downloadWebsiteZip()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface disabled:opacity-40"
            data-testid="export-website-zip"
          >
            {zipState === "preparing" ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="flex-1">Download Website (interactive ZIP)</span>
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        {[
          { icon: Code2, label: "Export React (TSX)", action: "code" },
          { icon: Code2, label: "Export React Project", action: "react-project" },
          { icon: Code2, label: "Export Vue Project", action: "vue" },
          { icon: Code2, label: "Export Angular Project", action: "angular" },
          { icon: Download, label: "Export raw HTML", action: "html" },
          { icon: Figma, label: "Export Figma-ready JSON", action: "figma" },
          { icon: Download, label: "Download Project JSON", action: "json" },
        ].map((item) => (
          <button
            key={item.action}
            disabled={disabled}
            onClick={async () => {
              if (!project) return;
              const name =
                project.name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "") || "project";
              if (item.action === "code") {
                const t = toast.loading("Formatting React TSX…");
                // IR-based export: real JSX per screen (replaces the old
                // dangerouslySetInnerHTML wrapper), re-importable multi-screen.
                downloadFile(`${name}.tsx`, await buildReactTsx(project), "text/plain");
                toast.success("React TSX downloaded", { id: t });
              } else if (item.action === "react-project") {
                const t = toast.loading("Packaging React project…");
                const zip = await createProjectZip(await buildReactProjectExport(project));
                downloadBlob(`${name}-react.zip`, zip);
                toast.success("React project downloaded", { id: t });
              } else if (item.action === "vue") {
                const t = toast.loading("Packaging Vue project…");
                const zip = await createProjectZip(await buildVueProjectExport(project));
                downloadBlob(`${name}-vue.zip`, zip);
                toast.success("Vue project downloaded", { id: t });
              } else if (item.action === "angular") {
                const t = toast.loading("Packaging Angular project…");
                const zip = await createProjectZip(await buildAngularProjectExport(project));
                downloadBlob(`${name}-angular.zip`, zip);
                toast.success("Angular project downloaded", { id: t });
              } else if (item.action === "html") {
                const t = toast.loading("Formatting HTML…");
                // IR-based export: standalone doc, fully re-importable with all
                // screens, names and design CSS intact.
                const rawDoc = await buildHtmlExport(project);
                // Prettier formats the document AND the embedded <style> CSS.
                downloadFile(`${name}.html`, await prettyHtml(rawDoc), "text/html");
                toast.success("HTML downloaded", { id: t });
              } else if (item.action === "figma") {
                const t = toast.loading("Building Figma nodes (measuring via clone engine)…");
                try {
                  // IR-based export: real sleek.figma-nodes document with
                  // resolved geometry + computed styles, consumable by the
                  // bundled sleek.design Figma plugin (or any html.to.design
                  // workflow). Requires the resolve pass (clone engine).
                  const doc = await buildFigmaExport(project);
                  downloadFile(
                    `${name}.figma.json`,
                    JSON.stringify(doc, null, 2),
                    "application/json",
                  );
                  const warnCount = doc.warnings.length;
                  toast.success(
                    `Figma nodes downloaded${warnCount ? ` (${warnCount} warning${warnCount === 1 ? "" : "s"})` : ""}`,
                    { id: t },
                  );
                } catch (err) {
                  // Resolve engine unreachable — fall back to the legacy
                  // HTML-payload dump so the user always leaves with a usable
                  // artifact, and tell them why fidelity is reduced.
                  const message = err instanceof Error ? err.message : String(err);
                  downloadFile(
                    `${name}.figma.json`,
                    JSON.stringify(figmaJson(project), null, 2),
                    "application/json",
                  );
                  toast.error(
                    "Fallback: clone engine offline — downloaded HTML payload instead of resolved nodes.",
                    { id: t, description: message },
                  );
                }
              } else if (item.action === "json") {
                downloadFile(`${name}.json`, JSON.stringify(project, null, 2), "application/json");
                toast.success("Project JSON downloaded");
              }
              onClose();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface disabled:opacity-40"
          >
            <item.icon className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">{item.label}</span>
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
