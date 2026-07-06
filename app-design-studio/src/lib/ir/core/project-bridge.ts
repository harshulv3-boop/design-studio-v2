import type { Project, Screen } from "@/lib/screen-schema";
import type { IRDocument, IRScreen } from "../schema";
import { IR_VERSION } from "../schema";
import { htmlToIrChildren } from "./html-to-ir";
import { irChildrenToHtml } from "./ir-to-html";
import { parseStylesheet } from "./stylesheet";

/**
 * Project ↔ IRDocument. The ONLY place canvas state meets the IR — called at
 * export time (project → IR, IR discarded after files are generated) and
 * import time (IR → project fields, IR discarded after the project is built).
 */

export async function projectToIr(
  project: Project,
  sourceFormat: IRDocument["meta"]["sourceFormat"] = "canvas",
): Promise<IRDocument> {
  const fc = project.format_config;
  const artifactType = fc?.artifactType ?? "app";
  const screens: IRScreen[] = await Promise.all(
    project.screens.map(async (screen) => ({
      id: screen.id,
      name: screen.name,
      role: screen.role,
      nodes: await htmlToIrChildren(screen.html),
    })),
  );
  return {
    version: IR_VERSION,
    meta: {
      name: project.name,
      sourceFormat,
      artifactType,
      frame: {
        w: fc?.frame?.width ?? (artifactType === "website" ? 1440 : artifactType === "figma" ? 1200 : 375),
        h: fc?.frame?.height,
      },
    },
    screens,
    stylesheet: await parseStylesheet(project.designSystemCss),
    assets: [],
  };
}

export type IrProjectFields = {
  name: string;
  screens: Screen[];
  designSystemCss: string;
  format_config: NonNullable<Project["format_config"]>;
};

/** IR → the project fields a converter produces; callers merge these into a
 * full Project via their existing assembly path (buildWebsiteProject-style). */
export async function irToProjectFields(ir: IRDocument): Promise<IrProjectFields> {
  const screens: Screen[] = await Promise.all(
    ir.screens.map(async (screen) => ({
      id: screen.id,
      name: screen.name,
      role: screen.role,
      html: await irChildrenToHtml(screen.nodes),
    })),
  );
  return {
    name: ir.meta.name,
    screens,
    designSystemCss: ir.stylesheet.raw,
    format_config: {
      artifactType: ir.meta.artifactType,
      frame: { width: ir.meta.frame.w, height: ir.meta.frame.h },
    },
  };
}
