# Git 协作与数据边界

## 代码与生产分离

- `src/fangyuan-agent`、`src/aurabot-modules`、`src/qq-bootstrap` 是研发用源码快照，不是机器人正在读取的唯一源码目录。
- `services/` 和 `runtime/` 是本机生产环境：模型、数据库、QQ 会话、密钥、NapCat 配置及日志，不得提交到 Git。
- `config/project-paths.json` 是可提交的相对路径公共映射；`config/project-paths.local.json` 包含 TJ 机器实际路径，已排除 Git。`config/project-paths.example.json` 可供协作者参考。
- `archive/`、`operations/migration/`、`research/media-catalog/` 包含历史数据和大型素材，默认不提交。
- 旧 `fangyuan-dsh` 源码内自带 Git 历史，仅作为本机生产归档保存；不要将其嵌套合并到未来新仓库。

## 建议工作流

1. 从 `src/` 进行开发，在独立环境完成静态检查与本地测试。
2. 运行 `node operations/check-source-drift.mjs` 对比源码快照与生产目录。
3. 对拟上线代码进行人工差异审查，备份受影响的配置和数据库，然后有控制地部署。
4. 检查 `.gitignore`、`git status`、`git diff --cached`，再决定哪些文件允许提交或发布。
5. 不得把 QQ 账号会话、聊天原始记录、Token、API Key、含授权信息的日志或模型下载凭证上传公开仓库。

当前尚未执行 `git init`、`git add` 或任何远程推送。迁移现场代码扫描未识别到常见格式的硬编码 API Key，但正则扫描不等于完整安全审计。