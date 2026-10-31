param([switch]$Once,[switch]$NoRepair)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'loopback.ps1')
$work=Split-Path $PSScriptRoot -Parent
$mutex=New-Object System.Threading.Mutex($false,'Local\FangyuanSupervisor')
if (-not $mutex.WaitOne(0)) { $mutex.Dispose(); exit 0 }
$stop=Join-Path $work 'logs\supervisor.stop'
$record=Join-Path $work 'logs\supervisor-status.json'
$lastRepair=[datetime]::MinValue
try {
 do {
  if (Test-Path -LiteralPath $stop) { break }
  $runtimeName='maibot'
  $selectionPath=Join-Path $work 'private\active-runtime.json'
  if(Test-Path -LiteralPath $selectionPath){$selection=Get-Content -LiteralPath $selectionPath -Raw | ConvertFrom-Json;if($selection.runtime -eq 'dsh'){$runtimeName='dsh'}}
  $required=if($runtimeName -eq 'dsh'){@(3001,6099,11434,11435,38491,38494)}else{@(3001,3002,6099,11434,11435)}
  $missing=@($required | Where-Object { -not (Test-LocalTcpPort $_) })
  $botAlive=$false
  $botRecord=Join-Path $work 'logs\maibot-process.json'
  if($runtimeName -eq 'dsh'){$botRecord=Join-Path $work 'logs\dsh-process.json'}
  if (Test-Path -LiteralPath $botRecord) {
   $b=Get-Content -LiteralPath $botRecord -Raw | ConvertFrom-Json
   $bp=Get-Process -Id $b.pid -ErrorAction SilentlyContinue
   $botAlive=($null -ne $bp -and $bp.Path -eq $b.executable -and $bp.StartTime.ToUniversalTime().Ticks -eq ([datetime]$b.started).ToUniversalTime().Ticks)
  }
  $healthy=($missing.Count -eq 0 -and $botAlive)
  @{checked_at=[datetime]::UtcNow.ToString('o');healthy=$healthy;runtime=$runtimeName;probe_method='tcp-connect';missing_ports=$missing;runtime_alive=$botAlive;last_repair=$lastRepair.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $record -Encoding utf8
  if (-not $healthy -and -not $NoRepair -and ([datetime]::UtcNow-$lastRepair).TotalSeconds -ge 180) {
   $lastRepair=[datetime]::UtcNow
   $launch=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'start.ps1')+'"')) -WorkingDirectory $work -WindowStyle Hidden -RedirectStandardOutput (Join-Path $work 'logs\supervisor-repair.out.log') -RedirectStandardError (Join-Path $work 'logs\supervisor-repair.err.log') -PassThru
   if (-not $launch.WaitForExit(210000)) { Stop-Process -Id $launch.Id -ErrorAction SilentlyContinue }
  }
  if (-not $Once) { Start-Sleep -Seconds 30 }
 } while (-not $Once)
} finally { $mutex.ReleaseMutex();$mutex.Dispose() }
