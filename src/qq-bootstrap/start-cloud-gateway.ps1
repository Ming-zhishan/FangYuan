$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pythonPath=Join-Path $root 'work\runtime\tools\maibot\Scripts\python.exe'
$running=Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $pythonPath -and $_.CommandLine -like '*cloud_gateway.py*'}
if($running){return}
$logs=Join-Path $root 'work\logs'
$p=Start-Process -FilePath $pythonPath -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'cloud_gateway.py')+'"')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'cloud-gateway.out.log') -RedirectStandardError (Join-Path $logs 'cloud-gateway.err.log') -PassThru
@{pid=$p.Id;started=$p.StartTime.ToUniversalTime().ToString('o');executable=$pythonPath}|ConvertTo-Json|Set-Content (Join-Path $logs 'cloud-gateway-process.json') -Encoding utf8
