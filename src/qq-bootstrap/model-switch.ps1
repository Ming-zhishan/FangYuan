param([ValidateSet('Tongji','Qwen','Local','Status')][string]$Action='Status')
$ErrorActionPreference='Stop'
$project=Split-Path $PSScriptRoot -Parent
$python=Join-Path $project 'runtime\tools\maibot\Scripts\python.exe'
$command=@{Tongji='use-tongji';Qwen='use-qwen';Local='use-local';Status='status'}[$Action]
$env:PYTHONUTF8='1'
$text=& $python (Join-Path $PSScriptRoot 'tongji-control.py') $command
$code=$LASTEXITCODE
Add-Type -AssemblyName System.Windows.Forms
try {
 $result=($text -join "`n") | ConvertFrom-Json
 if ($code -ne 0) {
  $reasons=@{
   school_policy_not_verified='学校用途、模型调用或校外好友数据处理范围尚未核实。当前在线模型未被切换。'
   school_points_policy_not_verified='学校积分规则、可用额度及不会触发现金付费的边界尚未核实。当前在线模型未被切换。'
   school_network_policy_denied='学校服务器拒绝当前网络环境。请核对校园网络、学校VPN及代理域名规则，不要反复更新密钥。'
   school_authentication_failed='学校返回密钥鉴权失败。请通过本机安全录入工具更换密钥，不要发到聊天里。'
   school_model_permission_denied='当前密钥未取得该模型的调用权限，不能把它当成普通网络故障。'
   school_quota_exhausted='学校配额或积分不足。本工具不会充值或开启现金付费。'
   school_verification_expired='学校核验记录已到期，当前在线模型未被切换。'
   new_key_rotation_required='请先撤销旧密钥，再通过本机新密钥录入工具保存。'
   new_key_missing='尚未安全保存新密钥。'
   school_real_evaluation_missing='尚未完成同济模型真实测试，当前在线模型未被切换。'
   school_real_evaluation_incomplete='同济模型测试不完整或有失败，当前在线模型未被切换。'
   school_quality_review_pending='同济模型质量评估尚未确认通过。当前在线模型未被切换。'
  }
  $message=$reasons[$result.reason]
  if (-not $message) {$message='未切换模型。请让助手检查结果：'+$result.reason}
 } elseif($Action -eq 'Status') {
  $names=@{bailian='百炼 Qwen（保留免费保护）';tongji='同济大学模型';local='本地安全降级'}
  $message='当前配置：'+$names[$result.current_provider]+"`n同济模型启用："+$result.school_enabled+"`n新密钥文件："+$result.new_key_present
 } else {
  $message='已保存模型选择：'+@{Tongji='同济大学模型';Qwen='百炼 Qwen';Local='本地安全降级'}[$Action]+"`n下一条新请求生效，保留原有聊天记忆和工具权限。接口真实可用性仍以运行日志为准。"
 }
 [void][System.Windows.Forms.MessageBox]::Show($message,'方源模型切换',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Information)
} catch {
 [void][System.Windows.Forms.MessageBox]::Show('没有拿到可验证的切换结果，请让助手检查。','方源模型切换')
}
