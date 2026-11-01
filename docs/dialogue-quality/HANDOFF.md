# 对话评测接续状态

更新：2026-11-01。本目录为可公开的唯一规范入口；授权设备上的私有日志/记忆/研究原文另存，不能作为GitHub必需依赖。以下是日期快照，实时状态必须重新读。

## 下一位先做什么

1. 读[工作流程](README.md)、[锚定评分](RUBRIC.md)，核实当前Git提交和独立目录。
2. 按README运行validate、smoke、6项评测器测试及指定的消息批次/输出决策测试。先复现合成错误被捕获的闭环，不连接生产。
3. 看`tools/dialogue-quality/data/issues.jsonl`与[接续检查记录](REPRODUCTION.md)，区分已有证据和未验证项。
4. 在临时文件复制一条合成case，增加一个不同的错误机制，同时编写结果fixture。使用下面的自定义--cases/--results命令验证，确认缺陷能被抓住，再提交独立PR。
5. 只有获准使用隔离环境时才读取实际部署哈希、persona版本、模型路由、只读jobs/coverage/成本账本。禁止在生产库构造LearningStore或CostGuard，构造器可能写租约/建表。不要读host日志中的访问URL。
6. 把具备证据的失败交给core或media对应角色；评测保留独立复验权，不代为上线。

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
