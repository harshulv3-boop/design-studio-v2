import type { Project } from "@/lib/screen-schema";

export const ROUNDTRIP_MANIFEST_PATH = "sleek-design/manifest.json";
export const ROUNDTRIP_MANIFEST_VERSION = 1;

export type RoundtripManifest = {
  schema: "sleek.design.export";
  version: typeof ROUNDTRIP_MANIFEST_VERSION;
  framework: "vue" | "angular" | "react" | "html";
  exportedAt: string;
  project: Project;
};

export function createRoundtripManifest(project: Project, framework: RoundtripManifest["framework"]): RoundtripManifest {
  return {
    schema: "sleek.design.export",
    version: ROUNDTRIP_MANIFEST_VERSION,
    framework,
    exportedAt: new Date().toISOString(),
    project,
  };
}

export function parseRoundtripManifest(raw: string): RoundtripManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The sleek.design manifest is not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The sleek.design manifest is empty or malformed.");
  }

  const manifest = parsed as Partial<RoundtripManifest>;
  if (manifest.schema !== "sleek.design.export") {
    throw new Error("The ZIP does not contain a recognized sleek.design export manifest.");
  }
  if (manifest.version !== ROUNDTRIP_MANIFEST_VERSION) {
    throw new Error(`Unsupported sleek.design export manifest version: ${String(manifest.version)}.`);
  }
  if (!manifest.project || typeof manifest.project !== "object") {
    throw new Error("The sleek.design manifest does not contain a project.");
  }

  return manifest as RoundtripManifest;
}

export function cloneRoundtripProject(project: Project): Project {
  return {
    ...project,
    id: crypto.randomUUID(),
    name: `${project.name || "Imported project"} (Imported)`,
  };
}
