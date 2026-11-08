
if ($env:FANGYUAN_LEGACY_EXECUTION -ne '1') {
    throw 'Archived tool: read legacy/README.md and configure an isolated environment before enabling.'
}
$ErrorActionPreference='Stop'
$work=Split-Path $PSScriptRoot -Parent
$selection=Get-Content -LiteralPath (Join-Path $work 'private\active-runtime.json') -Raw | ConvertFrom-Json
if($selection.runtime -ne 'dsh'){throw 'DSH is not the selected runtime'}
& $selection.pythonPath $selection.launchScript
if($LASTEXITCODE -ne 0){throw 'DSH startup failed'}
