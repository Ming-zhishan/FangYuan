# Not run automatically. Use only after the user approves the free-only trial.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$root = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$target = Join-Path $root 'work\private\bailian-trial-key.dpapi'
if (Test-Path -LiteralPath $target) { throw 'A key already exists; it will not be overwritten.' }
$secret = Read-Host '在这里粘贴百炼专用 API Key（输入不显示，不要发到聊天）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if (-not $plain.StartsWith('sk-') -or $plain.StartsWith('sk-sp-')) { throw '需要百炼按量API Key，不能使用Token Plan或Coding Plan专用Key。' }
    $bytes = [Text.Encoding]::UTF8.GetBytes($plain)
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes($target,$encrypted)
    $acl = New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true,$false)
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $target -AclObject $acl
    Write-Host '密钥已加密保存；未调用模型，未改变正在运行的机器人。'
} finally {
    if ($bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $plain = $null
    $secret.Dispose()
}
