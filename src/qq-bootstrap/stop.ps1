$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Content -LiteralPath (Join-Path $root 'work\logs\supervisor.stop') -Value 'intentional stop'
foreach ($name in @('maibot', 'character-channel', 'napcat', 'ollama', 'cloud-gateway')) {
    $recordPath = Join-Path $root ('work\logs\' + $name + '-process.json')
    if (-not (Test-Path -LiteralPath $recordPath)) { continue }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($process -and $process.Path -eq $record.executable -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.started).ToUniversalTime().Ticks) {
        & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
}
