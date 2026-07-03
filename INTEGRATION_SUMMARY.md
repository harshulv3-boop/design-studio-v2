# Integration Summary — what changed

Implementation of INTEGRATION_PLAN.md. Both apps compile clean (engine: `tsc` + `esbuild` build pass; studio: full `vite build` pass) and boot; the studio↔engine proxy chain, SSRF/path-traversal guards, and the CSS-flatten/URL/minify logic are unit-verified. The one step that must run on your machine is the actual Playwright clone (Chromium can't run in the build sandbox) — see RUN_LOCAL.md.

## Clone engine (`url-to-code`) — additive only, ZIP path untouched

**New — `artifacts/api-server/src/lib/editable-capture.ts`**
The fidelity core. An in-page script (runs in the live Playwright page after JS + auto-scroll) that builds the JS-free editable artifact: deep-clones `<body>`, bakes per-instance state (`img.currentSrc`, canvas→img snapshot, `iframe`/`form`→`div`, input values), and flattens CSS from the page's own CSSOM — keeping only `@media` blocks that match the 1440px capture viewport, **tree-shaking** style rules to those whose selector matches the DOM (the main size lever; marketing pages ship mostly-dead CSS), dropping `@keyframes`, freezing motion, and rewriting `html`/`body`/`:root` → `.screen`. Plus Node-side helpers (`absolutizeCssUrls`, `inlineCssImports`, `minifyCss`).

**Changed — `artifacts/api-server/src/routes/clone.ts`**
After the existing `page.content()`, an additive block captures a full-page **reference screenshot** and the **editable artifact** (fonts kept as absolute URLs when CORS is permissive, else inlined as data-URIs ≤300 KB). Wrapped in try/catch so it can never fail the classic ZIP job. New endpoints: `GET /clone/:id/editable`, `GET /clone/:id/screenshot`; `status` now also returns `editableReady` + `editableSize`. Added a dev-only `CLONE_ALLOW_LOCAL` escape hatch for offline benchmarking (never set in prod).

**Changed — `lib/api-spec/openapi.yaml`** — documented the two new endpoints + `EditableArtifact` schema.

## App Design Studio (`app-design-studio`)

**New files**
- `src/routes/api/clone.$.ts` — server proxy to the engine (`CLONE_ENGINE_URL`, default `:8081`); keeps the engine URL server-side, allowlists the 5 clone routes, blocks path traversal.
- `src/components/CloneWebsite.tsx` — the "Clone a website" UI: URL input → progress polling → the two-option result (**Download Website** / **Edit Design**).
- `src/lib/import-website.ts` — turns an editable artifact into a studio `Project` (one screen for v1; shape is multi-page-ready).
- `src/lib/website-store.ts` — IndexedDB adapter (website payloads are too big for localStorage).

**Changed files**
- `src/lib/screen-schema.ts` — added optional `format_config` (`artifactType`, `frame`, `source`, `pages[]`); raised the screens cap 8→24 for future multi-page. Absent ⇒ `"app"`; every existing project is untouched.
- `src/lib/project-store.ts` — website projects persist to IndexedDB with a localStorage summary stub (so the home grid lists them); app projects unchanged. `loadProject`/`loadProjectById` are now async.
- `src/routes/index.tsx` — home page gets **Design an app | Clone a website** tabs; website-aware project thumbnails + "Web" badge.
- `src/routes/workspace.tsx` — async project load; website-aware Lite / Preview / thumbnails (`isWebsite`/`frameWidth` pass-through, already supported by the renderer); **element-scoped AI edits** for websites (Connect mode + palette editor + share are hidden/guarded, since they don't apply to arbitrary sites); export dropdown gains **Download Website (re-clone on demand)** and website-correct Figma frame dims.
- `src/routes/api/generate.ts` — new `refine-element` mode: AI edits one selected element's HTML (the full page is too large for a model call), spliced back by `data-mae-id`.
- `src/store/editorStore.js` — undo history depth auto-caps for very large (website) documents so 60 full-page snapshots can't balloon memory.
- `src/components/editor/LayersPanel.jsx` — website layer trees start collapsed to top-level sections (a cloned page has thousands of nodes).

## Deliberately NOT touched
The engine's ZIP pipeline · `PhoneScreenRenderer` render path · Canvas interaction code (select/drag/resize/guides/zoom/pan) · undo/redo semantics · app-generation prompts/flow · existing UI shell.

## Known limitation in this environment
The build sandbox has no Chromium and no network to download it, so the end-to-end Playwright clone of a live site (and thus the on-screen 95% fidelity check) is the step to run on your machine — which is also where your browser is. Everything up to that point is verified. RUN_LOCAL.md has the exact commands and a browser checklist.
