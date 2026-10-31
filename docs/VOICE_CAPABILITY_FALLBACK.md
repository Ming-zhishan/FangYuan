# 方源语音：Windows 本地声线能力与原生 TTS 回退

## 已确认事实

2026-10-31 TJ 的 System.Speech (SAPI) 注册声线为 Microsoft Huihui Desktop、Microsoft Zira Desktop、Microsoft David Desktop；没有配置默认的 `Microsoft Kangkang`。此前 `preferLocalMale=true` 会在未确认 Windows 语音安装的情况下直接声称本地 TTS 可用，最终调用 `SelectVoice(Kangkang)` 时可能失败。

## 本次代码修复

`src/fangyuan-agent/modules/voice` 与 `src/aurabot-modules/voice` 均维护一致的 `capability.mjs` 和 `index.mjs`。

- 只有 Windows、明确开启 `ext.voice.preferLocalMale`、且 `windowsVoice` 精确匹配本机已安装 SAPI 声线时，才走原有本机合成。
- 声线未安装、查询失败、非 Windows 或没有打开偏好时，不再伪称本机可用，调用 **Aurabot 原生 local.active / local.call** 路径。原生 TTS 的真正可用性仍由其自身决定。
- 声线列表使用隐藏、非交互 PowerShell 只读命令检查，超时三秒，最多每十分钟刷新一次，不调用付费模型。
- 不自动安装声线、不替换为英文男声/中文女声、不克隆真人声音、不改变现有语音封装与媒体配置。
- 这次只是 Git 功能分支；未部署或修改正在运行的 DSH/Aurabot 模块。

## 测试和上线边界

`cd src/fangyuan-agent; npm test` 包含假声线缺失、显式已安装匹配、PowerShell 失败关闭、双模块镜像一致性与缺失时调用原生 TTS 的离线回归。

上线前还需在隔离/授权环境确认原生 TTS fallback 的真实语言、男女声、稳定性及单次 QQ 语音播放，不得把这些尚未验证的行为当作已通过。实际语音发送须另行许可，并遵守研究音轨及真人配音许可限制。
