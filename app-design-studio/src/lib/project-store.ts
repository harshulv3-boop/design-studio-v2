import type { Project } from "./screen-schema";
import { idbDeleteProject, idbGetProject, idbPutProject } from "./website-store";

// Multi-project local persistence.
// - MAP_KEY holds every saved project keyed by id.
// - ACTIVE_KEY holds the id of the last-opened project (drives reload continuity).
// - LEGACY_KEY is the old single-project slot; migrated once into the map.
//
// Website-clone projects (format_config.artifactType === "website") carry
// ~0.3–1 MB of HTML+CSS. Those persist in IndexedDB (website-store.ts); the
// localStorage map keeps only a summary stub (flagged __idb) so the Home grid
// lists them without loading payloads and app projects behave exactly as
// before. Save/delete stay fire-and-forget; the load functions are async.
const LEGACY_KEY = "nova-project";
const MAP_KEY = "nova-projects";
const ACTIVE_KEY = "nova-active-id";

type Stored = Project & {
  updatedAt?: number;
  createdAt?: number;
  canvas_state?: unknown;
  /** True when the full project lives in IndexedDB and this is only a stub. */
  __idb?: boolean;
};

export type ProjectSummary = {
  id: string;
  name: string;
  idea: string;
  platform: "ios" | "android";
  updatedAt: number;
  screenCount: number;
  // Enough to render a live thumbnail without loading the whole project.
  firstScreenHtml: string;
  designSystemCss: string;
  format_config?: Project["format_config"];
};

function isWebsiteProject(p: Project): boolean {
  return (p as Stored)?.format_config?.artifactType === "website";
}

function readMap(): Record<string, Stored> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MAP_KEY);
    if (raw) return JSON.parse(raw) as Record<string, Stored>;
    // First run under the new format: migrate any legacy single project.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const p = JSON.parse(legacy) as Stored;
      if (p?.id) {
        const map = { [p.id]: { ...p, updatedAt: p.updatedAt ?? Date.now() } };
        window.localStorage.setItem(MAP_KEY, JSON.stringify(map));
        if (!window.localStorage.getItem(ACTIVE_KEY)) {
          window.localStorage.setItem(ACTIVE_KEY, p.id);
        }
        return map;
      }
    }
    return {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, Stored>) {
  try {
    window.localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function saveProject(p: Project) {
  if (typeof window === "undefined" || !p?.id) return;
  try {
    const map = readMap();
    const prev = map[p.id];
    const stored: Stored = {
      ...(p as Stored),
      createdAt: prev?.createdAt ?? (p as Stored).createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    if (isWebsiteProject(p)) {
      // Full project (screens, css, canvas_state) → IndexedDB, async.
      void idbPutProject(stored).catch(() => {});
      // Summary stub → localStorage (no heavy payloads).
      map[p.id] = {
        ...stored,
        __idb: true,
        designSystemCss: "",
        screens: stored.screens.map((s) => ({ ...s, html: "" })),
        canvas_state: undefined,
      };
    } else {
      map[p.id] = stored;
    }
    writeMap(map);
    window.localStorage.setItem(ACTIVE_KEY, p.id);
  } catch {
    /* ignore */
  }
}

// The last-opened project (reload continuity). Falls back to the most recently
// updated one if no active id is recorded.
export async function loadProject(): Promise<Project | null> {
  if (typeof window === "undefined") return null;
  try {
    const map = readMap();
    const active = window.localStorage.getItem(ACTIVE_KEY);
    if (active && map[active]) return resolveStored(map[active]);
    const list = Object.values(map).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return list[0] ? resolveStored(list[0]) : null;
  } catch {
    return null;
  }
}

async function resolveStored(stored: Stored): Promise<Project | null> {
  if (!stored.__idb) return stored as Project;
  const full = await idbGetProject<Stored>(stored.id);
  return (full as Project) ?? null;
}

// Open a specific saved project by id (also marks it active).
export async function loadProjectById(id: string): Promise<Project | null> {
  if (typeof window === "undefined") return null;
  try {
    const map = readMap();
    const p = map[id];
    if (!p) return null;
    window.localStorage.setItem(ACTIVE_KEY, id);
    return resolveStored(p);
  } catch {
    return null;
  }
}

// All saved projects as lightweight summaries, newest first.
export function listProjects(): ProjectSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const map = readMap();
    return Object.values(map)
      .filter((p) => p && p.id && Array.isArray(p.screens) && (p.screens[0]?.html || p.__idb))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((p) => ({
        id: p.id,
        name: p.name,
        idea: p.idea,
        platform: p.platform,
        updatedAt: p.updatedAt || 0,
        screenCount: p.screens.length,
        firstScreenHtml: p.screens[0]?.html || "",
        designSystemCss: p.designSystemCss || "",
        format_config: p.format_config,
      }));
  } catch {
    return [];
  }
}

export function deleteProject(id: string) {
  if (typeof window === "undefined") return;
  try {
    const map = readMap();
    const wasIdb = map[id]?.__idb;
    delete map[id];
    writeMap(map);
    if (wasIdb) void idbDeleteProject(id).catch(() => {});
    if (window.localStorage.getItem(ACTIVE_KEY) === id) {
      window.localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function clearProject() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACTIVE_KEY);
  window.localStorage.removeItem(LEGACY_KEY);
}
