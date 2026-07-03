# Stops the local Clone -> Edit services by freeing ports 8080, 8081, 8090.
$ports = 8080, 8081, 8090
foreach ($p in $ports) {
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
      $procId = $c.OwningProcess
      if ($procId) {
        $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped $name (PID $procId) on port $p" -ForegroundColor Yellow
      }
    }
  } catch { Write-Host "Nothing listening on $p" }
}
Write-Host "Done. All local services on 8080/8081/8090 stopped." -ForegroundColor Green
Start-Sleep -Seconds 1
