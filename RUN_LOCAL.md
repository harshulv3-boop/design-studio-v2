# Run Locally — Clone → Edit integration

## Quickest way — one click

**Double-click `START.bat`** (in this folder), then open **http://localhost:8081** in your browser.

The dashboard is served **by the clone engine itself**, so there's nothing separate to keep alive — if the page loads, the engine is up, and the clone button works (same origin, no "Failed to fetch").

| What | Local URL |
|---|---|
| **Dashboard** (start here) | **http://localhost:8081** |
| App Design Studio (the editor) | http://localhost:8080 |

From the dashboard you can watch both services' health, paste a URL (e.g. `https://stripe.com`), clone it, download the interactive ZIP, and **preview the JS-free editable version inline** before opening it in the editor. To stop everything, run `STOP.ps1`.

First run downloads Chromium and installs dependencies, so it takes a few minutes; after that it's a few seconds. If Windows blocks the script, right-click `START.ps1` → **Run with PowerShell**, or run `powershell -ExecutionPolicy Bypass -File START.ps1`.

**If the clone button ever says "Failed to fetch":** the engine isn't running. Open http://localhost:8081/api/healthz — if it doesn't return `{"status":"ok"}`, run `DIAGNOSE.ps1`, which rebuilds and starts the engine in a visible window and prints exactly what's wrong.

> Prefer to run the dashboard on its own port instead of from the engine? `control-panel/serve.mjs` serves it on :8090 as a standalone alternative (`node control-panel/serve.mjs`). Not needed for the one-click flow.

---

## Manual way (two terminals)

The three services above can also be started by hand. Ports are the same:

| Service | Folder | Port | Package manager |
|---|---|---|---|
| **Clone engine** (Playwright) | `url-to-code` | **8081** | pnpm |
| **App Design Studio** (the UI you open) | `app-design-studio` | **8080** | npm |

You open **http://localhost:8080** in your browser (or the control panel on 8090). The studio proxies clone requests to the engine on 8081, so both must be running.

---

## One-time setup

Open **PowerShell**. You need **Node.js 20+** (`node -v` to check).

### 1. Clone engine

```powershell
cd "C:\Users\IshitaMagazine\OneDrive - CENTRICITY FINANCIAL DISTRIBUTION PRIVATE LIMITED\Documents\Claude\Projects\design\url-to-code"
corepack enable
corepack pnpm install
corepack pnpm exec playwright install chromium   # one-time browser download (~150 MB)
corepack pnpm --filter @workspace/api-server run build
```

### 2. App Design Studio

```powershell
cd "C:\Users\IshitaMagazine\OneDrive - CENTRICITY FINANCIAL DISTRIBUTION PRIVATE LIMITED\Documents\Claude\Projects\design\app-design-studio"
npm install
```

Optional — only if you want **AI edits** and **app generation** (clone + download + manual editing work without it):

```powershell
Copy-Item .env.example .env
# then edit .env and set GEMINI_API_KEY=your-key
```

---

## Every time you want to run it

**Terminal 1 — clone engine:**

```powershell
cd "C:\Users\IshitaMagazine\OneDrive - CENTRICITY FINANCIAL DISTRIBUTION PRIVATE LIMITED\Documents\Claude\Projects\design\url-to-code\artifacts\api-server"
$env:PORT=8081
node dist/index.mjs
```

Wait for `Server listening ... port: 8081`.

**Terminal 2 — studio:**

```powershell
cd "C:\Users\IshitaMagazine\OneDrive - CENTRICITY FINANCIAL DISTRIBUTION PRIVATE LIMITED\Documents\Claude\Projects\design\app-design-studio"
npm run dev
```

Wait for `Local: http://localhost:8080/`, then open **http://localhost:8080**.

> The studio finds the engine at `http://localhost:8081` by default. To use a different port, set `CLONE_ENGINE_URL` before `npm run dev` (e.g. `$env:CLONE_ENGINE_URL="http://localhost:9000"`).

---

## What to check in the browser

**The flow:**

1. On the home page, click the **"Clone a website"** tab (next to "Design an app").
2. Enter `https://stripe.com` → **Clone Website**. Watch the progress bar (~30–90 s).
3. When it finishes you get two options:
   - **Download Website** → the interactive ZIP (JS, animations, navigation intact). Unzip and open `index.html` to verify.
   - **Edit Design** → opens the JS-free, visually-identical version in the canvas editor.

**In the editor, verify each existing feature works on the imported site** (this is the point of the integration — nothing should break because the project came from a clone):

- [ ] Looks visually identical to stripe.com (fonts, gradients, shadows, spacing, layout)
- [ ] **Lite** mode renders; clicking an element targets it
- [ ] **Pro** mode: select, multi-select (shift/marquee), drag, resize, duplicate, delete
- [ ] **Layers** panel shows the page hierarchy (collapsed to top sections by default); rename / hide / lock
- [ ] **Properties** panel edits typography / spacing / color / radius / effects on a selected element
- [ ] **Undo/redo** (Ctrl+Z / Ctrl+Shift+Z)
- [ ] **Zoom / pan** (scroll, space-drag, fit)
- [ ] **AI edit**: select an element, type an instruction in chat (needs `GEMINI_API_KEY`)
- [ ] **Export** (top-right): "Download Website (interactive ZIP)", Export HTML, React, Figma JSON, Project JSON
- [ ] **Reload the page** — the imported project reopens from where you left off

**Fidelity comparison (your success metric):**
Open these three and compare — they should look nearly identical:
- Original: `https://stripe.com`
- Reference screenshot the engine captured: `http://localhost:8081/api/clone/<jobId>/screenshot` (the `<jobId>` is in the browser Network tab, or reuse the one from the clone)
- The **Edit Design** canvas

---

## Notes & troubleshooting

- **"Clone engine is not reachable"** in the studio → Terminal 1 (engine) isn't running, or is on a different port. Confirm `http://localhost:8081/api/healthz` returns `{"status":"ok"}`.
- **Editable version size** is shown on the "Edit Design" button (target < 1 MB; stripe.com should land well under that). If a site exceeds 1 MB the engine keeps full fidelity anyway and logs a warning — visual fidelity is prioritized over size by design.
- **Storage:** website imports are saved in the browser's **IndexedDB** (they're too big for localStorage); app projects still use localStorage. Both appear together in "Your projects" on the home page.
- **AI features** (element edits, app generation) require `GEMINI_API_KEY` in `app-design-studio\.env`. Cloning, downloading, manual editing, and export all work without it.
- **Rebuild the engine** after any code change to `url-to-code`: `corepack pnpm --filter @workspace/api-server run build` (the studio hot-reloads on its own).
- **Single-page v1:** the clone captures the one URL you enter. Navigation links in the editable version point to the live site. Multi-page selection is a planned v2 (the schema already supports multiple pages per project).

See **INTEGRATION_PLAN.md** for the full architecture and **INTEGRATION_SUMMARY.md** for what changed in each file.
