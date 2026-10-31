# FangYuan｜方源 QQ Bot 统一工程

**物理主目录：`E:\FangYuan`**（Windows TJ）。原入口 `C:\Users\18859\Documents\FangYuan` 为 NTFS 目录联接，仍可打开相同文件。

2026-10-31 已将 QQ/NapCat/Ollama 运行环境、DSH NEXT 程序副本、Aurabot/DSH 生产数据库、人格源码和多媒体工程整合到 E 盘。迁移时曾停机，现已重新运行，并通过本机端口、QQ 在线与 DSH 监督检查。

## 目录职责

| 目录 | 内容 | Git |
|---|---|---|
| `src/fangyuan-agent` | 方源人格与 DSH 扩展源码快照 | 可审查后提交 |
| `src/aurabot-modules` | Aurabot 模块源码快照 | 可审查后提交 |
| `src/qq-bootstrap` | QQ 启动、云网关、监督和验证脚本的开发快照 | 可审查后提交 |
| `services/qq/work` | **真实生产 QQ 工程**：NapCat、模型、Python、私有配置 | 忽略，严禁提交 |
| `services/dsh/work` | **真实生产 DSH 工程**：Aurabot、记忆数据库及工具 | 忽略，严禁提交 |
| `services/dependencies/dsh-next` | 随工程保存的 DSH NEXT 程序依赖副本 | 忽略 |
| `runtime/qq-stack` | 指向 `services/qq/work` 的内部目录联接 | 忽略 |
| `runtime/dsh-live` | 指向 `services/dsh/work/dsh-runtime` 的内部目录联接 | 忽略 |
| `research/media-catalog` | 媒体、语音、表情素材工程（实文件） | 忽略 |
| `operations/legacy-tools` | 指向 DSH 历史工具目录的内部联接 | 忽略 |
| `archive/legacy-releases` | 指向历史交付的内部联接 | 忽略 |
| `config` | 公开模板、机器私有路径映射 | 仅模板可提交 |
| `docs` | 架构、迁移与协作说明 | 可提交 |
| `operations/migration` | 搬迁脚本、核验记录、恢复证据 | 忽略 |

**生产状态与开发源码隔离。** 在 `src/` 修改代码不会自动写入 `services/`；部署须经过检查，尤其不可用开发快照覆盖学习数据库。生产人格、凭证、QQ 数据、日志、模型权重与备份不可放进 Git。

## 本机常用命令

```powershell
cd E:\FangYuan
.\operations\enter.ps1
node .\operations\verify-layout.mjs
node .\operations\check-source-drift.mjs
```

机器人生产启动入口：`services/qq/work/setup/start.ps1`；监督启动：`services/qq/work/setup/start-managed.ps1`。两者以 E 盘目录布局运行。请勿执行旧的模拟部署或预生产测试切换脚本。

## Git 协作

根目录尚未初始化 Git，也没有上传 GitHub。未来可以在此根目录初始化；`.gitignore` 排除了 `services/`、`runtime/`、`archive/`、多媒体原文件和迁移证据等。初始化或推送前仍需人工复核敏感数据。协作说明见 `docs/Git协作与安全边界.md`。

路径、迁移报告与回滚保留策略参见 `docs/物理迁移与运行验收_2026-10-31.md`。