$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'loopback.ps1')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$executable = Join-Path $root 'work\ollama\ollama.exe'
$listener = Test-LocalTcpPort 11434
if ($listener) { return }
if (-not (Test-Path -LiteralPath $executable)) { throw 'Local model runtime has not finished installing.' }
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = Join-Path $root 'work\models'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_CONTEXT_LENGTH = '16384'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '2'
$env:OLLAMA_KEEP_ALIVE = '2m'
$env:OLLAMA_FLASH_ATTENTION = '1'
$env:OLLAMA_KV_CACHE_TYPE = 'q8_0'
$logs = Join-Path $root 'work\logs'
$process = Start-Process -FilePath $executable -ArgumentList 'serve' -WorkingDirectory (Join-Path $root 'work\ollama') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'ollama.out.log') -RedirectStandardError (Join-Path $logs 'ollama.err.log') -PassThru
@{ pid = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o'); executable = $executable } | ConvertTo-Json | Set-Content (Join-Path $logs 'ollama-process.json') -Encoding utf8
