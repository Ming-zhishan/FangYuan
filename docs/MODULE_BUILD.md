# 模块源码、运行差异与构建

本分支后续已接入PR21–23及PR25共同所有者，runtime现56模块文件；下文51/46与“后续未纳入”是PR24迁移时的历史基线。当前组合与授权运行目录的55项源码/资料一致，API.md为生成说明差异；统一构建产物仍不自动部署。

核对日期：2026-11-03。基础源码只维护于 `src/fangyuan-agent/modules/`；`src/aurabot-runtime-overrides/` 只保留运行差异与运行独有文件。旧 `src/aurabot-modules/` 只提供迁移导航，不再是装载目录。

## 从哪里修改

| 内容 | 维护位置 | 规则 |
| --- | --- | --- |
| 共享模块、人物核心与默认测试基线 | `src/fangyuan-agent/modules/` | 同一共享实现只维护一份 |
| 六处行为差异及运行独有支持文件 | `src/aurabot-runtime-overrides/` | 只放有意差异；与基础源码相同的覆盖会使构建失败 |
| 已审阅人物正文 | `src/fangyuan-agent/personas/gu-yue-fang-yuan.md` | 修改后用现有 Python 工具核对或同步基础 core，产物继承同一完整正文 |
| 默认关闭的配置模板 | `src/fangyuan-agent/config.patch.json` | 不放实际账号、凭据或生产配置；全局关闭并保持 dryRun |
| 生成包 | `artifacts/` 或明确指定的新输出目录 | 不入 Git，不手改，不作为新的维护源 |

运行差异仍是 conversation、fangyuan、learning 的入口、learning store / worker、stickers 入口。它们分别保留复核压缩/表达差异、通道规则、成本保护、上下文、后台调度和语义选图；本次目录整理没有替用户重新选择这些行为。预算、语义选择器及宿主接口资料保留在覆盖目录。

## 构建与检查

要求 Git 克隆、Node.js 22.13+；CI 使用 Node.js 24。完整离线检查另需 Python 3.12。没有外部 npm 依赖，不需要登录 QQ、配置模型、下载原著库或先运行生产脚本。

```powershell
# 仓库根：Node、Python、合成评测与人物同步检查
npm run check
# 默认只校验输入、输出计划，不创建文件
npm run build:modules
# 明确选择运行差异，创建一个全新的独立包
npm run build:modules -- --profile runtime --out artifacts/runtime-modules
# 默认研发行为也可独立导出，用另一个新目录
npm run build:modules -- --profile development --out artifacts/development-modules
```

输入来自 Git 跟踪清单，内容读取当前工作文件。新增源码须先暂存才能进入构建；未跟踪文件不会被误打包。已有源码未提交的改动会体现在包内，manifest 的 `source_dirty` 标注选定输入的状态。正式交付需核对干净工作树、提交和实际哈希，不能只相信提交号。

产物包含 `modules/`、`personas/gu-yue-fang-yuan.md`、关闭的 `config.patch.json` 与 `manifest.json`。清单逐文件记录来源和 SHA-256，并给出内容摘要；文本统一为 UTF-8 / LF，不写当前时间，重复构建同一输入可得到相同内容。runtime 保留 51 个模块文件；development 保留 46 个，包含研发专用表达样例。

已有输出一律拒绝覆盖，重新构建请指定另一个新目录。构建也拒绝输出到仓库内的源码、工具、配置、运维、运行服务或 Git 元数据及其链接别名中。链接、非文本输入、受限路径、人物 core 不一致及全局开启的模板都会阻断；出现写入错误时可能留下本次新建的不完整目录，先检查该目录，不自动重用或清理他人输出。

## 迁移验证与装载边界

本次从冷却保护已补齐的基线迁移：删除了 39 份完全共享副本，12 份有意差异/独有文件保留原文。生成的 runtime `modules/` 与迁移前 51 文件逐项 LF 字节一致，没有借搬目录改写业务。默认输入回归现在直接加载新生成包，测试不会再去旧快照目录找实现。

构建测试覆盖覆盖规则、样例排除、独立导入、重复构建、人物同步、模板关闭、输入隔离、输出保护和整个运行模块集的导入。固定宿主集成仍使用获授权的上游源码副本与假 DSH / OneBot；源码、集成、生产装载及长期真人效果分开验收。

包不是完整 Bot 安装，也不会复制文件到生产、重启或发送消息。宿主、实际配置、私有数据、原著库、正式媒体和发布/恢复授权另行交接。生产 API.md 可能由宿主再生成，仓库中的 API 是接口快照，不以文档哈希差异推断业务漂移。

runtime 指当前已入库基线的运行差异，不是“自动追随生产”的别名。后续 PR #21–#23 尚未纳入，最新只读复核已发现四个运行代码文件不同，见[当前状态](CURRENT_STATE.md#后续研发与本包范围)。这些后续成果不得被旧包覆盖；迁入时应保留其授权与验收范围。

## 差异检查与后续维护

`operations/check-source-drift.mjs` 默认用 `artifacts/runtime-modules/modules` 对比授权运行目录；可显式传 `--runtime-modules NEW_BUNDLE/modules` 比较本次新包。先确认包来源和内容摘要，再按[运维说明](../operations/README.md)检查；差异工具默认不写入、不自动同步。

后续对话/媒体分支若仍修改旧快照，应先对照本页迁回基础源码或有意差异位置，再回归生成包，不把旧路径重新变成第二套完整维护源。已存在的其他工作树和生产目录未移动；本轮原作者草稿 PR 的合并与关闭仍由其原流程处理。
