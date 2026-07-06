import type { Project } from "@/lib/screen-schema";
import type { IRDocument, Resolved } from "../schema";
import { isElement, type IRChild } from "../schema";
import { buildScreenDocument } from "./render-doc";

/**
 * Resolve-pass client: for each screen, compose the exact canvas document and
 * ask the clone engine (Playwright, via the /api/clone proxy) for per-node
 * geometry + computed styles, then graft the results onto the IR as
 * `node.resolved`. Design targets (Figma/Flutter) require this; code targets
 * never call it.
 */

export type ResolveNodeData = Resolved & { imageNatural?: { w: number; h: number } };

export type ScreenResolveData = {
  pageHeight: number;
  nodes: Record<string, ResolveNodeData>;
  warnings: string[];
};

export class ResolveUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `The resolve service (clone engine, port 8081) is required for this export but unreachable: ${detail}. ` +
        `Start it with: cd url-to-code/artifacts/api-server && PORT=8081 node dist/index.mjs`,
    );
  }
}

async function resolveScreenDocument(
  documentHtml: string,
  viewport: { width: number; height: number },
  fetchImpl: typeof fetch,
  endpoint: string,
): Promise<ScreenResolveData> {
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentHtml, viewport }),
    });
  } catch (e) {
    throw new ResolveUnavailableError(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ResolveUnavailableError(data?.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as ScreenResolveData;
}

export type ResolveOptions = {
  /** Defaults to the studio proxy; tests/scripts may point at the engine directly. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

/** Mutates the IR in place (it is a boundary-local value), attaching
 * `resolved` to every element the engine measured. Returns warnings. */
export async function attachResolvedData(
  ir: IRDocument,
  project: Project,
  opts: ResolveOptions = {},
): Promise<string[]> {
  const endpoint = opts.endpoint ?? "/api/clone/resolve";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const isWebsite = ir.meta.artifactType === "website";
  const warnings: string[] = [];

  for (let i = 0; i < ir.screens.length; i++) {
    const screen = ir.screens[i];
    const documentHtml = buildScreenDocument({
      screenHtml: project.screens[i]?.html ?? "",
      designSystemCss: project.designSystemCss,
      frameWidth: ir.meta.frame.w,
      frameHeight: ir.meta.frame.h,
      isWebsite,
    });
    const data = await resolveScreenDocument(
      documentHtml,
      { width: ir.meta.frame.w, height: ir.meta.frame.h ?? 900 },
      fetchImpl,
      endpoint,
    );
    warnings.push(...data.warnings.map((w) => `[${screen.name}] ${w}`));

    const graft = (children: IRChild[]): void => {
      for (const child of children) {
        if (!isElement(child)) continue;
        const resolved = data.nodes[child.id];
        if (resolved) child.resolved = resolved;
        else warnings.push(`[${screen.name}] No resolved data for node ${child.id} (${child.tag}).`);
        graft(child.children);
      }
    };
    graft(screen.nodes);
  }
  return warnings;
}
