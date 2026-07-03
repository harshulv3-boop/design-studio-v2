# Integration Plan — URL → Web Clone into App Design Studio

**Scope:** Integrate the existing `url-to-code` clone engine into `app-design-studio` (sleek.design) so a URL produces two outputs: an interactive **Download Website** ZIP and an **Edit Design** import into the existing canvas editor — with 95–100% visual fidelity and zero regression to existing editor features.

**Decisions already made:** separate engine service + studio proxy · single-page clone v1 · URL entry on Home page · editable version stored in IndexedDB, download version never stored (fetched on demand).

---

## 1. What exists today (verified against both codebases)

### app-design-studio (npm, TanStack Start + Vite, React 19)
- **HTML is the source of truth.** `Project = { id, name, idea, platform, designSystem, designSystemCss, screens[{id, name, role, html}] }` (`src/lib/screen-schema.ts`). Screens render through ONE canonical renderer: `PhoneScreenRenderer.tsx` → sanitized `innerHTML` + `@scope`-wrapped CSS.
- **Website support is already half-built.** This is the key finding:
  - `PhoneScreenRenderer`/`PhoneScreenFrame` accept `isWebsite` + `frameWidth` props (no phone chrome, width = captured viewport, height auto).
  - `Canvas.jsx` reads `project.format_config.artifactType === "website"` and `format_config.frame.width`, has website fit-to-width zoom logic, and already neutralizes `max-width`-only `@media` rules (appends `and (min-width: 9999px)`) so desktop captures don't collapse to mobile layout inside the narrower canvas viewport.
  - `sanitizeHtml` (`lib/pro/htmlUtils.js`) already allows `<style>` tags "to carry captured website CSS into the canvas" (its own comment).
  - **But**: `format_config` is not in the Zod schema, Lite mode / PreviewModal / Home thumbnails never pass `isWebsite`, there is no import pipeline, no clone UI, and no clone endpoint. The half-built path has never been fed real data.
- Editing model is import-friendly: selection/layers/properties all derive live from the DOM (`data-mae-id` attrs via `ensureIds`, tree via `buildTree`, property edits write inline styles, drag uses `transform: translate` which doesn't disturb document flow).
- Persistence: localStorage only (`project-store.ts`), quota failures silently swallowed.
- AI editing: `/api/generate` `refine` mode sends the **entire screen HTML** + design-system CSS to Gemini.

### url-to-code (pnpm monorepo, Express 5 + Playwright)
- `POST /api/clone/start {url}` → jobId · `GET /api/clone/:id/status` (progress 0–100, message) · `GET /api/clone/:id/download` (ZIP). OpenAPI contract in `lib/api-spec/openapi.yaml`, generated React Query hooks + Zod schemas.
- Pipeline (`routes/clone.ts`): SSRF-checked URL → headless Chromium at 1440×900 → route-interception captures every response (CSS/JS/images/fonts) → full-page auto-scroll (triggers lazy load + scroll-reveal) → return to top → `page.content()` → asset URLs rewritten to relative `assets/asset_N.ext` → JSZip → in-memory job with 30-min TTL. `cors()` enabled.
- **Output today is only the interactive ZIP.** There is no editor-ready (JS-free) artifact.

### The integration gap, precisely
| Needed | Exists? |
|---|---|
| Interactive clone ZIP (Download Website) | ✅ engine does this |
| Editable, JS-free, visually identical artifact | ❌ must be added (engine-side, same job) |
| Studio ⇄ engine wiring | ❌ proxy route needed |
| `format_config` in schema + import pipeline | ❌ |
| Clone UI (URL entry, progress, 2-option dialog) | ❌ |
| Website rendering in Pro canvas | ✅ mostly wired |
| Website rendering in Lite / Preview / thumbnails | ❌ props not passed |
| Website-safe AI editing | ❌ full-page HTML too large for model |
| Website-aware export | ❌ hardcodes 375×812 in places |

---

## 2. Architecture

```
Browser ── /api/clone/* ──▶ Studio server (TanStack Start) ── proxy ──▶ Clone engine (Express :8081)
                                                                          │
                                                        one Playwright job, TWO artifacts:
                                                        ① clone.zip        (interactive, existing)
                                                        ② editable.json    (canvas-ready, new)
                                                        ③ reference.png    (full-page screenshot, for fidelity QA)
```

- Engine stays an independent service, started as today (`pnpm --filter @workspace/api-server run dev`, moved to port 8081 in dev). Studio adds `CLONE_ENGINE_URL` env and a thin server proxy at `src/routes/api/clone.$.ts` (start/status/download/editable pass-through). No CORS coupling, engine URL never exposed to the browser, SSRF posture preserved.
- The engine's existing zip pipeline is **not modified** — the editable artifact is an additive step in the same job, after `page.content()`, while the page is still live (this is the only moment the fully-rendered, post-JS DOM and CSSOM are available; post-processing the ZIP later cannot recover matched media queries or JS-written inline styles).

## 3. The editable artifact — the fidelity core

Produced in-page (single `page.evaluate` module) at the end of the existing crawl, when the DOM is in its settled post-JS, post-scroll state (lazy content loaded, scroll-reveal classes applied, JS-written inline styles baked in).

**Serialize the DOM (body content), with these rewrites:**
1. Remove `<script>`, `<noscript>`, `<template>`; keep everything else in place.
2. `<img>`: fix `src` to `currentSrc` (the actually rendered candidate), drop `srcset`/`sizes`/`loading` — the canvas shows exactly what was rendered. All URLs absolutized to the origin.
3. `<iframe>`/`<embed>`/`<object>` (sanitizer will strip them anyway): replace with a same-size placeholder `<div>` at capture time so layout is preserved deliberately, not accidentally.
4. `<form>` → `<div data-orig-tag="form">` (DOMPurify's `FORBID_TAGS` unwraps forms, which would drop any `form`-selector CSS and shift layout; a div with the same class/style is visually identical). Same treatment for any other forbidden-but-layout-relevant tag encountered.
5. Strip `id`/`on*` collisions and add nothing else — `ensureIds` in the studio assigns `data-mae-id` at import.

**Flatten the CSS from the live CSSOM** (not from raw stylesheet text — CSSOM is post-@import, includes captured cross-origin sheets):
1. Walk `document.styleSheets`; for `@media` rules keep contents only if `matchMedia(condition)` matches at the 1440px capture viewport, dropping the rest (this is what guarantees the desktop layout is frozen; the studio's existing max-width neutralizer becomes a second line of defense).
2. Rewrite `html`, `body`, `:root` selectors → `.screen` (the studio's `@scope` adapter only handles `:root` today; doing it at emit time keeps studio code untouched).
3. Drop `@keyframes`, append `*{animation:none!important;transition:none!important}` — the editable version is a still; settled visual state is already baked into the DOM.
4. `@font-face`: keep with absolutized URLs when the captured font response had permissive CORS headers (engine already holds every response); inline as data-URI only when CORS would block cross-origin font loading in the canvas. Images/backgrounds stay absolute URLs — this keeps the payload text-only, comfortably in the 1–2 MB range you targeted.
5. Record `frameWidth: 1440`, full-page height, page title, source URL.

**Contract:** `GET /api/clone/:jobId/editable` → `{ sourceUrl, title, frameWidth, html, css }`. Added to `openapi.yaml` + orval codegen (the repo's own workflow). `reference.png` exposed as `GET /api/clone/:jobId/screenshot` for the QA diff.

## 4. Studio-side changes

**Schema** (`screen-schema.ts`): add optional `format_config: { artifactType: "app" | "website", frame: { width, height? }, sourceUrl? }` to `ProjectSchema` — legalizing the field Canvas already reads. Absent ⇒ `"app"`; every existing project untouched.

**Import** (`lib/import-website.ts`, new): editable payload → `Project` with one screen (`name: page title`, `html: <div class="screen" data-screen-id="home">…</div>` wrapped body, run through `ensureIds`), `designSystemCss: flattened CSS`, `format_config` set. Palette derived from the page's dominant colors is cosmetic-only; ThemePanel's palette editor is hidden for website projects (its `--bg`-style variable rewriting doesn't apply to arbitrary site CSS).

**Storage:** small adapter in `project-store.ts` — website projects (payload > ~200 KB or `artifactType === "website"`) persist to IndexedDB; localStorage keeps a lightweight summary stub so the Home grid lists them; app projects unchanged. Quota errors surface a toast instead of vanishing. Undo history: `MAX_HISTORY` becomes adaptive (60 → ~15 when screen HTML > 500 KB) so 60 full-page snapshots can't balloon memory.

**UI flow (Home page):** the hero prompt box gets a second tab — `Design an app` | `Clone a website`. Clone tab = URL input → start → inline progress (poll status, reuse the engine UI's pattern) → on `done`, a dialog with exactly the two required options:
- **Download Website** → streams `/api/clone/:id/download` (interactive ZIP: JS, animations, navigation intact). Nothing stored.
- **Edit Design** → fetches `/editable`, builds the project, saves, navigates to `/workspace?project=<id>`.
The dialog stays open after Download so the user can also open the editor (options are not mutually exclusive).

**Workspace compatibility pass** — make the half-built website path complete and symmetric:
- `LitePhoneScreen`, `PreviewModal`, and Home `ProjectThumbnail` pass `isWebsite`/`frameWidth` through to `PhoneScreenFrame` (today they hardcode the phone; thumbnails scale by `375` — scale by `frameWidth` instead).
- Pro canvas: already handles fit-to-width and media queries. The custom side scrollbar bases its geometry on `PHONE_FRAME` and its scroll-target heuristic assumes a pinned-bar phone layout; for websites (height:auto, page fully laid out) it naturally stays hidden (`maxScroll = 0`) and users pan/zoom — verify, don't rebuild.
- LayersPanel: tree renders expanded by default; a stripe-sized DOM produces thousands of rows. Website projects start with depth ≥ 2 collapsed. No other change — selection, rename, hide, lock, drag-reorder all operate on `data-mae-id` and work as-is.
- PropertiesPanel, selection, multi-select, drag (`transform: translate`), resize, duplicate, group, undo/redo: no changes expected — all DOM-generic. Verified in test protocol rather than modified.

**AI editing for websites:** `refine` currently ships the whole screen HTML (a full site would blow the context window and cost). Add a `refine-element` mode to `/api/generate`: when `format_config.artifactType === "website"`, Lite's existing element targeting becomes mandatory scope — send only the selected element's `outerHTML` (+ ancestor chain tags for context, capped), splice the returned fragment back by `data-mae-id`. Pro mode's AI entry point gets the same scoping. App projects keep the current full-screen refine untouched.

**Export for websites:** Export dropdown becomes format-aware:
- `Download Website (ZIP)` — re-runs a clone job for the stored `sourceUrl` if the original job expired (30-min TTL), else streams it. On-demand, per your storage decision.
- `Export HTML` — single self-contained file: flattened CSS in `<style>` + edited body (this is the canvas-faithful static export; `Original ≈ Import ≈ Export`).
- `React (TSX)`, `Figma JSON`, `Project JSON` — work as today; `figmaJson` frame dims switch from hardcoded 375×812 to `format_config.frame`.

## 5. What is explicitly NOT touched
Clone engine zip pipeline · `PhoneScreenRenderer` render path · editor store undo/redo semantics · Canvas interaction code (select/drag/resize/guides/zoom/pan) · app-generation prompts and flow · Connect mode (websites: hidden for v1, single screen = nothing to link) · existing UI shell/styling.

## 6. Phases

| Phase | Work | Done when |
|---|---|---|
| **0. Baseline** | Run both apps side by side (engine on 8081); record stripe.com reference: engine screenshot + download ZIP behavior today | Both boot; existing app-generation flow verified green |
| **1. Engine: editable artifact** | In-page serializer + CSS flattener; `/editable` + `/screenshot` endpoints; OpenAPI + codegen | `editable.json` for stripe.com: no scripts, CSS flattened at 1440, payload ≤ ~2 MB, opens standalone in a browser visually matching reference.png |
| **2. Studio: proxy + import** | `/api/clone/*` proxy; schema `format_config`; `import-website.ts`; IndexedDB adapter | Hand-built call chain imports stripe → project persists, reloads |
| **3. Studio: UI flow** | Home clone tab, progress, 2-option dialog; workspace compat pass (Lite/Preview/thumbnails/LayersPanel defaults) | Full user flow works end-to-end from URL to canvas |
| **4. AI edit + export** | `refine-element` mode; format-aware export | AI edit on one stripe element changes only that element; HTML export ≈ canvas |
| **5. Validation** | Full protocol below + regression on app projects | All checks pass |

Each phase lands independently; nothing in 1–2 is user-visible until 3.

## 7. Test protocol — https://stripe.com

**Step 1 — Clone.** Job completes ≤ ~90 s; progress messages stream.
**Step 2 — Download version.** Unzip, open `index.html`: JS executes, hero animation runs, hover states work, nav links function (→ live site, per single-page v1).
**Step 3 — Editor version.**
- *Fidelity:* canvas render vs `reference.png` — pixelmatch/SSIM diff ≥ 95% on the full page; manual spot-checks: fonts (no fallback serif), gradients, shadows, spacing, hero layout, footer columns, images undistorted. None of the failure modes: layout shift, flex/grid collapse, missing fonts/gradients/shadows, lost hierarchy, broken positioning.
- *Editor:* Lite renders (no phone frame, element click-targeting works) · Pro: select / multi-select / drag / resize / duplicate / delete / undo-redo on real stripe nodes · LayersPanel shows Hero/Sections/Footer hierarchy, rename+hide+lock work · PropertiesPanel reads & writes typography/spacing/color/radius/effects on a stripe element · AI edit scoped to selected element only · zoom/pan/fit.
**Step 4 — Export.** HTML export re-opened in a browser ≈ canvas ≈ original (same diff threshold). Regression: generate a fresh app project; verify all modes + export unchanged.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| DOMPurify strips something layout-critical beyond form/iframe | Engine pre-rewrites forbidden tags (§3); fidelity diff in CI catches the rest |
| Hotlinked images blocked later (CORP/hotlink protection, link rot) | Accepted for v1 (canvas is online); flagged: per-image data-URI fallback under a size threshold is the v2 lever |
| Fonts blocked by CORS in canvas | Deterministic rule at capture: permissive CORS → absolute URL, else data-URI |
| `vw`/`vh` units resolve against browser viewport, not the 1440 frame | `@scope` container + `contain: layout paint` + fixed `frameWidth` bounds most cases; flagged for diff review; targeted rewrite (`100vw → 100%`) only if the diff shows it |
| `position: fixed`/`sticky` elements (stripe nav) | `transform: translateZ(0)` on the page container already re-roots fixed descendants into the frame; verify in Step 3 |
| Huge DOM performance (ensureIds, LayersPanel, undo snapshots) | Collapsed-by-default layers; adaptive `MAX_HISTORY`; ensureIds is one pass at import |
| Editable payload > 2 MB on heavy sites | CSS flattening drops non-matching media blocks (typically the bulk); IndexedDB has headroom regardless |
| Engine job TTL (30 min) vs later re-download | Export re-triggers a clone for `sourceUrl` on demand (your on-demand decision) |
| localStorage summary stub drift vs IndexedDB payload | Single write path in the adapter; stub carries only list-view fields |

## 9. Open items (non-blocking, flag before Phase 3)
1. Website project thumbnails on Home: live scaled render of a 1440×~8000 page is heavy — proposal: thumbnail from the top 900 px only.
2. Lite mode for a single-screen website is a one-card grid — acceptable, or hide Lite for websites and land directly in Pro? Proposal: keep Lite (it's the AI element-targeting surface).
3. Clone jobs are fire-and-forget in-memory; if the user closes the tab mid-clone the job orphans until TTL. Acceptable for v1.

---
*Sources: all claims verified directly against `app-design-studio` (PRD_REPORT.md; screen-schema.ts; htmlUtils.js; PhoneScreenRenderer/Frame.tsx; editorStore.js; Canvas.jsx; LayersPanel.jsx; PropertiesPanel.jsx; workspace.tsx; index.tsx; project-store.ts; api/generate.ts) and `url-to-code` (replit.md; routes/clone.ts; app.ts; openapi.yaml; site-cloner/pages/home.tsx; package.json files) at current HEAD.*
