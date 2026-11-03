# 自己动态评论回复与聊天恢复（2026-11-03）

## 已运行与验收边界

独立分支 `feature/qzone-comment-replies-20261103` 接续 PR22，不合并或覆盖 main。自己空间的评论及楼中楼自动回复已启用；实际一条评论发送后独立回读成功。用户明确否定该回复对“糖／🍬”的理解及说教风格，因此**送达通过，回复质量未验收**。没有为纠错删除或重复发送该评论。

另一项故障是主人私聊连续 503。真实消息已进会话，网关报告 `school_reasoning_exhausted`，代表有推理而无正文，不能解释成余额耗尽。会话还记录了压缩上下文溢出；私聊沿用默认 65536 压缩输出，既有 2048 配置仅覆盖 social。两者是已观察到的问题，尚不能证明所有 503 都由同一原因造成。

已将三个 QQ 预设的压缩输出改为 8192；private/private-long 保留原工具、人格、预设身份。首次仅提供局部 config 导致 `Unknown agent preset`，已纠正为完整继承定义并加入离线反例检查。修复配置后旧长会话仍失败，随后仅归档故障主人会话、启用带近期真实记录的新会话；原始聊天、长期记忆及关系数据库保留。21:28:10 的真实私聊回复及 21:24:27 的自然群聊回复均获独立消息回读。私聊补答为模型实际生成；并非操作者拟稿。长会话再次达到压缩阈值后的稳定性仍待观察，不能以这次成功证明永久修复。

## 现有能力及本次新增

- 原有 DSH/Aurabot 自带空间互动，但生产开关关闭；旧网关 4.18.38 返回 1404 不支持空间列表。旧实现的回复未传父评论参数，隔离反例失败，不能只开启权限开关。
- 使用官方 NapCat 4.18.42，验证安装包大小及 SHA256；备份原文件并演练还原。保留配置、账号、本地 QQ 安装及自定义加载器，仅重启 Bot 自有进程。私人 QQ 未关闭。
- 新 `qzone-social` 用户模块替代同名 builtin。仅回复自己动态，不自动浏览朋友动态、点赞或发好友动态评论；未扩大管理或电脑权限。
- 会话、复核、空间共用 `conversation/modern-context.mjs` 的公开语言知识选择器。糖包括字面、CP 甜互动及“唐”的谐音调侃；需联系原文和反讽，不能只见表情就默认送糖或恶意。纳内按已确认用法理解为纳尼变体。此包为人工核验知识，**不是已经运行的全网热梗滚动抓取任务**。

## 空间输入、处理与存储

入口为两套模块目录的 `qzone-social/index.mjs` 和 `replies.mjs`。每 60 秒读取自己动态，完整分页读取评论及楼中楼，按新发言汇总当前公开讨论，并传入有效人格及已核验的账号关系。生成使用 `runSystemTurn(...,{noTools:true})`；系统会话不注入私人聊天或记忆。共享的 `modernContext` 只返回公开词义，不能返回私有 observed lessons。

生成后再次读取父评论及上下文；内容或权限改变则弃稿。`comment_qzone` 绑定真实 tid、父评论 ID、父作者及被回复者，不用昵称猜身份。发送间隔 30 秒，无每日回复条数上限；扫描周期不代表每分钟都会发言或调用模型。

本地 `modules-data/qzone-social/qzone-comments-v1.json` 保存来源、attempt 和回读结果。发送前原子保存 attempt；回执不确定时不自动重发，只有读到实际同父帖、同发件人、同正文及正确目标的回复才确认。去重依据账号、tid、父评论及来源类型/ID；短期 feed_ref 更新不能使旧来源重复。根评论和楼中楼数字 ID 相同也分开识别。失败不能清账冒充未尝试。

全局兼容路由：`/qzone/social/state`、`/qzone/social/preview`、`/qzone/social/run`。前两项用于读取；run 是实际操作，不能用于无授权的生产试验。关闭 `qzoneSocial.enabled/replyOwn` 可停用；回滚代码须检查部署后漂移，不能回滚消息数据库或擦除 attempt。

## 可复现检查

在 `src/fangyuan-agent` 执行：

```powershell
node --test test/qzone-replies.test.mjs test/modern-context.test.mjs test/conversation.test.mjs test/qq-compaction.test.mjs test/response-style.test.mjs test/turn-input.test.mjs
```

真实宿主隔离测试使用已有 `integration/qzone-replies.test.mjs`：设置 `AURABOT_SOURCE_ROOT` 指向已验证的原生 fork，`FY_TEST_MODULES_ROOT` 指向精确生产模块组合副本，执行 `node --test integration/qzone-replies.test.mjs`。它使用假 QQ、假模型和新数据目录，私人 canary 不得出现在公开生成的 text/ctxText，且只能写一次正确父评论。**不得把这两个路径设成生产数据目录。**

`tools/dialogue-quality/qq-compaction-patch.json` 是当前 Windows 原生 fork 的完整 private/private-long 预设覆盖样例。应用前核对上游版本和原工具集，保留同期自定义；不能只保留 plugins 而丢 config.id，也不能直接覆盖整个生产 profile。social 已有完整自定义预设，只修改其中 summary maxTokens。修改后要实际确认三种预设仍可解析；离线校验通过不代替宿主加载验收。

最初空间父评论反例、实际发送、升级/回滚备份、503 会话记录、配置失败、恢复回执及模型原始输出均留在授权环境的 `tools/qzone-comments/private/`，不进 Git。运行时数据和任务数须重新查询。

## 小规模语义检查及遗留

一次受控模型调用覆盖六项合成场景：字面糖、CP、明确反讽、格言后单表情、无充分语境表情、纳内纠错。检查具体 interpretation 与回复，不只给总分。模型区分了候选义，也保留了两项歧义；个别回话仍生硬。该检查是研发人员逐项审阅，尚无独立人工校准，不能替代用户对真人风格的验收，也未验证所有热梗。

优先遗留：观察新长会话压缩及自动私聊稳定性；根据后续真实反馈补有价值的梗义回归；查清旧长请求的无正文原因与原有学习任务阻塞。没有开发新的收费批量评审或独立抓取调度系统。遇到模型错误须保存原失败，控制重试；历史回复是否缺失以真实回读为准，不能靠在线状态判断。

来源：[NapCat 空间功能实现 PR2124](https://github.com/NapNeko/NapCatQQ/pull/2124)、[4.18.42 官方版本](https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.42)、[北京日报对“唐”等用法的报道](https://xinwen.bjd.com.cn/content/s684117aae4b0ec1c3d9801ad.html)。词义报道不证明某个具体发言人的真实意图。

## 后续用户决定：篇幅随内容变化（21:42 热更新）

用户明确要求有时多几句、有时一两句，不采用固定回复长度或长短轮换。现有人格正文已表达随事情变化，本次保留人物正文不变；发现实际群聊宿主提示仍含“一般说一两句就好”，空间生成也含“通常一两句”。

新增 `conversation/response-style.mjs`，仅替换识别到的宿主群聊提示尾部，不改用户正文或引用；私聊/普通steer不匹配则原样通过。生成规则与发送前复核共用按内容、情绪和期待决定篇幅的说明，空间取消默认两句。多问题要接全，短招呼可以短接，不强制反问、金句、多气泡或刻意凑长。该调整不增加群发言频率或改写人格/记忆。

最终20项相关单测、2项真实宿主隔离集成通过，覆盖原文/媒体/引用保留及实际群提示和复核不再强制两句。仅热重载conversation/qzone-social三文件，配置和其他源文件哈希保持。模型或真人对这次篇幅变化的自然度尚未验收，没有为此新增模型批评测。

GitHub草稿：[PR23](https://github.com/Ming-zhishan/FangYuan/pull/23)，基于PR22，未合并main。公开提交9184add曾经干净导出、14项单测和1项真实宿主隔离集成复现通过；后续篇幅变动另按上述20+2记录，不把旧导出测试冒称为新提交的干净检出测试。
