$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Security
[System.Windows.Forms.Application]::EnableVisualStyles()
$project=Split-Path $PSScriptRoot -Parent
$secretPath=Join-Path $project 'private\tongji-llm-key.dpapi'
$statePath=Join-Path $project 'private\tongji-credential.json'
$form=New-Object System.Windows.Forms.Form
$form.Text='方源：安全录入同济大学新 API 密钥'
$form.Size=New-Object System.Drawing.Size(660,325)
$form.StartPosition='CenterScreen'
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$label=New-Object System.Windows.Forms.Label
$label.Text="请先在学校平台撤销或重置曾公开的旧密钥。`r`n仅在下面的密码框粘贴新密钥，不要发到聊天里。`r`n密钥将由当前 Windows 账号加密保存；这里不会直接切换在线模型。"
$label.SetBounds(20,18,610,68)
$form.Controls.Add($label)
$link=New-Object System.Windows.Forms.LinkLabel
$link.Text='打开同济 AI 平台（撤销旧密钥／生成新密钥）'
$link.SetBounds(20,88,600,25)
$link.Add_LinkClicked({Start-Process 'https://agent.tongji.edu.cn'})
$form.Controls.Add($link)
$box=New-Object System.Windows.Forms.TextBox
$box.UseSystemPasswordChar=$true
$box.SetBounds(20,125,600,28)
$form.Controls.Add($box)
$rotated=New-Object System.Windows.Forms.CheckBox
$rotated.Text='我已撤销或重置旧密钥；上面输入的是新密钥。'
$rotated.SetBounds(20,165,600,26)
$form.Controls.Add($rotated)
$status=New-Object System.Windows.Forms.Label
$status.SetBounds(20,240,600,32)
$form.Controls.Add($status)
$save=New-Object System.Windows.Forms.Button
$save.Text='加密保存'
$save.SetBounds(385,202,115,32)
$save.Add_Click({
 if ((Test-Path -LiteralPath $secretPath) -and (Test-Path -LiteralPath $statePath) -and $box.Text.Length -eq 0) { $status.Text='已经安全保存，可直接关闭。';return }
 if (-not $rotated.Checked -or $box.Text.Trim().Length -lt 16 -or $box.Text.Trim().Length -gt 4096 -or $box.Text.Trim() -match '\s') { $status.Text='请确认旧密钥已撤销，并输入有效的新密钥。';return }
 $stage='encrypt';$encryptedSaved=$false
 try {
  $bytes=[Text.Encoding]::UTF8.GetBytes($box.Text.Trim())
  try { $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser) }
  finally { [Array]::Clear($bytes,0,$bytes.Length);$box.Clear() }
  [IO.File]::WriteAllBytes($secretPath,$encrypted)
  $encryptedSaved=$true;$stage='permissions'
  $acl=New-Object Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier('S-1-5-18')),'FullControl','Allow')))
  Set-Acl -LiteralPath $secretPath -AclObject $acl
  $stage='completion_record'
  @{new_key_confirmed=$true;old_key_revoked_confirmed=$true;saved_utc=[datetime]::UtcNow.ToString('o');storage='Windows DPAPI CurrentUser'} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
  $status.Text='已安全保存。没有显示密钥，没有自动更换在线模型。'
  $save.Enabled=$false
 } catch {
  @{stage=$stage;encrypted_saved=$encryptedSaved;error_type=$_.Exception.GetType().FullName;checked_utc=[datetime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $project 'private\tongji-key-ui-error.json') -Encoding UTF8
  if ($encryptedSaved) { $status.Text='密钥已加密保存，收尾未完成。请勿反复输入，让助手修复记录。';$save.Enabled=$false }
  else { $status.Text='尚未保存成功，请让助手检查。没有输出密钥。' }
 }
})
$form.Controls.Add($save)
$close=New-Object System.Windows.Forms.Button
$close.Text='关闭'
$close.SetBounds(510,202,110,32)
$close.Add_Click({$box.Clear();$form.Close()})
$form.Controls.Add($close)
[void]$form.ShowDialog()
$box.Dispose();$form.Dispose()
