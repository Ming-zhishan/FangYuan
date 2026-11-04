# 协作入口

先阅读根 README、CONTRIBUTING、docs/CURRENT_STATE.md、docs/MODULE_OWNERS.md；文档与架构变更同时核对 docs/MAINTAINER_HANDOFF.md。

## 源码与产物

- 模块基础实现：`src/fangyuan-agent/modules/`；runtime 的有意差异/独有文件：`src/aurabot-runtime-overrides/`。
- `src/aurabot-modules/` 仅保留迁移导航，不能再添加第二套完整模块。
- 生成 `artifacts/` 不入 Git，不手改。构建、输入跟踪和行为差异见 `docs/MODULE_BUILD.md`。
- 人物卡与基础 core 保持完整正文同步；既有预算、调度、隐私、回执和冷却不因整理而取消。
- 历史源码集中在 `legacy/`；`src/qq-bootstrap/` 与旧 ops 仅留导航。复用前先读 `legacy/README.md`，检查隔离环境、调用者和副作用；默认阻止执行提示不是执行授权。

## 验证与交付

- 每个任务使用独立分支/工作树，开始时声明可写范围；不覆盖共享工作区、他人未提交文件或锁。
- 默认在仓库根运行 `npm run check`。专项测试需说明范围；固定宿主测试只能指向自己的隔离副本，不能指向在线实例。
- 构建只取跟踪文件；新增源码先暂存，再验证生成包及来源清单。提交前人工复核差异，执行 `git diff --cached --check` 和 `node tools/audit-staged.mjs`。
- 接口或存储变更先核对 `docs/INTERFACE_CONTRACTS.md` 的提供方、调用方、未知结果与释放语义。
- 每个 PR 说明 README 影响，更新相关章节及证据页，或写明无需修改的理由；留下验证、未解决项和下一接任入口。
- 不提交真实账号、聊天、凭据、数据库、模型、受限媒体、日志或私有路径；没有统一许可，不擅自补写 MIT 等授权。
- 合并不代表部署。生产配置、数据、QQ 发送、模型调用、重启和发布按各自授权执行；未验证层次不得写成通过。
- 共享数据、宿主适配或发送接口涉及多角色时先明确责任；尚未登记的实际接任人不自行推定。
