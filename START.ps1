# ============================================================================
#  Clone -> Edit  ·  one-click local launcher
#  Starts the clone engine (:8081, which also serves the dashboard) and the
#  App Design Studio (:8080), then opens the dashboard in your browser.
#
#  Open in your browser:  http://localhost:8081   (the dashboard)
#
#  Run:  right-click START.ps1 -> Run with PowerShell   (or double-click START.bat)
# ============================================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$engine = Join-Path $root "url-to-code"
$engineApi = Join-Path $engine "artifacts\api-server"
$studio = Join-Path $root "app-design-studio"

function Section($t){ Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

# ---- prerequisites --------------------------------------------------------
Section "Checking prerequisites"
try { $nodeV = (node -v) } catch { Write-Host "Node.js not found. Install Node 20+ from https://nodejs.org" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
Write-Host "Node $nodeV"
try { corepack enable | Out-Null } catch {}

# ---- engine: install (first run), Chromium (first run), ALWAYS build -------
# We always rebuild the engine so the bundled dashboard is up to date.
Section "Preparing clone engine (:8081)"
Write-Host "Installing engine dependencies (first run takes a few minutes)..."
Push-Location $engine
# --config.dangerouslyAllowAllBuilds=true lets dependencies (esbuild) run their
# install scripts. pnpm blocks these by default; allowing them is required to
# bundle the engine, and is what npm does normally. Then rebuild esbuild to be
# certain its native binary is set up for this OS (Windows/Mac/Linux).
corepack pnpm install --config.dangerouslyAllowAllBuilds=true
corepack pnpm rebuild esbuild 2>$null
Pop-Location
$pwCache = Join-Path $env:USERPROFILE "AppData\Local\ms-playwright"
if (-not (Test-Path $pwCache)) {
  Write-Host "Downloading Chromium for the cloner (first run only)..."
  Push-Location $engine; corepack pnpm exec playwright install chromium; Pop-Location
}
Write-Host "Building engine..."
Push-Location $engine; corepack pnpm --filter @workspace/api-server run build; Pop-Location
if (-not (Test-Path (Join-Path $engineApi "dist\index.mjs"))) {
  Write-Host "Engine build failed (dist\index.mjs missing). Scroll up for the error, or run DIAGNOSE.ps1." -ForegroundColor Red
  Read-Host "Press Enter to exit"; exit 1
}

# ---- studio: install (first run only) -------------------------------------
Section "Preparing App Design Studio (:8080)"
if (-not (Test-Path (Join-Path $studio "node_modules"))) {
  Write-Host "Installing studio dependencies (first run, a few minutes)..."
  Push-Location $studio; npm install; Pop-Location
}

# ---- launch the two services in their own windows -------------------------
Section "Launching services"

Start-Process powershell -ArgumentList @(
  "-NoExit","-Command",
  "cd '$engineApi'; `$env:PORT=8081; Write-Host 'CLONE ENGINE + DASHBOARD  ->  http://localhost:8081' -ForegroundColor Green; node dist/index.mjs"
)
Write-Host "  engine + dashboard  ->  http://localhost:8081"

Start-Process powershell -ArgumentList @(
  "-NoExit","-Command",
  "cd '$studio'; `$env:CLONE_ENGINE_URL='http://localhost:8081'; Write-Host 'APP DESIGN STUDIO  ->  http://localhost:8080' -ForegroundColor Green; npm run dev"
)
Write-Host "  design studio       ->  http://localhost:8080"

# ---- wait for the engine, then open the dashboard -------------------------
Section "Opening the dashboard"
$ok = $false
foreach ($i in 1..60) {
  Start-Sleep -Milliseconds 500
  try { $r = Invoke-WebRequest "http://localhost:8081/api/healthz" -UseBasicParsing -TimeoutSec 2; if ($r.Content -match "ok") { $ok = $true; break } } catch {}
}
if ($ok) { Write-Host "Engine is up." -ForegroundColor Green } else { Write-Host "Engine didn't answer yet - it may still be starting. Opening anyway." -ForegroundColor Yellow }
Start-Process "http://localhost:8081"

Write-Host ""
Write-Host "Dashboard:  http://localhost:8081" -ForegroundColor Green
Write-Host "Studio:     http://localhost:8080  (used when you click 'Edit Design' / 'Open in Studio')"
Write-Host "The studio may take ~20s more to finish its first compile."
Write-Host "To stop everything, run STOP.ps1 (or close the two service windows)."
Write-Host ""
Read-Host "Press Enter to close this launcher window"
