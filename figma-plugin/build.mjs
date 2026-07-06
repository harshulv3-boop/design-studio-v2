// @ts-check
/**
 * Bundles the Figma plugin for distribution.
 *
 * Figma loads exactly one JS file as `main` (manifest.json) and one HTML file
 * as `ui`. esbuild bundles src/code.ts → dist/code.js (inlining the @figma
 * typings-only imports), then src/ui.html is copied verbatim to dist/ui.html.
 *
 *   node build.mjs          one-shot build
 *   node build.mjs --watch  rebuild on change
 *
 * The plugin has NO runtime dependencies — code.ts only uses the `figma`
 * global injected by the host and the postMessage bridge to ui.html. That's
 * why the bundle is tiny and why we don't need a package-lock install step
 * beyond the dev tooling.
 */
import { build, context } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)));
const srcDir = resolve(root, "src");
const distDir = resolve(root, "dist");
const isWatch = process.argv.includes("--watch");

const entryPoints = [resolve(srcDir, "code.ts")];
const codeOut = resolve(distDir, "code.js");
const uiSrc = resolve(srcDir, "ui.html");
const uiOut = resolve(distDir, "ui.html");

async function copyUi() {
  await mkdir(distDir, { recursive: true });
  await copyFile(uiSrc, uiOut);
}

// Clean dist on every build so stale assets never ship.
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints,
  outfile: codeOut,
  bundle: true,
  // Figma's plugin sandbox is not a browser globalThis and not Node — target
  // es2017 matches the host's supported syntax (and keeps the bundle small).
  target: "es2017",
  platform: "browser",
  format: "iife",
  // code.ts only references the `figma` global + __html__ at runtime; both are
  // injected by the host, so mark them external rather than polyfilled.
  external: ["figma", "__html__"],
  logLevel: "info",
  // Keep readable for Figma plugin review submissions.
  minify: false,
  sourcemap: false,
};

if (isWatch) {
  // esbuild watches code.ts; ui.html is a static copy watched via fs.
  const ctx = await context(options);
  await ctx.watch();
  await copyUi();
  console.log("[ui] copied ui.html");
  watch(srcDir, (event, filename) => {
    if (filename === "ui.html") {
      copyUi().then(() => console.log("[ui] recopied ui.html"));
    }
  });
  console.log("[watch] ready — editing src/ will rebuild dist/");
} else {
  const result = await build(options);
  await copyUi();
  console.log("[ui] copied ui.html");
  if (result.errors.length) process.exitCode = 1;
}
