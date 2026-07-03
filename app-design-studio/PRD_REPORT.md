# App Design Studio (sleek.design) — Product & Engineering Handoff

> Onboarding doc for an engineer/agent with **zero prior context**. Read top to bottom.

---

## 1. What this is

**App Design Studio** is an AI-powered tool that turns a text idea (e.g. "a dog-care app")
into a set of **high-fidelity mobile app screens** you can preview, edit, prototype, and export.
Think "Lovable / v0, but specialized for native-feeling mobile UI mockups."

- You describe an app → AI generates a **shared design system** + **4–5 connected screens**.
- You refine by chatting ("make the accent teal", "add a stats row to Home") or by **direct editing** on a Figma-like canvas.
- You export to React/TSX, raw HTML, Figma-ready JSON, or an AI build prompt.

The product is branded **sleek.design** in the UI.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | **TanStack Start** (SSR) + **TanStack Router** (file-based routes) |
| Build/dev | **Vite** (`@lovable.dev/vite-tanstack-config`) |
| UI | React 18, Tailwind, Radix UI primitives, lucide-react icons, sonner toasts |
| Canvas state | **Zustand** (`src/store/editorStore.js`) |
| AI | Vercel **AI SDK** (`generateText`) → Google Gemini (direct) or Lovable AI gateway |
| Persistence | **Browser localStorage** (no backend DB yet) |
| Validation | Zod (`src/lib/screen-schema.ts`) |
| Sanitization | DOMPurify (all AI/edited HTML is sanitized before render) |

Node: use v20 (`.nvm`). Dev server: `npm run dev` (picks first free port from 8080).

### Environment
- Copy `.env.example` → `.env`, set `GEMINI_API_KEY` (or `LOVABLE_API_KEY`).
- `.env` is **gitignored** — never commit real keys.
- The generate route: `src/routes/api/generate.ts`.

---

## 3. Core architecture (the one thing to understand)

**HTML is the single source of truth for every screen.** The AI generates:
1. **Phase 1** — a shared *design system*: a JSON object with palette, radius, font, and a
   `designSystemCss` string (CSS variables + shared component classes like `.screen`,
   `.nav-bar`, `.screen__body`, `.tab-bar`, `.card`).
2. **Phase 2** — for each screen, a **self-contained HTML fragment** whose root is
   `<div class="screen" data-screen-id="…">`, styled entirely by the shared CSS.

Both edit modes read the **same** HTML + the **same** `project.designSystemCss` live — there is
no cached/divergent copy. This is the key invariant: *change the design system once, every
screen reflects it.*

### The three edit modes
- **Lite** — read-only screen grid; click an element to target it, then chat to edit it via AI.
- **Pro** — full Figma-like canvas: select/drag/resize/group, layers panel, properties panel,
  undo/redo, alignment guides, zoom/pan. This is `src/components/editor/Canvas.jsx` (the biggest, most complex file).
- **Connect** — prototype mode: link elements to screens, set a start screen, click-through preview.

### The rendering pipeline (shared by all modes)
`PhoneScreenRenderer.tsx` is the ONE canonical renderer. It owns the fixed **375×812** phone
frame, notch/chrome, CSS **`@scope`**-ing (so a screen's CSS can't leak out), and sets the
sanitized HTML via `innerHTML`. `PhoneScreenFrame.tsx` is the single wrapper both Lite and Pro
place it in — keeping it identical is what guarantees Lite and Pro render pixel-identically.

---

## 4. Repo map (where things live)

```
src/
  routes/
    index.tsx           # Landing/Home: idea prompt, templates, Saved Projects, pricing
    workspace.tsx       # THE app shell: modes, chat, theme panel, autosave, save indicator
    api/generate.ts     # Two-phase AI generation + refine endpoint (server route)
  components/
    PhoneScreenRenderer.tsx   # canonical phone renderer (frame, @scope CSS, innerHTML)
    PhoneScreenFrame.tsx      # shared wrapper (Lite selectable / Pro overlay)
    editor/
      Canvas.jsx        # Pro canvas: select/drag/resize/guides/zoom/pan/SCROLL  (largest file)
      PropertiesPanel.jsx, LayersPanel.jsx, ColorPicker.jsx, EffectsPanel.jsx, Toolbar.jsx …
    flow/               # Connect-mode prototype canvas + panel
  store/editorStore.js  # Zustand: html, htmlVersion, undo/redo history, selection, zoom/pan,
                        #          colorStyles, page bg, ops registry, saveStatus
  lib/
    project-store.ts    # localStorage multi-project persistence (see §6)
    screen-schema.ts    # Zod Project/Screen/DesignSystem schemas
    pro/                # htmlUtils (ensureIds, sanitize), prototype, colorUtils
```

---

## 5. Data model (`Project`)

```ts
Project = {
  id, name, idea, platform: "ios"|"android",
  designSystem: { palette:{background,surface,text,muted,accent,accentText}, radius, font },
  designSystemCss: string,                 // the shared CSS (source of truth for theming)
  screens: [{ id, name, role, html }],     // html is the source of truth per screen
}
```
Palette key → CSS variable: `background→--bg, surface→--surface, text→--text, muted→--muted,
accent→--accent, accentText→--accent-text`. Editing a palette swatch rewrites the variable in
`designSystemCss` live (zero AI calls) and reflects on all screens.

Stored projects also carry `updatedAt` and `canvas_state` (editor zoom/pan/layer names/etc.).

---

## 6. Persistence & Saved Projects (localStorage)

`src/lib/project-store.ts` — multi-project store:
- `nova-projects` — map of `{ [id]: Project + updatedAt + canvas_state }`.
- `nova-active-id` — last opened project (drives reload continuity).
- `nova-project` — legacy single-project key; **migrated once** into the map.

API: `saveProject`, `loadProject` (active), `loadProjectById`, `listProjects` (summaries,
newest-first), `deleteProject`, `clearProject`.

**Home page** (`index.tsx`) shows a **Saved Projects** grid: live phone thumbnail (reuses the
real renderer, scaled), name, platform badge, relative "last edited" time, screen count, delete
button. Clicking opens `/workspace?project=<id>` which loads that project at its saved state
(no AI regeneration).

**Autosave + live-save indicator** (`workspace.tsx`): debounced autosave on every project change
plus an editor-metadata subscription. A navbar pill shows **"Saving…"** → **"Saved"**.
⚠️ Implementation note: `saveStatus` lives in the **Zustand store** (`editorStore`), not React
component state — updating it re-renders only the tiny indicator. An earlier version kept it in
Workspace state and it caused an **infinite render loop on direct page loads** (status update →
Workspace re-render → Canvas → store write → html-sync effect → setProject → repeat). Keep
status in the store.

---

## 7. Pro-canvas scrolling (recently reworked — important)

Screens are taller than the 812px frame. Behavior:
- The **header** (status/nav) and **bottom tab bar** stay **pinned** to the frame — they never scroll.
- Only the **content region between them scrolls** (native mobile behavior).
- Scrolling is driven by a **custom scrollbar** beside the phone (not native wheel/touch inside
  the phone) so it never conflicts with element select/drag.
- On every scroll tick, selection boxes/handles/alignment guides recompute via live
  `getBoundingClientRect()`, so overlays track elements exactly — composes with zoom/pan.

Mechanism: `Canvas.jsx` finds the inner scroll region (`findScrollEl` — the descendant with the
largest vertical overflow whose `overflow-y` is auto/scroll/hidden; falls back to the `.screen`
root, which the generator makes `overflow:hidden`). It drives that element's `scrollTop`. Because
the screen keeps its native fixed-height flex layout, the header and tab bar remain pinned for
free. Relies on the standard generated structure (`.screen` flex column with a scrolling body +
pinned bars) — which the Phase-1 prompt enforces.

---

## 8. Undo/redo (Pro)

`editorStore.js` keeps a history/future stack of `{html, page, css?, palette?}` snapshots.
- `commitDom(html)` pushes a snapshot (guards against wiping content with an empty read).
- `commitDesignCss(...)` puts **palette/CSS edits** into the same undo history.
- `loadHtml` (screen switch/initial) **clears** history so screen navigation is never undoable
  and can never desync the canvas from the screen selector.
- Undo/redo restore html+page and, when present, the CSS snapshot (synced back to React via a
  `paletteRestored` signal).

---

## 9. Export options (`workspace.tsx` ExportDropdown)
Copy AI build prompt · React/TSX · raw HTML · Figma-ready JSON · full project JSON. Plus **Share**
(URL with base64-encoded project in `?share=`).

---

## 10. Known limitations / next steps
- **No backend/auth** — everything is localStorage; projects are per-browser. Profile/billing are stubs.
- Scroll pinning assumes the canonical `.screen` + scrolling-body + pinned-bar structure.
- Two pre-existing non-blocking TS `never[]` warnings in `workspace.tsx` (Lite screen props).
- Generation cost: Phase 1+2 on a Pro-tier model; a cheaper Flash tier is intended for refine.
- Templates in `src/lib/templates.ts`; pricing/marketing sections on Home are static.

---

## 11. How to run
```bash
nvm use 20
cp .env.example .env          # add your GEMINI_API_KEY
npm install
npm run dev                   # http://localhost:8080 (or next free port)
```
Open `/` → type an idea → "Design it" → lands in `/workspace` and generates. Or open a saved
project from the Home grid. Toggle Lite/Pro/Connect top-right.
