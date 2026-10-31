$ErrorActionPreference='Stop'
$work=Split-Path $PSScriptRoot -Parent
$stop=Join-Path $work 'logs\supervisor.stop'
if (Test-Path -LiteralPath $stop) { Remove-Item -LiteralPath $stop }
Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $PSScriptRoot 'supervise.ps1')+'"')) -WorkingDirectory $work -WindowStyle Hidden
