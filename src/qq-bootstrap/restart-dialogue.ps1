$ErrorActionPreference='Stop'
$work=Split-Path $PSScriptRoot -Parent
$archive=Join-Path $work ('cloud-investigation\deploy-logs-'+(Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Path $archive | Out-Null
foreach($name in @('maibot','character-channel','cloud-gateway')) {
 foreach($suffix in @('out.log','err.log','process.json')) {
  $f=Join-Path $work ('logs\'+$name+'-'+$suffix)
  if($suffix -ne 'process.json') { $f=Join-Path $work ('logs\'+$name+'.'+$suffix) }
  if(Test-Path -LiteralPath $f) { Copy-Item -LiteralPath $f -Destination $archive }
 }
 $recordPath=Join-Path $work ('logs\'+$name+'-process.json')
 if(-not (Test-Path -LiteralPath $recordPath)){continue}
 $r=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
 $p=Get-Process -Id $r.pid -ErrorAction SilentlyContinue
 if($p -and $r.executable -and $p.Path -eq $r.executable -and $p.StartTime.ToUniversalTime().Ticks -eq ([datetime]$r.started).ToUniversalTime().Ticks) {
  & taskkill.exe /PID $p.Id /T /F | Out-Null
 } elseif($p) { throw ('Unverified process identity: '+$name) }
}
& (Join-Path $PSScriptRoot 'start.ps1')
