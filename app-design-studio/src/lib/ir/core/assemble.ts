import { ensureIds, sanitizeHtml } from "@/lib/pro/htmlUtils";
import type { Project } from "@/lib/screen-schema";

/**
 * Assemble a full canvas Project from converter output (screens + design
 * CSS). The single place import converters turn parsed screens into the
 * canonical Project shape: every screen passes the sanitize + ensureIds choke
 * point, CSS is stored verbatim, and schema-required cosmetics get defaults.
 */

export type AssembleOptions = {
  name: string;
  idea?: string;
  screens: { id: string; name: string; role: string; html: string }[];
  designSystemCss: string;
  artifactType?: "app" | "website" | "figma";
  frame?: { w: number; h?: number };
};

export function assembleImportedProject(opts: AssembleOptions): Project {
  const artifactType = opts.artifactType ?? "app";
  return {
    id: crypto.randomUUID(),
    name: opts.name || "Imported project",
    idea: opts.idea ?? `Imported: ${opts.name || "Untitled"}`,
    platform: "ios",
    designSystem: {
      palette: {
        background: "#f4f5f7",
        surface: "#ffffff",
        text: "#111827",
        muted: "#6b7280",
        accent: "#6366f1",
        accentText: "#ffffff",
      },
      radius: "lg",
      font: "Inter",
    },
    designSystemCss: opts.designSystemCss,
    screens: opts.screens.map((screen) => ({
      ...screen,
      html: ensureIds(sanitizeHtml(screen.html)),
    })),
    format_config: {
      artifactType,
      frame: {
        width: opts.frame?.w ?? (artifactType === "website" ? 1440 : artifactType === "figma" ? 1200 : 375),
        height: opts.frame?.h,
      },
    },
  };
}
