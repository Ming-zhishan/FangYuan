param([switch]$PrivateTest)
$launchMutex=New-Object System.Threading.Mutex($false,'Local\FangyuanBotLaunch')
if (-not $launchMutex.WaitOne(0)) { Write-Output 'Fangyuan is already starting.'; $launchMutex.Dispose(); return }
try {
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'loopback.ps1')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$pythonPath = Join-Path $root 'work\runtime\tools\maibot\Scripts\python.exe'
$privatePath = Join-Path $root 'work\private'
$logs = Join-Path $root 'work\logs'
& $pythonPath (Join-Path $PSScriptRoot 'configure.py') | Out-File (Join-Path $logs 'configuration-result.log') -Encoding utf8
$state = Get-Content (Join-Path $logs 'configuration-result.log') -Raw | ConvertFrom-Json
if (-not $state.user_agreement_confirmed) {
    & (Join-Path $PSScriptRoot 'first-setup.ps1')
    & $pythonPath (Join-Path $PSScriptRoot 'configure.py') | Out-File (Join-Path $logs 'configuration-result.log') -Encoding utf8
    $state = Get-Content (Join-Path $logs 'configuration-result.log') -Raw | ConvertFrom-Json
    if (-not $state.user_agreement_confirmed) { exit 2 }
}
& (Join-Path $PSScriptRoot 'start-model.ps1')
& (Join-Path $PSScriptRoot 'start-cloud-gateway.ps1')
$listener = Test-LocalTcpPort 6099
if (-not $listener) {
    $napcatDir = Join-Path $root 'work\napcat'
    $env:NAPCAT_PATCH_PACKAGE = Join-Path $napcatDir 'qqnt.json'
    $env:NAPCAT_LOAD_PATH = Join-Path $napcatDir 'loadNapCat.js'
    $env:NAPCAT_INJECT_PATH = Join-Path $napcatDir 'NapCatWinBootHook.dll'
    $env:NAPCAT_MAIN_PATH = Join-Path $napcatDir 'napcat.mjs'
    $napcat = Start-Process -FilePath (Join-Path $napcatDir 'NapCatWinBootMain.exe') -ArgumentList @('"C:\Program Files\Tencent\QQNT\QQ.exe"', ('"' + $env:NAPCAT_INJECT_PATH + '"'), '3816636861') -WorkingDirectory $napcatDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'napcat.out.log') -RedirectStandardError (Join-Path $logs 'napcat.err.log') -PassThru
    @{ pid = $napcat.Id; started = $napcat.StartTime.ToUniversalTime().ToString('o'); executable = (Join-Path $root 'work\napcat\NapCatWinBootMain.exe') } | ConvertTo-Json | Set-Content (Join-Path $logs 'napcat-process.json') -Encoding utf8
}
# Verify the logged-in account before enabling automatic replies.
for ($attempt = 0; $attempt -lt 36; $attempt++) {
    & $pythonPath (Join-Path $PSScriptRoot 'status.py') --require-login | Out-File (Join-Path $logs 'connection-status.json') -Encoding utf8
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 5
}
if ($LASTEXITCODE -ne 0) { exit 3 }
$connectionState = Get-Content (Join-Path $logs 'connection-status.json') -Raw | ConvertFrom-Json
$selectionPath=Join-Path $privatePath 'active-runtime.json'
if(Test-Path -LiteralPath $selectionPath){
    $selection=Get-Content -LiteralPath $selectionPath -Raw | ConvertFrom-Json
    if($selection.runtime -eq 'dsh'){
        if($PrivateTest){throw 'DSH is active; the legacy private test cannot be enabled'}
        $modePath=Join-Path $privatePath 'chat-mode.json'
        $legacy=Get-Content -LiteralPath $modePath -Raw | ConvertFrom-Json
        $legacy.mode='disabled'
        $legacy | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $modePath -Encoding utf8
        & (Join-Path $PSScriptRoot 'start-dsh.ps1')
        exit 0
    }
}
$requestedMode = if ($PrivateTest) { 'private_test' } else { 'both' }
$modePath = Join-Path $privatePath 'chat-mode.json'
$previousMode = if (Test-Path -LiteralPath $modePath) { (Get-Content -LiteralPath $modePath -Raw | ConvertFrom-Json).mode } else { '' }
$botRecordPath = Join-Path $logs 'maibot-process.json'
if (Test-Path -LiteralPath $botRecordPath) {
    $record = Get-Content -LiteralPath $botRecordPath -Raw | ConvertFrom-Json
    $managedBot = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($managedBot -and $managedBot.Path -eq $record.executable -and $managedBot.StartTime.ToUniversalTime().Ticks -eq ([datetime]$record.started).ToUniversalTime().Ticks) {
        if ($previousMode -eq $requestedMode -and -not $PrivateTest) {
            & (Join-Path $PSScriptRoot 'start-character-channel.ps1')
            exit 0
        }
        & taskkill.exe /PID $managedBot.Id /T /F | Out-Null
    }
}
& $pythonPath (Join-Path $PSScriptRoot 'configure-chat-mode.py') --mode $requestedMode | Out-File (Join-Path $logs 'chat-mode-result.json') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure the selected chat mode.' }
if (-not $PrivateTest -and -not $connectionState.in_target_group) {
    Write-Output 'Please invite QQ 3816636861 to the configured group 680823437 before starting automatic replies.'
    exit 4
}
& (Join-Path $PSScriptRoot 'start-character-channel.ps1')
if ($PrivateTest) {
    Write-Output 'Started mode: private_test (direct replies, no participation planner)'
    exit 0
}
$env:PYTHONUTF8 = '1'
$bot = Start-Process -FilePath (Join-Path $root 'work\runtime\tools\maibot\Scripts\maibot.exe') -ArgumentList @('run','--directory',('"' + (Join-Path $root 'work\instance') + '"')) -WorkingDirectory (Join-Path $root 'work\instance') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'maibot.out.log') -RedirectStandardError (Join-Path $logs 'maibot.err.log') -PassThru
@{ pid = $bot.Id; started = $bot.StartTime.ToUniversalTime().ToString('o'); executable = (Join-Path $root 'work\runtime\tools\maibot\Scripts\maibot.exe') } | ConvertTo-Json | Set-Content (Join-Path $logs 'maibot-process.json') -Encoding utf8
Write-Output ('Started mode: ' + $requestedMode)

} finally { $launchMutex.ReleaseMutex(); $launchMutex.Dispose() }
