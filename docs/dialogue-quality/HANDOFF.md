# 对话与交互研发及评测接续状态

更新：2026-11-01。本目录为可公开的唯一规范入口；授权设备上的私有日志/记忆/研究原文另存，不能作为GitHub必需依赖。以下是日期快照，实时状态必须重新读。

## 当前任务：QQ对话审查与隔离修复

用户要求合并处理连发漏答、情绪、宿主亲近及其他实际问题，相关理解和实质选择集中对齐。独立分支`fix/dialogue-batch-and-affect`基于`5d9f9a1`；完整证据、实现、命令与限制见[本轮修复记录](DIALOGUE-REPAIR-20261101.md)。用户随后明确授权，默认输入修复已于2026-11-01 20:48（Asia/Taipei）部署，详见下方。生产记忆/人格/配置/白名单未改，没有发送QQ。原始材料只在授权环境private，不作为GitHub内容。

已固定1235条消息快照并补取9窗口497条重叠历史；复核当前漏答及关系表达，定位完整query丢给尾句字段的机制，研发/部署镜像均已隔离修复。仓库测试157/157、相关最终13/13、固定真实宿主假网关集成通过；不等于生产全链路验收。8次受控主路由回放和9次本地模型比较均保留，包括失败；尾句反事实从只答一问变为覆盖三项，通用三组不能证明全面改善。情绪、亲近和长期人格仍待用户体验校准，完整DSH steer/多轮仍待验证；不预先判定可上线。

下一次先读本轮记录、核对分支/PR与issues状态，复用已有缓存，不自动再跑模型；当前输入诊断仅含来源ID/长度/哈希，可用于部署后定位。`ownerBond=close_companion`是仅宿主私聊的候选配置，默认不启用、不写关系记忆或授予权限。DQ-004/007已部署、待真实交互验收；DQ-005/006表达待校准且试验未启用；DQ-008待查原文。已完成的历史接续检查无需重复。

补充：新增表达规则另置interaction-policy.txt；ownerBond与affectTrial两个试验开关均默认关闭，不捆绑启用未验收的情绪/关系调整。GitHub研发PR为[#6](https://github.com/Ming-zhishan/FangYuan/pull/6)，依赖规范PR #5，两PR均未合并。生产conversation五文件来源固定为`f782ccaf8575edfe23376283b380668998a52629`：部署前无漂移，部署后实际导入缓存与哈希一致、模块正常、配置哈希未变、OneBot连接正常；同一缓存代码的隔离长输入/插话/来源检查通过。后续应被动复核真实连发与currentInput诊断，真实DSH steer和长期效果仍未验收，不能重复部署或主动发QQ测试。私有角色目录的latest-deployment-index.json指向部署记录与缓存。

## 最新职责决策（2026-11-01）

用户已明确授权从独立评测扩展为对话与交互研发、人格及关系设计、文字玩法工程，同时保留全部评测职责。完整范围及最小研发循环见[工作规范](README.md)。此前“只能提交建议、人格/记忆修复一律交核心助手”的角色限制已被本次授权替代；其他协作者的文件归属和生产限制没有因此解除。

本次仅更新职责和工程流程，没有立项或实现示例玩法，没有改变评分规则、公开12例基线、扩展回归或生产状态。修改前公开基线固定于提交`858f1e77c9454c3a3765bc7891df0e56ef43e3a3`；其中fixture不是Bot生成质量基线。此前接续8项通过仍仅覆盖REPRODUCTION所列固定提交，不代表升级后的功能研发或人格效果已验收。

具体新玩法应按用户需求选取，未提出的不批量开发；当前优先执行上面的QQ审查与修复。已有DQ-001/002对话行为问题可在调查归属和取得必要证据后由本角色在隔离环境修复；DQ-003涉及共享成本/学习恢复，应继续由对应维护者协调。完整隔离Agent、人工校准等原未完成项继续保留。

## 下一位先做什么

1. 读[工作流程](README.md)、[锚定评分](RUBRIC.md)，核实当前Git提交和独立目录。
2. 按README运行validate、smoke、6项评测器测试及指定的消息批次/输出决策测试。先复现合成错误被捕获的闭环，不连接生产。
3. 看`tools/dialogue-quality/data/issues.jsonl`与[接续检查记录](REPRODUCTION.md)，区分已有证据和未验证项。
4. 在临时文件复制一条合成case，增加一个不同的错误机制，同时编写结果fixture。使用下面的自定义--cases/--results命令验证，确认缺陷能被抓住，再提交独立PR。
5. 只有获准使用隔离环境时才读取实际部署哈希、persona版本、模型路由、只读jobs/coverage/成本账本。禁止在生产库构造LearningStore或CostGuard，构造器可能写租约/建表。不要读host日志中的访问URL。
6. 职责内对话问题可调查、实现并回归；涉及他人模块则按归属交接或协调。保留修改前基线和独立复验，生产上线另行授权。

## 已核范围

此次分支基于`2e8dc6440be831ce61b8a4e07e93bac0fa040b2b`。公开代码具有DSH/Aurabot自定义复核及模块测试；主框架不是旧MaiBot。首次私有审阅与历史研究已恢复，但无私人资料随PR上传。

公开基线12例完全合成，涵盖9维度；本地另外保留43例草案和归档审阅，不能据此宣称已跑43例生成或已获用户满意度。合成闭环的预设评分仅演示格式，不是模型/人工实际打分。

此前固定开发快照有118项单测通过；部署副本与研发快照存在差异，不能拿开发通过证明生产质量。那些历史数字不代表最新main或本轮全库重测。本次只执行REPRODUCTION列出的检查。

已有线上学习：消息/回执采集、20秒心跳、30秒pulse和04:00复盘；与独立评测自动化不同。原著批量研读/跨章复核已有代码与历史成果，是否推进取决于bulkStudyEnabled和队列。历史“不设本地用量上限”的授权记录与后来部署的成本灰度守卫有冲突；不擅自把后者认定为用户新偏好或撤销守卫。未决请求+无缓存可阻止重发；应核对回执与幂等恢复，不能清空账本。

原有QCE上下文研究24批，21批已有复核；另外3批已在独立目录复用原脚本完成来源检查。总216个episode具备来源/引文检查记录，仍不等于人格与交流效果验收。旁观材料不得变成亲历或加好感。具体原始资料仅在获准环境按索引恢复，不上传批次、群号和成员身份。

## 授权隔离环境的历史入口索引

以下是以统一工程根为起点的私有运行资产位置，不是GitHub克隆必带文件；存在性、版本及副作用必须核实。没有授权环境时标阻断，不向用户索取已存在的完整聊天库。

|环节|既有入口|产物/验证|
|---|---|---|
|QCE账号隔离与规范化|`services/dsh/work/owner_qce_client.py`、`index_qce_corpus.py`|`runtime/dsh-live/qce-owner/corpus-manifest.json`与独立observed-corpus库；核对来源哈希/账号和主键去重|
|UIA补充/QCE上下文研究|`analyze_observed_qq.py`、`study_qce_contexts.py`，均在上述work目录|各自contextual-study目录；核对批次、覆盖、精确来源、quarantine，不混算全量|
|无模型来源纠错|同目录`revalidate_qce_study.py`|逐字复核及唯一命名空间修复；须复制所需批次到独立目录后运行，原脚本默认会写运行产物|
|策略采用与归档评测|运行目录`positive-observation-adoption.json`、`modules-data/conversation/observed-lessons.json`；同work目录`evaluate_social_quality.py`、`evaluate_persona_continuity.py`、`evaluate_final_social_cases.py`|已采用策略需追踪来源；评测脚本会调用模型，不是默认免费或无网络入口|
|队列与成本状态|`runtime/dsh-live/aurabot/modules-data/learning/learning.sqlite3`及`learning-budget.sqlite3`|只读查询jobs/terms/coverage/book_sources、lastWorker/presence和成本状态；不选消息正文或私人payload。不要把token预留量当人民币|

这些私有工具没有直接公开复制，因为含账号映射、运行路径或实际数据依赖；公开规范保留其方法和入口。若要公开化其实现，应另做去身份化与依赖解耦，不能直接提交历史源码。

## 未完成

- 完整隔离Agent适配器和真实多轮生成；模型参数/记忆/检索冻结契约已定义，尚未跑通该层。
- 用户/独立评委校准与隐藏留出集；不能宣称新助手的人格理解已验收。
- 当前生产版本归属、成本灰度授权链及未决请求恢复，由core提供证据后独立复验。
- 自动数据更新、周期评测和在线缺陷数据库未建立；当前为按变更触发和Git文件清单。

不需要为了接续先登录QQ、复制生产记忆、获取付费密钥或阅读旧聊天。缺少授权环境时照常完成公开离线闭环，相关线上项标阻断/未验证。

## 自定义用例的实际命令

独立接任者新增的纯合成扩展已保存在examples，独立于12例主基线。

```powershell
python tools/dialogue-quality/scripts/evaluate.py validate --cases tools/dialogue-quality/examples/cold-case.jsonl
python tools/dialogue-quality/scripts/evaluate.py audit --cases tools/dialogue-quality/examples/cold-case.jsonl --results tools/dialogue-quality/examples/cold-results.jsonl --out tools/dialogue-quality/private/cold-audit.json
```

validate预期1例/exit0；audit预期fail=1、reviewed=1/exit1。wrong_recipient来自合成路由字段，与回复措辞是否自然分开。
