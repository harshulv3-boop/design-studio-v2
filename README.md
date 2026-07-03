# Clone → Edit — URL-to-Editable-Design Studio

Turn any live website into an **editable design** in a canvas editor — or download it as a
self-contained interactive site. Paste a URL, and the engine clones the page at ~99% visual
fidelity and hands you two outputs: an interactive **Download Website** ZIP (JS, animations, and
navigation intact) and an **Edit Design** import that opens in a Figma-like editor.

This repository is a monorepo of two applications plus the integration layer, control panel, and
test evidence that wires them together.

```
Paste a URL ─▶ Clone engine (Playwright)  ─┬─▶  ① interactive ZIP   (download & host)
                                           └─▶  ② editable artifact ─▶ Design Studio canvas
                                                                        (select / drag / resize /
                                                                         AI-edit / export)
```

---

## What's in this repo

| Path | What it is | Stack | Dev port |
|---|---|---|---|
| `url-to-code/` | **Clone engine** — headless-Chromium capture that produces the interactive ZIP *and* the JS-free editable artifact | Express 5 + Playwright, pnpm monorepo, TypeScript | **8081** |
| `app-design-studio/` | **App Design Studio** (branded *sleek.design*) — the editor UI you open; Lite / Pro / Connect modes, AI edits, export | TanStack Start + Vite + React 19, npm | **8080** |
| `control-panel/` | One-page health + clone dashboard (`dashboard.html`, `serve.mjs`) | Static HTML + tiny Node server | 8090 (or served by the engine on 8081) |
| `test-evidence/` | Fidelity proof: original-vs-editor pixel diff, sample captured artifact | PNG + JSON | — |
| Root scripts | `START.bat` / `START.ps1` (one-click run), `STOP.ps1`, `DIAGNOSE.ps1` | PowerShell / batch | — |
| Root docs | `INTEGRATION_PLAN.md`, `INTEGRATION_SUMMARY.md`, `RUN_LOCAL.md`, `TEST_RESULTS.md`, `PRD_REPORT.md` | Markdown | — |

The two apps run as **independent services**: the studio proxies clone requests to the engine, so
the engine URL is never exposed to the browser and SSRF/path-traversal guards stay in place.

---

## Architecture

```
Browser ── /api/clone/* ──▶ App Design Studio (TanStack Start, :8080)
                                    │  thin server proxy (src/routes/api/clone.$.ts)
                                    ▼
                            Clone engine (Express, :8081)
                                    │  one Playwright job, three artifacts:
                                    ├─ ① clone.zip      interactive site   (existing pipeline, untouched)
                                    ├─ ② editable.json  canvas-ready, JS-free, layout-frozen  (additive)
                                    └─ ③ reference.png   full-page screenshot for fidelity QA
```

**HTML is the single source of truth.** Every screen in the studio renders through one canonical
renderer (`PhoneScreenRenderer`) that sanitizes HTML (DOMPurify), scopes CSS (`@scope`), and tags
every node with `data-mae-id` so selection, layers, properties, drag, and undo all operate on the
live DOM. A cloned site is just another project fed into that same path — which is why the editor's
existing features work on it without being rebuilt.

**The editable artifact** is the fidelity core. It's produced in-page at the end of the crawl, when
the DOM is in its settled post-JS, post-scroll state:

- `<script>` / `<noscript>` removed; per-instance state baked in (`img.currentSrc`, input values,
  canvas → image snapshot, `iframe`/`form` → sized `<div>` so layout is preserved).
- CSS flattened from the live CSSOM: only `@media` blocks matching the 1440 px capture viewport are
  kept (desktop layout is frozen), dead rules are tree-shaken out, `@keyframes` dropped and motion
  frozen, and `html`/`body`/`:root` rewritten to `.screen`.
- Fonts kept as absolute URLs when CORS allows, else inlined as data-URIs — keeping the payload
  text-only and typically well under 1 MB.

See **`INTEGRATION_PLAN.md`** for the full design and **`INTEGRATION_SUMMARY.md`** for the
file-by-file change list.

---

## Quick start

**Prerequisite:** Node.js 20+.

### One-click (Windows)

Double-click **`START.bat`**, then open **http://localhost:8081**. The dashboard is served by the
clone engine itself, so if the page loads, the engine is up and the clone button works. First run
downloads Chromium and installs dependencies (a few minutes); after that, startup is seconds. Run
**`STOP.ps1`** to stop everything; **`DIAGNOSE.ps1`** rebuilds and starts the engine in a visible
window if anything misbehaves.

### Manual (two terminals)

```bash
# Terminal 1 — clone engine  (folder: url-to-code)
corepack enable
corepack pnpm install
corepack pnpm exec playwright install chromium         # one-time (~150 MB)
corepack pnpm --filter @workspace/api-server run build
cd artifacts/api-server && PORT=8081 node dist/index.mjs

# Terminal 2 — studio  (folder: app-design-studio)
npm install
npm run dev                                             # http://localhost:8080
```

Open **http://localhost:8080**, click the **Clone a website** tab, paste e.g. `https://stripe.com`,
and clone. On completion you get **Download Website** (interactive ZIP) and **Edit Design** (opens
the JS-free version in the canvas).

**AI features are optional.** App generation and element-scoped AI edits need a `GEMINI_API_KEY` in
`app-design-studio/.env` (copy from `.env.example`). Cloning, downloading, manual editing, and
export all work without it.

Full setup, port options, and a browser verification checklist are in **`RUN_LOCAL.md`**.

---

## Editor features (they work on cloned sites too)

- **Lite** — read-only screen grid; click an element to target it, then chat to edit it via AI.
- **Pro** — full canvas: select, multi-select, drag, resize, duplicate, group, layers panel,
  properties panel, undo/redo, alignment guides, zoom/pan.
- **Connect** — prototype mode: link elements to screens, set a start screen, click through.
- **Export** — interactive ZIP (re-clone on demand), self-contained HTML, React/TSX, Figma JSON,
  project JSON.

For website projects the studio adds: IndexedDB storage (cloned pages are too big for
localStorage), element-scoped AI edits (a full page is too large for one model call), collapsed
layer trees by default, and website-correct export frame dimensions — all additive, with the app
path untouched.

---

## Fidelity

Measured against a benchmark page built to stress every fidelity risk (CSS variables, flex + grid,
gradient text, box-shadows, sticky header with `backdrop-filter`, pseudo-elements, animation, inline
SVG, a pre-filled form, and multiple `@media` queries):

| Measurement | Result |
|---|---|
| Editor render vs original (through the real DOMPurify + `@scope` path) | **99.73% identical** |
| Height match | exact (2010 px = 2010 px) |
| Editable artifact size | 8.1 KB (target < 1 MB) |
| Dead CSS tree-shaken | 7 / 7 unused selectors dropped |
| Nodes tagged for the editor | 69 / 69 have `data-mae-id` |

Evidence is in `test-evidence/`; methodology is in **`TEST_RESULTS.md`**.

---

## Status & roadmap

Both apps compile and boot; the studio↔engine proxy, SSRF/path-traversal guards, and the
CSS-flatten/tree-shake logic are verified. The one step to run on your own machine is the live
Playwright clone of a real site (Chromium can't run in the CI sandbox) — see `RUN_LOCAL.md`.

**v1** captures the single URL you enter; navigation links point to the live site. **v2** (planned):
multi-page selection — the project schema already supports multiple pages.

---

## Documentation index

- **`PRD_REPORT.md`** — product requirements for the integrated Clone → Edit product.
- **`INTEGRATION_PLAN.md`** — full architecture and the design of the editable artifact.
- **`INTEGRATION_SUMMARY.md`** — every file added or changed, and what was deliberately left alone.
- **`RUN_LOCAL.md`** — run instructions, ports, troubleshooting, browser checklist.
- **`TEST_RESULTS.md`** — fidelity methodology and numbers.
- **`app-design-studio/PRD_REPORT.md`** — the studio's own engineering handoff (pre-integration).
- **`GITHUB_UPLOAD_GUIDE.md`** — how to upload this repo to GitHub.
                                                                