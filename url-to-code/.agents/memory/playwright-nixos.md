---
name: Playwright on Replit NixOS
description: System lib requirements for Chromium headless + JSZip as the correct zip library in ESM bundles
---

## Playwright Chromium system libraries

After `npx playwright install chromium`, Chromium headless shell still needs these NixOS packages installed via `installSystemDependencies`:

```
glib, nss, nspr, atk, cups, dbus, expat, libdrm, libxkbcommon,
xorg.libX11, xorg.libXcomposite, xorg.libXdamage, xorg.libXext,
xorg.libXfixes, xorg.libXrandr, mesa, alsa-lib, pango, cairo,
at-spi2-atk, at-spi2-core, libgbm, wayland, xorg.libxcb,
xorg.libXcursor, xorg.libXi, xorg.libXtst, xorg.libXScrnSaver,
gtk3, gdk-pixbuf, fontconfig, freetype, harfbuzz, zlib
```

**Why:** Replit NixOS doesn't include these by default. The error shows as `error while loading shared libraries: libglib-2.0.so.0` (or libgbm, etc.). Each missing lib shows one at a time.

**How to apply:** Any project using Playwright/Puppeteer for headless browser work on Replit must call `installSystemDependencies` with this list before the browser can launch.

## JSZip instead of archiver in ESM bundles

**Rule:** Never use `archiver` (CJS) in esbuild ESM output — not even with `createRequire`. Use `jszip` instead.

**Why:** `archiver` is a CJS package that exports a function via `module.exports`. Even when externalized in esbuild and loaded via `createRequire(import.meta.url)`, at runtime it resolves as `undefined` or non-function in some configurations. `jszip` is pure ESM-compatible JavaScript, bundles cleanly, and has no native dependencies.

**How to apply:**
```ts
import JSZip from "jszip";
const zip = new JSZip();
zip.file("index.html", htmlContent);
const folder = zip.folder("assets")!;
folder.file("asset_0.css", cssBuffer);
const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(zipPath, buffer);
```

## page.evaluate() DOM types in server TS

`page.evaluate(async () => { document... window... })` causes TS2584/TS2304 in server tsconfig (no `dom` lib). Use string form:

```ts
await page.evaluate(`
  new Promise((resolve) => {
    // browser globals like document, window work here
    resolve();
  })
`);
```
