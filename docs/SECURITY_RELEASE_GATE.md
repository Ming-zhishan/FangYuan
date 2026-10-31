# GitHub 提交安全闸门

这份仓库包含历史脚本与源码快照。代码审查不能只相信 `.gitignore`，也不能把提交时间早的源文件默认视为安全。

- **禁止**上传真实 QQ 群号与个人标识、原始聊天记录、会话、Cookie、API Key、Token、密码、未授权素材、模型文件、数据库、日志。
- `config/project-paths.json` 是公共的相对目录映射；`project-paths.local.json` 是本机绝对路径覆盖，必须忽略。
- 已知历史混杂：`src/qq-bootstrap` 保留旧 MaiBot 工具与仍使用的云网关代码；运行前逐条排除真实外联和副作用。
- 准备提交时审核 `git diff --cached`，并运行 `node tools/audit-staged.mjs`。扫描只是第一道防线，出现 REVIEW 要逐条处理。
- `.aurabot-cache` 是模块工具生成的副本，不该作为源文件提交；保留不属于 Git 的本机运行缓存与生产目录。
- 不自动运行需要 QQ 登录、云 API、生产数据库或模型下载的脚本；离线测试只选 `src/fangyuan-agent` 的 `npm test`。
- 公开仓库的旧提交会保留被删除内容。涉及个人标识或密钥的历史泄漏不能仅靠新增删除提交修复。务必核查仓库可见性，必要时改为 Private、撤销/轮换凭据并拟定单独的历史治理方案。
- 尚未确认第三方库与原著素材的公开授权；维护者应核查来源和许可后决定发布范围。