$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pythonPath = Join-Path $root 'work\runtime\tools\maibot\Scripts\python.exe'
$existing = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $pythonPath -and $_.CommandLine -like '*character-channel.py*' }
if ($existing) { return }
$logs = Join-Path $root 'work\logs'
$process = Start-Process -FilePath $pythonPath -ArgumentList @(('"' + (Join-Path $PSScriptRoot 'character-channel.py') + '"')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'character-channel.out.log') -RedirectStandardError (Join-Path $logs 'character-channel.err.log') -PassThru
@{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o'); executable = $pythonPath } | ConvertTo-Json | Set-Content (Join-Path $logs 'character-channel-process.json') -Encoding utf8
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (Get-NetTCPConnection -State Listen -LocalPort 3002 -ErrorAction SilentlyContinue) { return }
    if ($process.HasExited) { throw 'Local character channel failed to start; see private logs.' }
    Start-Sleep -Milliseconds 250
}
throw 'Local character channel did not become ready.'
