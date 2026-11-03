# README 现状审计与证据

核对日期：2026-11-02（Asia/Taipei）。首次代码与测试基线：`2e8dc6440be831ce61b8a4e07e93bac0fa040b2b`；交付前更新至主分支 `a38ad1dcd35bd8fb9e2a89e7687934d684ae062f`，补读新合并的媒体交接与试听资料。本文件不是生产部署或效果验收报告。后续工作方法见[维护与接任](README_MAINTENANCE.md)。

## 原 README 的主要缺口

- 首屏直接提示生产隔离，随后列出架构术语和目录，普通访客尚不知道方源 Bot 是什么、为何值得了解。
- 人格、记忆、关系、原著检索、学习和发送前复核在源码中已有机制，但首页没有解释它们如何影响实际交流。
- 单行箭头未解释 DSH NEXT 与 Aurabot 的职责，也未区分资料输入、模型生成和复核输出。
- 缺少主分支、研发分支、部署与真实体验的分层；历史模块 README 中的群聊、素材数量、冷却和路径易被误当现状。
- 开发与安全入口有价值，应保留并后置；缺少可恢复的文档维护依据。

改写将首屏转为项目定位，以能力表解释用途，用简洁架构图解释职责，将动态证据移入本文件。未添加未经核实的徽章、截图、媒体、许可或完成百分比。

## 主分支能力的可定位依据

以下均相对于上述主分支基线。源码与测试证明机制存在，不自动证明生产效果；测试使用合成或隔离数据。

| 首页声明 | 实现入口 | 相关验证或范围 |
| --- | --- | --- |
| 人格与有效内核 | [人物卡](../src/fangyuan-agent/personas/gu-yue-fang-yuan.md)、[方源模块](../src/fangyuan-agent/modules/fangyuan/index.mjs)、[来源哈希](../src/fangyuan-agent/modules/fangyuan/core-provenance.json) | [人格管理测试](../src/fangyuan-agent/test/persona-admin.test.mjs)、[交流测试](../src/fangyuan-agent/test/conversation.test.mjs)；不代表永久不出戏 |
| 来源记忆、纠正与停用 | [记忆存储](../src/fangyuan-agent/modules/memory/store.mjs)、[适配入口](../src/fangyuan-agent/modules/memory/index.mjs) | [社交测试](../src/fangyuan-agent/test/social.test.mjs)、[模块组合测试](../src/fangyuan-agent/test/integration.test.mjs)；包括来源、场景隔离、持久状态 |
| 关系与跨场景抽象印象 | [学习入口](../src/fangyuan-agent/modules/learning/index.mjs)、[存储](../src/fangyuan-agent/modules/learning/store.mjs) | [学习测试](../src/fangyuan-agent/test/learning.test.mjs)、[消息语境测试](../src/fangyuan-agent/test/message-context.test.mjs)；私人依据保留原场景，不改变权限 |
| 批次判断与发送前复核 | [交流复核](../src/fangyuan-agent/modules/conversation/index.mjs)、[批次](../src/fangyuan-agent/modules/conversation/current-batch.mjs) | [当前批次测试](../src/fangyuan-agent/test/current-batch.test.mjs)、[决策测试](../src/fangyuan-agent/test/reply-decision.test.mjs)；仍有后续修复分支 |
| 原著检索与出处 | [检索模块](../src/fangyuan-agent/modules/lore/index.mjs)、[词法查询](../src/fangyuan-agent/modules/lore/search.mjs)、[本地语义服务](../src/fangyuan-agent/tools/lore_service.py) | [迁移与原著测试](../src/fangyuan-agent/test/migration-lore.test.mjs)；全文库不公开，检索命中不等于理解正确 |
| 有依据的主动回访 | [待续任务入口](../src/fangyuan-agent/modules/speakup/index.mjs)、[策略](../src/fangyuan-agent/modules/fangyuan/policy.mjs) | [社交测试](../src/fangyuan-agent/test/social.test.mjs)、[模块组合测试](../src/fangyuan-agent/test/integration.test.mjs)；授权、沉默与未知回执不重复发送 |
| 次日学习、研读与恢复 | [学习入口](../src/fangyuan-agent/modules/learning/index.mjs)、[worker](../src/fangyuan-agent/modules/learning/worker.mjs) | [研读修订测试](../src/fangyuan-agent/test/learning-revisions.test.mjs)、[学习测试](../src/fangyuan-agent/test/learning.test.mjs)；不据此声称全书读完 |
| 语音与表情接入 | [语音模块](../src/fangyuan-agent/modules/voice/index.mjs)、[信封](../src/fangyuan-agent/modules/voice/envelope.mjs)、[表情模块](../src/fangyuan-agent/modules/stickers/index.mjs) | [信封测试](../src/fangyuan-agent/test/voice-envelope.test.mjs)、[语音表达测试](../src/fangyuan-agent/test/voice.test.mjs)；语音依赖宿主与可用引擎，测试不证明音色或真人接收 |
| 媒体离线研发门禁 | [暂存与审核工具](../tools/media-staging/README.md) | stage / review 测试使用合成数据；候选保持不可发布，审核引用不等于授权事实 |
| 网关与前后台调用保护 | [网关](../legacy/qq-bootstrap/cloud_gateway.py)、[模型适配](../src/fangyuan-agent/modules/learning/model.mjs) | 学习测试包含假请求；真实路由由运行环境决定，本轮无模型调用 |

已检查[固定上游集成测试](../src/fangyuan-agent/integration/upstream.test.mjs)的入口：需要 `AURABOT_SOURCE_ROOT`，使用真实 Aurabot 源码与假 DSH、模拟 OneBot。它不是真实 QQ 发送测试，本轮未重跑。[实施记录](../src/fangyuan-agent/IMPLEMENTATION.md)中的旧 140 项与当前 `test:repo` 范围不同，不直接合并统计。

## 分支、PR 与部署分别判断

本轮读取 PR #1–#7 的元数据与正文，并核对远端分支提交及差异；未合并分支只作为研发状态，不列为主分支新能力。

| 项目 | 固定版本或记录 | 核对状态 |
| --- | --- | --- |
| 协作隔离与媒体暂存、审核 | [PR #1](https://github.com/Ming-zhishan/FangYuan/pull/1)、[PR #2](https://github.com/Ming-zhishan/FangYuan/pull/2)、[PR #3](https://github.com/Ming-zhishan/FangYuan/pull/3) | 已合并；对应源码已读，离线测试本轮通过 |
| 媒体交接 | [PR #4](https://github.com/Ming-zhishan/FangYuan/pull/4)，`fa147e5` | 已合并；[接任文档](MEDIA_HANDOFF.md)记录调度执行证据、听感与图片认可缺口；其中尚未合并的旧描述由当前 Git 状态校正 |
| 对话评测与接任 | [PR #5](https://github.com/Ming-zhishan/FangYuan/pull/5)，`5d9f9a1` | 草稿、未合并；评测流程不等于 Bot 效果验收 |
| 连发、插话与表达候选 | [PR #6](https://github.com/Ming-zhishan/FangYuan/pull/6)，`c05074b` | 草稿、未合并，基于 PR #5 分支；PR 记录完整输入修复部分已单独部署，真实互动验收待观察；亲近与情绪试验默认关闭 |
| 精简声线试听 | [PR #7](https://github.com/Ming-zhishan/FangYuan/pull/7)，`a469ee5` | 已合并；交接记录用户认为方向接近，但情绪不足、说话不流畅，局部返工后的效果仍待人审；不代表 QQ 发布许可 |
| 独立媒体工厂 | [固定提交](https://github.com/Ming-zhishan/FangYuan/tree/294fa3c) | 未合入主线；差异包含研究、审核与候选工具，不能介绍成已运行的持续生产系统 |
| 戳一戳互动 | [固定提交](https://github.com/Ming-zhishan/FangYuan/tree/9ee981f) | 未合入主线，默认不发送；不能作为已发布玩法 |
| 当前批次、原著缓存、语音回退修复 | `d632337`、`daf1625`、`d2599d5` | 相应修复分支未合入主线；仅凭分支不能推断部署与验收 |

## 运行环境只读核对

通过 Desktop Commander Remote 在授权设备上检查了实际工程根与协作目录的存在、运行配置的必要状态字段，以及部署 conversation 入口文件的 SHA-256。未执行启动、部署、数据库写入、QQ 发送或模型调用。

- 配置选择结果：Bot enabled 为 true；群白名单数量为零；复核、学习、主动回访启用；语音与表情启用，随机自动附加概率均为零。
- 配置中未出现 `ownerBond`、`affectTrial` 字段；PR #6 另明确记录这些试验默认关闭。字段缺失本身不能证明任何版本行为。
- 部署 conversation 入口文件 SHA-256：`4ca85bce346d880fc0c8036cb3f044c0d5529b680ec0ae7af5d021ae6c395848`。此哈希仅标识磁盘文件，本轮未据此证明进程已装载或与 PR 的全部五个文件一致。
- 本轮未读取私人聊天、生产记忆库或媒体原文件。未公开机器绝对路径、账号、凭据或原始配置；公开结论仅保留必要的脱敏状态。
- [多媒体工程铁则](MEDIA_ENGINEERING_RULES.md)的“仅私聊、媒体随机概率为零”与本次配置结果一致。旧模块 README 中群聊启用、说说频率和素材数不作为当前事实。

## 本轮验证与限制

- 独立克隆、独立 `docs/readme-project-overview` 分支，主分支基线如上；仅改根 README 与本轮两份文档。
- Node.js v24.18.0，`src/fangyuan-agent` 下运行 `npm run test:repo`：150 项通过，0 失败、0 跳过。覆盖默认模块测试及媒体暂存、审核；没有进行生产发送和付费调用。
- 主分支刷新后确认默认 Node 测试涉及的源码与脚本未变化，复用上述结果；另运行新合并的 `python tools/media-staging/voice_focus_test.py`，5 项通过，仅验证合成反馈的完整性与权限门禁。
- 三份文档的链接已解析核对：本地相对目标存在，首页导航锚点匹配；外部 PR 目标通过 GitHub 集成读取确认。Markdownlint 检查零问题（关闭长行与表格列宽样式规则）。
- Mermaid 已在本地 Chromium 中实际渲染；1280px 桌面和 390px 窄屏预览检查正文无横向溢出，宽表与代码块在自身区域滚动。已查看截图；这是本地近似预览，尚未进行 GitHub 页面本身的视觉验收。
- 暂存差异与敏感内容审计结果在交付 PR 中记录；人工复核仍是必要步骤。
- 事实核对以源码、测试范围、PR 和必要配置为依据；本轮无独立读者理解度盲测，无新真人对话或媒体体验验收。

## 后续待确认

1. 对话修复的真实连续互动效果；完整 DSH 同轮插话行为，以及情绪、亲近候选的人类体验。
2. 新声线的可懂度、自然度与许可范围；图片的母版保真、授权和指定私聊实际效果。
3. 外部媒体调度的当前执行证据；本次不建立或声称已有自动 README 维护。
4. 未合并分支后续状态与生产装载差异；需在下一次维护重新核对。
5. 第三方代码和原著、音视频素材的完整许可审核；本次不新增统一许可证或重写 Git 历史。
