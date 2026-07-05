import { ROUNDTRIP_MANIFEST_PATH, cloneRoundtripProject, parseRoundtripManifest } from "@/lib/roundtrip-manifest";
import type { LanguageId } from "@/lib/import-code";
import type { Project } from "@/lib/screen-schema";

export type ProjectArchiveImport = {
  code: string;
  language: LanguageId;
  filename: string;
  project?: Project;
  warnings: string[];
};

type ZipFile = {
  name: string;
  dir: boolean;
  async(type: "string"): Promise<string>;
};

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i + 1);
}

function escapeTemplateLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function findFile(files: ZipFile[], predicate: (name: string) => boolean): ZipFile | undefined {
  return files.find((file) => !file.dir && !/\/node_modules\//.test(`/${normalize(file.name)}`) && predicate(normalize(file.name)));
}

function resolveSibling(files: ZipFile[], from: string, ref: string): ZipFile | undefined {
  const wanted = normalize(`${dirname(from)}${ref}`);
  return findFile(files, (name) => name === wanted);
}

async function inlineAngularCompanionFiles(component: ZipFile, files: ZipFile[]): Promise<string> {
  const componentPath = normalize(component.name);
  let code = await component.async("string");

  const templateUrl = code.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/);
  if (templateUrl) {
    const template = await resolveSibling(files, componentPath, templateUrl[1])?.async("string");
    if (template) {
      code = code.replace(templateUrl[0], `template: \`${escapeTemplateLiteral(template)}\``);
    }
  }

  const styleUrl = code.match(/styleUrl\s*:\s*['"]([^'"]+)['"]/);
  if (styleUrl) {
    const css = await resolveSibling(files, componentPath, styleUrl[1])?.async("string");
    if (css) {
      code = code.replace(styleUrl[0], `styles: [\`${escapeTemplateLiteral(css)}\`]`);
    }
  }

  const styleUrls = code.match(/styleUrls\s*:\s*\[([\s\S]*?)\]/);
  if (styleUrls) {
    const refs = [...styleUrls[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const cssParts = await Promise.all(refs.map((ref) => resolveSibling(files, componentPath, ref)?.async("string")));
    const css = cssParts.filter(Boolean).join("\n");
    if (css) {
      code = code.replace(styleUrls[0], `styles: [\`${escapeTemplateLiteral(css)}\`]`);
    }
  }

  return code;
}

export async function readProjectArchive(file: File): Promise<ProjectArchiveImport> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const files = Object.values(zip.files) as ZipFile[];

  const manifestFile = findFile(files, (name) => name === ROUNDTRIP_MANIFEST_PATH || name.endsWith(`/${ROUNDTRIP_MANIFEST_PATH}`));
  if (manifestFile) {
    const manifest = parseRoundtripManifest(await manifestFile.async("string"));
    return {
      code: `Imported from ${ROUNDTRIP_MANIFEST_PATH}`,
      language: "html",
      filename: file.name,
      project: cloneRoundtripProject(manifest.project),
      warnings: [`Restored original sleek.design canvas metadata from ${manifest.framework} export.`],
    };
  }

  const vueFile =
    findFile(files, (name) => name.endsWith("src/App.vue")) ??
    findFile(files, (name) => name.endsWith(".vue"));
  if (vueFile) {
    return {
      code: await vueFile.async("string"),
      language: "vue",
      filename: normalize(vueFile.name),
      warnings: ["Imported Vue project ZIP by selecting its primary .vue component."],
    };
  }

  const angularComponent =
    findFile(files, (name) => name.endsWith("src/app/app.component.ts")) ??
    findFile(files, (name) => name.endsWith(".component.ts"));
  if (angularComponent) {
    return {
      code: await inlineAngularCompanionFiles(angularComponent, files),
      language: "angular",
      filename: normalize(angularComponent.name),
      warnings: ["Imported Angular project ZIP by inlining companion template/style files into its primary component."],
    };
  }

  throw new Error("No supported Vue or Angular entry file found in this ZIP.");
}
