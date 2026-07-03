# ============================================================================
#  Clone -> Edit  ·  engine doctor
#  Figures out why the clone engine (:8081) isn't answering, fixes what it can,
#  then starts the engine IN THIS WINDOW so any error is visible.
#
#  Run:  right-click DIAGNOSE.ps1 -> Run with PowerShell
# ============================================================================
$ErrorActionPreference = "Continue"
$root = $PSScriptRoot
$engine = Join-Path $root "url-to-code"
$engineApi = Join-Path $engine "artifacts\api-server"
$dist = Join-Path $engineApi "dist\index.mjs"

function OK($m){ Write-Host "  [ OK ] $m" -ForegroundColor Green }
function BAD($m){ Write-Host "  [FAIL] $m" -ForegroundColor Red }
function INFO($m){ Write-Host "  [ .. ] $m" -ForegroundColor Gray }

Write-Host ""
Write-Host "=== 1. Node.js ===" -ForegroundColor Cyan
try { $v = node -v; OK "node $v" } catch { BAD "Node.js not found — install Node 20+ from https://nodejs.org, then re-run."; Read-Host "Enter to exit"; exit 1 }

Write-Host ""
Write-Host "=== 2. Is something already on :8081? ===" -ForegroundColor Cyan
$listener = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $procId = $listener[0].OwningProcess
  $pname = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
  INFO "Port 8081 is in use by $pname (PID $procId). Testing health…"
  try {
    $h = Invoke-WebRequest "http://localhost:8081/api/healthz" -UseBasicParsing -TimeoutSec 4
    if ($h.Content -match "ok") { OK "Engine is already running and healthy. The dashboard should work now — reload http://localhost:8090"; Read-Host "Enter to exit"; exit 0 }
    else { BAD "Something is on :8081 but it's not the engine. Close it or run STOP.ps1, then re-run this." }
  } catch { BAD "Port 8081 busy but not responding to /api/healthz. Run STOP.ps1 to free it, then re-run this." }
} else { OK "Port 8081 is free." }

Write-Host ""
Write-Host "=== 3. Engine dependencies ===" -ForegroundColor Cyan
try { corepack enable | Out-Null } catch {}
INFO "Installing engine dependencies (a few minutes)…"
Push-Location $engine
corepack pnpm install --config.dangerouslyAllowAllBuilds=true
corepack pnpm rebuild esbuild 2>$null
Pop-Location
if (Test-Path (Join-Path $engine "node_modules")) { OK "dependencies installed" } else { BAD "pnpm install failed — see messages above." }

Write-Host ""
Write-Host "=== 4. Engine build (dist\index.mjs) ===" -ForegroundColor Cyan
if (Test-Path $dist) { OK "dist\index.mjs present" }
else {
  INFO "Building engine…"
  Push-Location $engine; corepack pnpm --filter @workspace/api-server run build; Pop-Location
  if (Test-Path $dist) { OK "built" } else { BAD "Build failed — dist\index.mjs still missing. Copy the errors above and send them to me." }
}

Write-Host ""
Write-Host "=== 5. Chromium for cloning ===" -ForegroundColor Cyan
$pw = Join-Path $env:USERPROFILE "AppData\Local\ms-playwright"
if (Test-Path $pw) { OK "Playwright browser cache present" }
else {
  INFO "Downloading Chromium (first run only)…"
  Push-Location $engine; corepack pnpm exec playwright install chromium; Pop-Location
}

Write-Host ""
Write-Host "=== 6. Starting the engine (leave this window open) ===" -ForegroundColor Cyan
if (-not (Test-Path $dist)) { BAD "Cannot start — the build didn't produce dist\index.mjs. Send me the errors from step 4."; Read-Host "Enter to exit"; exit 1 }
Write-Host "  Engine will run here. You should see 'Server listening ... port: 8081'." -ForegroundColor Gray
Write-Host "  Then reload the dashboard at http://localhost:8090 and try the clone again." -ForegroundColor Gray
Write-Host "  (Keep this window open. Ctrl+C stops the engine.)" -ForegroundColor Gray
Write-Host ""
Set-Location $engineApi
$env:PORT = 8081
node dist/index.mjs
