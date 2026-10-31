# 关掉 TUN 之后运行：刷新 DNS 并验证学校 DeepSeek 是否恢复
# 用法：右键「使用 PowerShell 运行」，或在 PowerShell 里执行本文件路径
$ErrorActionPreference = 'Continue'
$root = 'E:\FangYuan\services\qq\work'
$py = Join-Path $root 'runtime\tools\maibot\Scripts\python.exe'

Write-Host ''
Write-Host '=== 1/4 刷新 DNS 缓存 ===' -ForegroundColor Cyan
ipconfig /flushdns | Out-Null
Write-Host '  已刷新'

Write-Host '=== 2/4 检查默认路由是否已离开 TUN ===' -ForegroundColor Cyan
$routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object RouteMetric | Select-Object -First 2
foreach ($r in $routes) {
    Write-Host ("  {0,-18} metric={1}" -f $r.NextHop, $r.RouteMetric)
}
if ($routes[0].NextHop -like '198.18.*') {
    Write-Host '  [警告] 默认路由仍指向 TUN，代理没有真正退出' -ForegroundColor Yellow
}

Write-Host '=== 3/4 检查域名解析 ===' -ForegroundColor Cyan
$ip = (Resolve-DnsName agi.tongji.edu.cn -Type A -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress } | Select-Object -First 1).IPAddress
Write-Host "  agi.tongji.edu.cn -> $ip"
if ($ip -like '198.18.*') {
    Write-Host '  [警告] 仍是 fake-ip，TUN 模式没关干净（只关系统代理不算）' -ForegroundColor Yellow
} elseif ($ip) {
    Write-Host '  解析正常' -ForegroundColor Green
} else {
    Write-Host '  [警告] 解析失败，检查是否还连着校园网' -ForegroundColor Yellow
}

Write-Host '=== 4/4 调用学校接口（只读模型列表，不扣积分） ===' -ForegroundColor Cyan
Push-Location (Join-Path $root 'setup')
& $py tongji-control.py models 2>&1 | Select-Object -Last 3
Pop-Location

Write-Host ''
Write-Host '说明：若上面返回 ok=true，方源会在 2 分钟内自动切回 DeepSeek（熔断冷却上限 120 秒），无需重启。' -ForegroundColor Gray
Write-Host '若仍失败，把这段输出发我。' -ForegroundColor Gray
Write-Host ''
