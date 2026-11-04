# 模块接口、数据归属与变更约束

核对日期：2026-11-04；业务源码基线 `ba05ba1`。本文记录当前主线实现，供协作者判断改动影响，不是新的宿主 API。后续 PR #21–#25 的行为另按[当前状态](CURRENT_STATE.md#后续研发与本包范围)核对；源码位置与运行覆盖见[构建说明](MODULE_BUILD.md)。

## 模块怎样协作

宿主调用模块的 `setup(api)`，返回对象成为 `api.use('模块名')` 可取得的服务；事件、上下文、工具、定时任务和释放通过宿主注册。这里多数模块在回调执行时再取服务，不能把 `api.use` 的双向访问直接当成 ESM 文件循环导入，也不能只靠文件导入成功判断装载顺序正确。

| 提供方 | 当前接口 / 数据入口 | 主要调用方与约束 |
| --- | --- | --- |
| [fangyuan](../src/fangyuan-agent/modules/fangyuan/index.mjs) | `personaCore()`、回访判断与执行策略 | conversation / learning 取有效人物核心；speakup 委托判断，不能用人物关系代替工具权限 |
| [learning](../src/fangyuan-agent/modules/learning/index.mjs) | `permitted(scope)`、`store`、`reviewText(prompt)`、`publicRelationship(uid)`、`syncContact(uid, kind)` | conversation 取上下文与复核；memory 同步来源；live-guard 同步联系类别；缺失或未获许可时，各调用点按自身回退处理 |
| learning | `importSource(event, facts)`、`invalidateFact(source, text)`、`invalidateSource(id)`、`forgetSource(id)` | memory 传入可定位来源、更正与停用；来源编号、账号、场景和引文必须对应，不能为迁移编造来源 |
| learning | `loreContext(query, sources)`、`pulse()`、`status()` | lore 取带来源的研读资料；pulse 可能恢复历史、访问网络或调用模型，不能因其是服务方法就当作只读查询 |
| [memory](../src/fangyuan-agent/modules/memory/index.mjs) | `store`、`contextFor(chat, sessionId)`、`add`、`addEvent` 等 | speakup 读取待续任务；live-guard 留定向尝试记录；learning 压缩已入档热缓存。`addEvent` 是内部经历，不自动成为公开事实 |
| [live-guard](../src/fangyuan-agent/modules/live-guard/index.mjs) | `permitted(scope)`、`capabilities(chat)`、`ready()`、`refresh()`、`isFriend(uid)` | 调用方判断真实账号、会话和可用能力；refresh 会访问 OneBot。管理身份与普通会话权限分别核对 |
| [lore](../src/fangyuan-agent/modules/lore/index.mjs) | `search(query)` | conversation 只选已核事实锚点；学习产生的引文摘要保持其未逐条独立审阅的状态 |
| [stickers](../src/fangyuan-agent/modules/stickers/index.mjs) | `library()` | conversation / learning 使用素材目录或描述；选中不等于获得许可或已发送，runtime 的语义选择另有覆盖实现 |

表中列的是主要协作面，不是全部路由与工具的接口保证。`store` 仍暴露内部结构，属于现有耦合；修改前必须同时检查调用方和 runtime 覆盖，不能只改提供方。

## 两类存储分别负责什么

| 存储 | 当前管理模块及资料 | 修改和恢复时的边界 |
| --- | --- | --- |
| `social-v1.json` | [SocialStore](../src/fangyuan-agent/modules/memory/store.mjs)：来源事件、事实摘要、态度、待续任务、结果及内部经历 | `version=1`，同步修改持有文件锁；文件不存在才初始化，损坏或结构不符会抛错，不应以空文件覆盖 |
| `learning.sqlite3` | [LearningStore](../src/fangyuan-agent/modules/learning/store.mjs)：原始消息/引用、派生条目、关系、任务、缺口覆盖、外发记录、预算、研读与模型输出 | 使用 WAL、外键和 busy timeout；初始化使用建表逻辑，`user_version=1` 不等于已建立完整迁移框架 |
| 本地原著库、向量与媒体资产 | lore、learning 向量工具及授权素材环境 | 不随公共仓库或模块包交付，不把模型输出当作原著证据，也不擅自迁移私人资产 |

两套存储存在同步与回退：memory 观察真实来源后调用 learning 导入；learning 可从旧 JSON 导入，并在确认入档后压缩热缓存。learning 已获许可时，memory 的上下文减少重复来源，但仍保留抽象关系语气。这里没有“任意选一个库覆盖另一个库”的权威合并规则。

同账号可保留抽象关系倾向，具体消息、来源和私人依据仍按 `private:…` / `group:…` 场景隔离。`LearningStore.source(...)` 校验账号、场景、用户角色和逐字引文；`conversationFrame(scope, limit)` 返回本场景有效消息、引用与寻址信息，并过滤已停用来源附近可能复述隐私的回复。改查询条件时保留这些语义。

## 草稿、尝试与送达怎样区分

1. 接收 `message` 时记录真实用户来源；`reply` 钩子记录或复核生成内容，不能单独证明已经发出。
2. learning 在 `setup` 保存原 `onebot.call`，安装包装器；先等待原调用结果，仅对授权场景的 `send_private_msg` / `send_group_msg` 且有非模拟 `message_id` 的结果记为 `gateway_receipt`。
3. 回执后记忆写入失败会记录告警并返回原网关结果。消息可能已发出，不能当作未发再发送。
4. 主动回访、定向好友私信和补答各有尝试台账；具体状态名称不同。发送结果未知时保留尝试或 `unknown`，不自动重置为可重试。网关编号证明返回回执，接收侧体验另行验收。

只允许一个明确负责装饰底层发送接口的模块。当前卸载仅在 `onebot.call` 仍为本模块包装器时恢复原函数，避免覆盖后来安装的包装；但这没有解决任意多层包装的所有卸载次序。新增发送中间层须由平台与业务负责人共同检查。

## 失败、调度与释放

| 情况 | 当前行为 | 变更前检查 |
| --- | --- | --- |
| 交流复核不可用 | [conversation](../src/fangyuan-agent/modules/conversation/index.mjs) 在仍有许可时保留普通草稿，已识别人格漂移尝试修复；许可消失返回空 | 不将“复核调用失败”一概写成全部阻止发送；保留当前输入、对象和失败回退回归 |
| 学习任务失败或重启 | 读/模型任务可保留重试；初始化恢复中断任务，外发尝试不按读任务重置 | 不将未知外发结果与可安全重做的读取混为一类 |
| 学习正在运行时卸载 | 置 `stopped`，等待 `busy` 任务结束再关闭 worker / store / network；runtime 另关闭 budget guard | 不在进行中的任务仍使用 SQLite 时提前关闭连接；宿主定时注册的释放仍由宿主管理 |
| 定时任务与授权变化 | 学习、回访及私信在各自调用点检查最新许可、启用和 dryRun 条件 | 不能只在生成前核对一次；各路径的规则并不完全相同，按实际实现验证 |

后台模型适配、runtime 成本保护与 staged learning 是有意差异，不能因统一目录而删除预算、预约或调度逻辑。真实模型服务与账本不属于默认离线测试环境。

## 已知耦合与后续改法

| 当前问题 | 影响 | 后续可独立开展的改动 |
| --- | --- | --- |
| conversation 直接查询 `learning.store.db` | 群参与统计和旧上下文回退依赖 messages 表结构；PR #21 / #25 又在调整参与策略 | 待对应成果稳定后，由存储模块提供场景统计方法，先为现有许可、回执、停用过滤及时间边界建立契约回归，再替换调用点 |
| memory 与 learning 双向访问 | 来源导入、停用和缓存压缩跨两个数据结构，局部修改容易重复或丢来源 | 明确导入/更正/停用的输入输出与错误处理，再逐项收敛；不在布局整理中迁移生产库 |
| learning 直接包装 OneBot 调用 | 发送成功与落库失败、卸载顺序涉及宿主和其他模块 | 如宿主提供正式回执事件，先证明语义等价再迁移，不用 reply 事件替代真实回执 |
| 部分模块有 runtime 覆盖 | 基础改动可能被覆盖版本遮住 | 修改时核对覆盖文件、生成清单和对应回归；共享代码仍只保留在基础源 |

这些是明确保留的技术债，不表示本轮已消除所有内部耦合。本轮完成目录、来源与协作契约整理，避免把涉及活跃业务分支的行为重构夹入迁移。

接口 PR 至少说明：提供方、全部调用方、输入及返回值、失败与未知结果、数据兼容、装载/释放、基础与覆盖差异、验证范围和 README 影响。现有回归从 `src/fangyuan-agent/test/` 的 learning、social、conversation、live-guard、principals、turn-input 与 autonomous-cooldowns 等测试进入；默认统一运行 `npm run check`。固定宿主测试另按[接任指南](MAINTAINER_HANDOFF.md)，不指向在线实例。
