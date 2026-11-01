# 多媒体研发：接任入口与工作流

本文件是 GitHub 中唯一的多媒体接任入口，维护日期：2026-11-01。先读[工程铁则](MEDIA_ENGINEERING_RULES.md)，操作细节复用[媒体工具说明](../tools/media-staging/README.md)，不另建重复“最终版”。日期和数字都是快照；新会话必须重新读取实际 Git、配置、队列与运行证据。

## 1. 接手顺序与范围

1. 核对仓库默认分支、本文及媒体专项分支/PR；使用自己的独立工作树，不在共享 main 或他人工作树开发。
2. 读取 [README](../README.md)、[协作规范](../CONTRIBUTING.md)及[安全闸门](SECURITY_RELEASE_GATE.md)。架构为 QQ → NapCat/OneBot → DSH NEXT/Aurabot → 方源扩展 → 本地/云模型与原著检索；旧 MaiBot 不是当前主框架。
3. 已授权的 TJ 环境优先后台只读访问。通过[相对路径映射](../config/project-paths.json)和本机 gitignored 的 `project-paths.local.json` 找实际根；若本机覆盖文件缺失，核实本机项目总根及 junction 目标，不能在新克隆中假造生产路径。媒体研究相对根为 `research/media-catalog`（下称 R），协作目录的私有审计根为 `_local-audit/media-factory-20261101`（下称 A）。
4. 读取 A 的 `CURRENT_DELIVERY_STATUS.md`、`MEDIA_STAGE6_FINAL_ACCEPTANCE.json`、`CURRENT_REVIEW_META.json` 和 `LATEST.json`，核对所指文件、哈希、数据库与日期；历史报告不能代替实时值。
5. 检查工作树、进程、独占锁和外部调度的写入归属。源资料只读；无唯一写者时只生成独立副本。先执行第 6 节的小范围离线检查，再选择最小未完成任务。

本角色只负责语音、表情/GIF、热梗/原著素材研究、质量验证和必要媒体接入。不接管聊天复核、人格/记忆/关系、模型与 QQ 网关、成本治理。生产集成由指定负责人逐批授权，媒体侧交付来源、许可状态、哈希、标签、场景及离线证据。查阅他人模块不构成修改授权。

## 2. 来源、筛选与更新

| 来源 | 既有方法与代码位置 | 核验要求 |
|---|---|---|
| 热榜 | R 的 `meme_pipeline_lab/trendradar_research`；TrendRadar/NewsNow 聚合抖音、微博、B站热搜、贴吧、知乎、虎扑、酷安、百度、今日头条 | 榜单只作发现，不是已找到原图；核实原帖/原视频、传播语境与采集时间 |
| 梗Wiki | R 的 `meme_pipeline_lab/meme_pipeline.mjs`、`wiki_enrichment.mjs`、`hotmeme_research_v2.mjs`；公开API `https://cnmeme.wiki/api/v1/public/memes` | 分页/schema校验；slug增量；updated_at不等于梗起源或真实热度 |
| B站语境 | 同目录 `bili_candidate_context_v2.mjs` 等；view/标签/热门/评论公开接口 | 投稿者、日期、互动量、评论样本与画面分别核实；不能以热门评论抽样冒充完整观众意见 |
| 原图/GIF | R 的 `meme_pipeline_lab/originals`、A 的 `external_meme_references_v1` | 真实文件、来源、SHA-256、尺寸/格式/GIF帧与许可；封面和报告截图不代替母版 |
| 原音与原著 | R 的 `sources.jsonl`、`research_audio_manifest.jsonl`、`asr_drafts`、`asr_crosscheck`；`build_novel_alignment.mjs` 等 | 音轨hash/字节、时间码、说话者、章节上下文；区分旁白、二创、标题和角色直接台词 |

策略：7日重点追踪、30日观察，近期/经典约70:30且服从质量；不是每日配额。新鲜度分层有既有代码，持续趋势分析仍需足够多时点。跨平台语境核实是编辑要求，不等于九个平台都已直接抓取原帖。

| 更新机制 | 2026-11-01可证实状态 | 不能推论为 |
|---|---|---|
| 九平台采集、增量工厂 | 已有离线运行数据库和两轮周期报告 | 长期无人值守自动采集 |
| 每6小时采集 | 尚未恢复到可验证的调度配置及连续执行证据 | 已部署运行；也不能断言外部平台无任务 |
| 每日“方源热梗图库续建” | 历史文档记载已启用；当前外部任务ID、周期、最近结果未核实 | 当前正常运行；不要擅建第二个任务 |
| 本地TrendRadar调度 | 两份配置 schedule.enabled=false；通知、AI分析、RSS关闭；本地留存45天 | request_interval=1800并不是6小时调度规则 |
| 用户反馈 | 声音选择导出/导入已离线测试；真实偏好待取得 | 自动许可、自动发布或已完成审美定稿 |

失败处理：旧 DailyHotApi 三源实际失败，记录于 runs 表，改用上述已核实来源；TrendRadar默认初次请求加最多2次重试、10秒超时和随机退避。整轮工厂失败保留 FAILED-*、不推进LATEST；未证实外部自动重试已部署。恢复调度时必须记录任务平台/ID、时区、周期、启动命令、写入根、失败策略、最近执行及输出证据；先协调旧任务，不覆盖他人调度。

## 3. 既有程序与数据结构

主线已有 [stage.mjs](../tools/media-staging/stage.mjs)、[review.mjs](../tools/media-staging/review.mjs)：只读来源、输出隔离候选/审核队列，不合成、不发送QQ。输出需要工具README规定的任务所有权标记，禁止覆盖输入或旧输出。

后续工厂/合成/单页工具**仍在未合并的媒体分支**，不可假设普通主线克隆已经有这些文件。固定源码依据为 [294fa3c 的工具目录](https://github.com/Ming-zhishan/FangYuan/tree/294fa3c0fe8c62ff3e88e06672795fcfd0b84a71/tools/media-staging)，其中README包含具体CLI参数：

- `run_factory_cycle.py`：独占锁、隔离爬取→只读影子→事务增量→原子LATEST；相同源快照跳过，不是调度器。爬虫超时240秒，影子/工厂各70秒。
- `source_shadow.py`：只读SQLite backup及原媒hash复制；不checkpoint源数据库。`factory.mjs`全量读新闻库，不只读top20预览；敏感线索搁置、发布权限关闭。
- `synthesize_f5.py`、`asr_voicepack.py`、`audio_qa.py`、`build_voice_pack_index.py`：参考hash、确定性seed、本地零样本合成、ASR辅助和PCM质量索引；不是已训练专属声纹模型。
- `face_edit_fidelity.py`、`examples/face_edit_targets_v1.json`：允许编辑范围和画布检查，不代表人物自然或已获使用许可。
- `make_acceptance_entry.py`、`import_human_reviews.py`、`publish_review_entry.py`：统一试听、hash绑定反馈、浏览器QA后推广固定入口并保留回滚。

非Git历史研究脚本先核对读写范围及旧绝对路径，不能把存在当作可安全执行。不得直接为“复验”运行旧导入 --commit、清理/迁移或覆盖来源清单脚本。

| 存储 | 核心结构与去重 |
|---|---|
| R/meme_pipeline_lab/research.sqlite3 | topics、wiki、templates、runs；platform+URL/title标识，wiki slug唯一UPSERT；模板含visual_confirmed、rights_status、stage |
| A/LATEST.json指向的factory.sqlite3 | processed_snapshots快照hash唯一；leads按platform+URL+title标识，first/last_seen与observations；original_media的SHA-256唯一，默认production_ready=0；不是跨平台同事件语义去重 |
| TrendRadar output_live/news 的日期库 | news_items、rank_history、crawl_records、crawl_source_status；用真实采集记录核实更新 |
| R的来源/音轨JSONL与A的语音索引 | ID、相对文件、来源、SHA-256、字节/音频指标和审核/许可状态；旧49/11报告不覆盖新来源 |

依赖：Node≥22.13（node:sqlite）；需要制作时再核对Python、Pillow/NumPy、F5/torch、离线Whisper及TrendRadar独立环境；本批离线测试无需安装模型或访问私人媒体。数据、模型、音视频、真实标识和日志不上传Git。获授权后从本机映射读取；缺环境则标记阻断，不索取可从本机找到的资料。

## 4. 制作、审核与发布

语音：来源/许可→原著与台词/说话者筛选→合成或编辑→文件hash、24kHz单声道PCM16等目标规格、削波/可懂度检查→少量真人听审→默认禁用素材索引→现有OneBot离线封装→另行授权的指定私聊实测。复用 Aurabot voice.speak、normalizeVoiceEnvelope及R的qq_voice_media_adapter，不重造TTS或发送系统。拼音90%/100%不是同音词正确率、音色质量或许可证明。

表情：热梗/经典→真实原图核源→只改允许的人像局部→范围/结构/GIF逐帧检查→人审是否自然、保留原梗且有趣→场景标签与语义选图测试→批准的幂等入库/备份→受控私聊验收。动物、玩偶、包装、纯文字保持原版；>24帧真人动作按既有编辑门禁暂缓，不强行批量换脸。

| 状态 | 最少证据 |
|---|---|
| 研究候选 | 可追溯来源、采集时间、权利及待核项；不能上线 |
| 已生成文件 | 文件可读取、hash/来源绑定；不等于合格 |
| 离线合格 | 明确测试范围/结果；不能冒充真人满意或QQ送达 |
| 真人审核通过 | 具体候选与hash、真实听感/视觉反馈；不能冒充许可或发布批准 |
| 生产部署/送达 | 单独批准、版本/备份、实际加载与指定接收回执、回滚记录 |

严肃话题抑制、冷却与重复惩罚继续沿用。autoChance=0仅关闭对应概率，不能据此推断显式工具或语义pickForReply绝不会发送。新素材未许可/未审美认可时禁止自动发布。

经验：旧“训练完成/286成品”等看板无完整证据；C01参考因转录不符拒用，C02用于零样本研究；极短接话漏字已做少量长句替代，不重复扩量。Kangkang缺失不等于全部TTS失效；fix/voice-capability-fallback单独核对。旧ASR记录有ctranslate2版本崩溃与PyAV参数兼容修复，不随意升级全局环境。图像工具曾未收到真实远程像素而返回错误成品；须实际加载原图、编辑后核验画布/ROI，不能用提示词或范围报告冒充作品。

## 5. 当前交接快照与下一步

主线基线 `2e8dc64`；媒体研发 `feat/media-factory-isolated-v1` / `294fa3c`，仍待单独PR。PR #1/#2/#3已合并；本批文档分支 `docs/media-handoff-batch1` 只包含接任说明，不夹带三条待合并媒体功能提交。以后以实时refs/PR为准，不默认要求用户pull。

- 51来源、13研究音轨；最近只读恢复13/13哈希匹配。37条F5合成研究语音有统一索引；33/37拼音≥0.90、3条新替代100%；真人批准0。原创的是聊天台词，不是独立原创声纹。
- 既有用户声音授权声明已在R保存（后续声明优先于旧“未授权”报告），不反复索取同一确认；具体条款未独立查验，配乐/原著/图片/公开再分发分别核对。
- 已有37条OneBot离线往返证据，未进行本批QQ实发。生产历史库存32、选择器有部署记录；不是新候选全部上线。
- 原工程合格局部人像改图0。续任者私有交付另有2张实际生成且范围检查通过的候选、含声音/图片反馈的浏览器已测草案；未入Git、未获用户认可、未推广TJ固定入口。获授权后在本机交付目录找图片清单、ASSET_RECHECK和浏览器QA，缺文件不得计数或重生成冒充恢复成功。
- 重要数据分叉：LATEST链253条，旧factory_cumulative链398条；重合246，旧独有152、新独有7。两条历史不得相加或覆盖；扩展更新前先核对快照谱系、制定无损衔接。
- 固定用户入口为A/START_HERE.cmd→CURRENT_REVIEW.html，当前V4。用户找入口困难，验收集中最后提供可点击入口、少量重点候选，允许跳过/都不满意；技术检查由助手承担。

语音优先更新（2026-11-01）：[PR #7](https://github.com/Ming-zhishan/FangYuan/pull/7)，分支 feat/voice-direction-review-v1 / 60d2043。新增 build_voice_focus.py、voice_focus_template.html 及反馈校验测试，复用原声和3条既有候选，共15.433秒，仅线性增益至RMS 0.1，非LUFS归一化，不改音高/语速；不新增合成。4段浏览器实际解码/播放、反馈保存/导出/导入及篡改拒绝通过，门禁测试5/5，四个预览hash可重建复现。用户已确认方向接近，但反馈情绪不足、说话不通畅；已局部合成3条返工（同句节奏A、同句换参考B、接话改写C），时长2.581/3.211/2.859秒，独立转录拼音3/3为100%、浏览器播放通过。新版本的情绪和自然度仍待人审；delivery只是元数据，实际参数/参考与经验详见PR #7工具README，不以标签或ASR冒充情绪改善。该PR尚未合并，详细CLI与数据边界见其工具README；音频留授权本机。

下一步依次：最小听感/图片反馈→针对具体问题修复→安全接入固定验收入口→媒体功能PR与许可审核→单独授权的QQ实测。并行只读恢复每日任务与6小时调度证据、处理增量链分叉；没有证据就保持未验证，不另建抢写任务。不要因文档维护长期暂停实际素材研发。

## 6. 第一批有限交接复现（2026-11-01）

方法：从最新主线创建全新独立工作树，以下检查仅依赖仓库文件和已授权TJ；不是再次调用新模型的盲测，也未重审全部素材。

```powershell
# 在独立仓库根执行；测试只用临时合成fixture，不需原图、音轨或模型。
node --version
node --test tools/media-staging/stage.test.mjs
```

| 接任检查 | 结果与依据 |
|---|---|
| 找到规则 | 通过：README→CONTRIBUTING→MEDIA_ENGINEERING_RULES→本文，文件/链接已实际核对 |
| 解释收集/更新/筛选/审核 | 通过：核对既有源码、工具README和第2—4节；未把周期规划当运行事实 |
| 找到程序/结构 | 通过：主线stage/review及结构已核对；后续程序提供固定commit链接，不假定已合并 |
| 隔离离线检查 | 通过：TJ Node v24.18.0，以上stage.test.mjs实际15/15、退出0；覆盖隔离输出、源文件不变、hash损坏/路径越界及禁用门禁 |
| 找到当前任务 | 通过：读取既有私有状态/索引及Git refs；本地成果可恢复，未上传受限媒体 |
| 识别素材准入 | 通过：检查禁用默认值与权限测试，区分用户授权声明、审美认可及发布；真人听审未验证 |
| 安全确定下一步 | 通过：第5节按缺口执行，生产/其他协作者目录不写；外部任务实时状态因无接口阻断 |

本次未部署调度、未制作新音频/图片、未发QQ、未合并/部署。旧媒体40、反馈9、ROI6、项目118等结果只作既有证据复用；本批不声称全部重新执行或当前主线全量回归通过。完整仓库检查依照当前CONTRIBUTING使用npm run test:repo，本批文档范围只做上述小检查。

维护：重要技术决定、工作模式、里程碑和更新机制修改时，同步更新本文/工具说明并通过专项PR审查；将源码入口、依赖、配置模板、读写范围、周期/失败处理和证据一并记录。进度频繁变化时记数据入口而不是反复复制数字；长会话及时更新，不等上下文耗尽。私人媒体与详细日志留本机，不作为恢复说明的替代品。
