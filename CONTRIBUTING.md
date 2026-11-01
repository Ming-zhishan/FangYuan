# 协作规范

**多媒体开发必须先阅读 [多媒体工程铁则](docs/MEDIA_ENGINEERING_RULES.md)，并以实际验收证据与当前“仅私聊”安全边界为准。**

1. 请先阅读 README、[Git协作与安全边界](docs/Git协作与安全边界.md) 和 [安全闸门](docs/SECURITY_RELEASE_GATE.md)。
2. 新功能、修复、文档分别在 `feature/*`、`fix/*`、`docs/*` 分支提交 PR；每个独立开发助手使用自己的工作树。
3. 解释改动对 DSH NEXT、Aurabot、NapCat、Ollama、云网关的依赖，注明源文件与镜像模块同步要求。
4. 在 `src/fangyuan-agent` 运行 `npm run test:repo`，执行仓库的离线测试。写清没有验证的线上行为。不能主动发送 QQ、调用付费模型或修改生产数据库。
5. 提交前运行 `node tools/audit-staged.mjs` 并人工复核全部差异；生产部署需单独授权、备份和回滚计划。
6. 不在 Git 中保存个人数据、真实 QQ 标识、聊天记录、凭证、私有绝对路径、未授权媒体或运行缓存。
7. 当前尚无适用于全部源文件的统一再分发许可，未经来源和许可审查不得默认将第三方内容视为自由开源。
