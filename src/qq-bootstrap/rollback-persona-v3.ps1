$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$backup = (Get-Content -LiteralPath (Join-Path $root 'work/logs/persona-v3-backup.json') -Raw | ConvertFrom-Json).path
$resolvedBackup = (Resolve-Path -LiteralPath $backup).Path
$allowed = (Join-Path $root 'work/private/before-persona-v3-')
if (-not $resolvedBackup.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup is outside this instance.' }
foreach ($recordName in @('character-channel-process.json','maibot-process.json')) {
    $recordPath = Join-Path $root ('work/logs/'+$recordName)
    if (-not (Test-Path -LiteralPath $recordPath)) { continue }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($process -and $process.Path -eq $record.executable -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.started).ToUniversalTime().Ticks) {
        & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
}
foreach ($name in @('bot_config.toml','model_config.toml')) {
    Copy-Item -LiteralPath (Join-Path $resolvedBackup ('work/instance/config/'+$name)) -Destination (Join-Path $root ('work/instance/config/'+$name)) -Force
}
foreach ($name in @('private_replies.py','character_retrieval.py','character-channel.py')) {
    Copy-Item -LiteralPath (Join-Path $resolvedBackup ('work/setup/'+$name)) -Destination (Join-Path $PSScriptRoot $name) -Force
}
$plugin = Join-Path $root 'work/instance/plugins/fangyuan-continuity'
if (Test-Path -LiteralPath $plugin) {
    $disabled = Join-Path $root ('work/private/disabled-fangyuan-v3-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    if (-not (Resolve-Path -LiteralPath $plugin).Path.StartsWith((Join-Path $root 'work/instance/plugins/'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Plugin path escaped instance.' }
    if (-not [IO.Path]::GetFullPath($disabled).StartsWith((Join-Path $root 'work/private/'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escaped instance.' }
    Move-Item -LiteralPath $plugin -Destination $disabled
}
# New conversation records and separate state/memory databases are preserved for later inspection.
& (Join-Path $PSScriptRoot 'start.ps1') -PrivateTest
