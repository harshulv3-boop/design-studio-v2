# SiteClone

A full-page website cloning tool. Paste any public URL, and SiteClone uses a headless Chromium browser (Playwright) to crawl the entire page, scroll to trigger lazy-loaded content, capture all assets (CSS, images, fonts, JS), and bundle everything into a downloadable ZIP.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/site-cloner run dev` — run the React frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Browser automation: Playwright (Chromium headless shell)
- Zipping: JSZip (pure JS, no native deps)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite + TanStack Query + Framer Motion

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `artifacts/api-server/src/routes/clone.ts` — Playwright clone route (job queue, SSRF protection, JSZip bundling)
- `artifacts/site-cloner/src/pages/home.tsx` — main UI (URL input, progress polling, download)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit)

## Architecture decisions

- **In-memory job queue**: Clone jobs are stored in a `Map<jobId, Job>` with 30-minute TTL cleanup. No DB needed — jobs are ephemeral.
- **Playwright externalized from esbuild**: `playwright` stays external in `build.mjs` so it resolves its own browser binaries at runtime correctly.
- **JSZip over archiver**: `archiver` (CJS) didn't load correctly through esbuild's ESM bundle + createRequire. JSZip is pure ESM and bundles cleanly.
- **SSRF protection**: All URLs are DNS-resolved before Playwright loads them; any IP resolving to private/loopback/link-local ranges is blocked.
- **String-form `page.evaluate`**: The scroll script is passed as a template string to avoid TypeScript DOM type errors in the server tsconfig.
- **Job cleanup**: `try/finally` around the browser ensures Chromium is always closed on success or error; temp dirs are cleaned in both cases.

## Product

- Paste any public URL → Playwright launches headless Chrome, waits for load, auto-scrolls for lazy content
- All CSS, images, fonts, JS captured via route interception
- URLs in HTML rewritten to relative `assets/` paths
- Everything zipped with JSZip and served as a download

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `playwright install chromium` must be run to download the Chromium headless shell (already done; binary lives in `.cache/ms-playwright/`)
- Chromium requires several NixOS system libs: `glib`, `nss`, `pango`, `cairo`, `mesa`, `libgbm`, `gtk3`, and friends — all installed via `installSystemDependencies`
- Never use `archiver` — it's a CJS module that breaks in the esbuild ESM bundle even with `createRequire`. Use `jszip` instead.
- `archiver` is in the esbuild external list in `build.mjs` (harmless leftover, can be removed)
- `page.evaluate()` DOM callbacks must use string form to avoid server-side TS type errors

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
