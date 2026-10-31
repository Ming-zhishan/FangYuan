# Sets FY_* variables only for the current PowerShell process, without altering global variables.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$map = @{
  'FY_PROJECT_ROOT' = $root
  'FY_SOURCE_ROOT' = Join-Path $root 'src'
  'FY_BOT_SOURCE' = Join-Path $root 'src\fangyuan-agent'
  'FY_QQ_BOOTSTRAP' = Join-Path $root 'src\qq-bootstrap'
  'FY_QQ_RUNTIME' = Join-Path $root 'runtime\qq-stack'
  'FY_DSH_RUNTIME' = Join-Path $root 'runtime\dsh-live'
  'FY_MEDIA_ROOT' = Join-Path $root 'research\media-catalog'
}
foreach($name in $map.Keys) {
  $value = $map[$name]
  if(-not (Test-Path -LiteralPath $value)) { throw "FangYuan path missing: $name => $value" }
  [Environment]::SetEnvironmentVariable($name,$value,'Process')
}
Write-Output "FangYuan session paths loaded: $root"
Write-Output 'Existing DSH_HOME, AURABOT_* and tokens were not modified.'
