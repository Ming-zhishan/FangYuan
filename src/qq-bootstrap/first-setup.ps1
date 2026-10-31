$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class FangyuanSetupWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
}
'@
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$privatePath = Join-Path $root 'work\private'
$pythonPath = Join-Path $root 'work\runtime\tools\maibot\Scripts\python.exe'
$form = New-Object System.Windows.Forms.Form
$form.Text = '方源 · 本地免费版与 QQ 登录'
$form.Size = New-Object System.Drawing.Size(800, 470)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
$form.add_Shown({ [FangyuanSetupWindow]::ShowWindow($form.Handle, 5) | Out-Null; $form.Activate() })
$label = New-Object System.Windows.Forms.Label
$label.Text = "模型在本机运行，无需 API Key、无需充值。`r`nQQ 小号：3816636861`r`n仅服务群：680823437`r`n人设：方源，腹黑、沉稳、城府深。`r`n`r`n请用上述 QQ 小号扫描右侧二维码。`r`n二维码会自动刷新，无需反复回聊天索取。"
$label.SetBounds(22, 22, 415, 195)
$form.Controls.Add($label)
$picture = New-Object System.Windows.Forms.PictureBox
$picture.SetBounds(470, 22, 280, 280)
$picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
$form.Controls.Add($picture)
$loginLabel = New-Object System.Windows.Forms.Label
$loginLabel.SetBounds(455, 312, 305, 70)
$loginLabel.Text = '正在读取登录状态…'
$form.Controls.Add($loginLabel)
$agreementLink = New-Object System.Windows.Forms.LinkLabel
$agreementLink.Text = '阅读麦麦用户协议'
$agreementLink.SetBounds(22, 236, 200, 25)
$agreementLink.add_LinkClicked({ Start-Process notepad.exe -ArgumentList ('"' + (Join-Path $root 'outputs\麦麦用户协议.md') + '"') })
$form.Controls.Add($agreementLink)
$privacyLink = New-Object System.Windows.Forms.LinkLabel
$privacyLink.Text = '阅读隐私条款'
$privacyLink.SetBounds(235, 236, 180, 25)
$privacyLink.add_LinkClicked({ Start-Process notepad.exe -ArgumentList ('"' + (Join-Path $root 'outputs\麦麦隐私条款.md') + '"') })
$form.Controls.Add($privacyLink)
$check = New-Object System.Windows.Forms.CheckBox
$check.Text = '我已阅读并同意麦麦用户协议和隐私条款'
$check.SetBounds(22, 275, 420, 32)
$form.Controls.Add($check)
$save = New-Object System.Windows.Forms.Button
$save.Text = '保存协议确认'
$save.SetBounds(22, 325, 180, 35)
$save.add_Click({
    if (-not $check.Checked) {
        [System.Windows.Forms.MessageBox]::Show('麦麦首次运行要求确认协议。请阅读原文后自行决定。', '需要确认协议') | Out-Null
        return
    }
    $consent = @{ accepted = $true }
    $resourceDir = Join-Path $root 'work\runtime\tools\maibot\Lib\site-packages\src\_resources'
    foreach ($name in @('EULA.md','PRIVACY.md')) {
        $content = [System.IO.File]::ReadAllText((Join-Path $resourceDir $name)).Replace("`r`n", "`n")
        $md5 = [System.Security.Cryptography.MD5]::Create()
        $consent[$name] = [BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($content))).Replace('-','').ToLower()
        $md5.Dispose()
    }
    [System.IO.File]::WriteAllText((Join-Path $privatePath 'consent.json'), ($consent | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    & $pythonPath (Join-Path $PSScriptRoot 'configure.py') | Out-File (Join-Path $root 'work\logs\configuration-result.log') -Encoding utf8
    $save.Text = '协议确认已保存'
    $save.Enabled = $false
    $check.Enabled = $false
    Update-Login
})
$form.Controls.Add($save)
$refresh = New-Object System.Windows.Forms.Button
$refresh.Text = '立即刷新二维码'
$refresh.SetBounds(470, 382, 240, 32)
$refresh.add_Click({ $script:lastQR = [datetime]::MinValue; Update-Login })
$form.Controls.Add($refresh)
$script:lastQR = [datetime]::MinValue
function Update-Login {
    try {
        $arguments = @((Join-Path $PSScriptRoot 'status.py'))
        if (([datetime]::Now - $script:lastQR).TotalSeconds -ge 90) {
            $arguments += '--refresh-qr'
            $script:lastQR = [datetime]::Now
        }
        $state = (& $pythonPath @arguments | ConvertFrom-Json)
        if ($state.qq_logged_in) {
            $loginLabel.Text = if ($state.correct_account) { 'QQ 登录成功。请保存左侧协议确认。' } else { '登录账号不符，请返回聊天说明。' }
            $refresh.Enabled = $false
            if ($state.correct_account -and $state.agreements_confirmed) { $form.Close() }
        } else {
            $loginLabel.Text = '等待扫码；请在手机上确认登录。'
            $qrPath = Join-Path $root 'outputs\QQ登录二维码.png'
            if (Test-Path -LiteralPath $qrPath) {
                $stream = [System.IO.MemoryStream]::new([System.IO.File]::ReadAllBytes($qrPath))
                $old = $picture.Image
                $source = [System.Drawing.Image]::FromStream($stream)
                $picture.Image = [System.Drawing.Bitmap]::new($source)
                $source.Dispose()
                $stream.Dispose()
                if ($old) { $old.Dispose() }
            }
        }
    } catch { $loginLabel.Text = '连接组件暂未就绪，稍后自动重试。' }
}
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.add_Tick({ Update-Login })
$form.add_Load({ Update-Login; $timer.Start() })
$form.add_FormClosed({ $timer.Stop(); $timer.Dispose(); if ($picture.Image) { $picture.Image.Dispose() } })
[void]$form.ShowDialog()
