# 对话质量评测：工作规范与接续入口

本目录是GitHub中的角色专属入口。新窗口先读本页、[评分规范](RUBRIC.md)、[当前基线与交接](HANDOFF.md)，再使用[工具](../../tools/dialogue-quality/)。职责是独立评价内容与行为；核心助手修人格/模型/记忆，媒体助手做素材和集成。评测不修改生产、不发QQ、不改群开关和白名单、不合并PR。

## 已有机制与缺口

- 现有发送前复核：`src/fangyuan-agent/modules/conversation/index.mjs`，及`current-batch.mjs/decision.mjs`。它检查当前对象、有效人格、上下文和输出契约，不等于独立外部评委。
- 现有测试：`test/conversation.test.mjs`、`current-batch.test.mjs`、`reply-decision.test.mjs`、`learning*.test.mjs`、`message-context.test.mjs`、`migration-lore.test.mjs`、`participation.test.mjs`、`persona-admin.test.mjs`等；路径均在`src/fangyuan-agent`。按变更选测，避免每次跑全库。
- `tools/voice-ab.mjs`已有20条fixture，但简化上下文、人格依据不完整；默认执行会调用模型。只有明确的`--dry`是无网络模式，不能用其标点/字数统计直接验收自然度。
- 私有工程有QCE/UIA研究、学习队列、归档回放和来源纠错；不能仅凭GitHub克隆推断这些在线状态。旧`src/qq-bootstrap/evaluate-*`属于历史链路，不能当当前DSH全链路。
- 此PR新增公开合成基线、复用的归档评分器、可追踪缺陷清单和接续步骤。未发现固定周期更新评测集/自动盲评验收的运行证据；本次不创建调度服务。

## 数据获得、筛选与版本

真实数据仅从用户授权的OneBot只读历史、实际回执或独立账号QCE导出获取；UIA显示文本作补充，不能视为服务器完整档案。核对账号、会话、消息ID、引用、时间、系统事件和覆盖缺口。不能运行启动、部署、发消息或控制学习脚本来获取状态。

授权环境已有研究方法：QCE按稳定会话+消息ID去重并保存文件哈希；参考账号记录取前后最多7条，其他来源选最新非系统连续上下文；220条一批、18条重叠。UIA补充研究另以360条分批、270研究/90留出。两种覆盖不能相加为全量。episode至少2条有效来源，quote必须逐字匹配。只允许本批唯一ID后缀补命名空间，再重新核验；坏条隔离，原始结果保留。缓存raw/result后不为修格式重新付费。

公开样本必须重新人工检查：替换账号/昵称/群名/联系方式/链接/回执ID/本机路径及可识别事件组合；仅替换QQ号并不充分。优先将真实失败机制改写为全合成案例。不得上传私聊库、原文研究批次、令牌、原著全文或完整Prompt。`provenance.kind=synthetic`不能用于伪装未完成脱敏的真实记录。

新增样本先明确失败机制、最小必要上下文、UID、预期行为和不应出现行为，按语义目的及来源指纹检查重复。ID永久稳定；输入/评分规则变化升`version`并记录理由。去重不能丢掉引用、多人对象和旧事实纠正。A日常/B人格/C多人/D记忆/E原著/F时机/G边缘/H长期/I边界/J真实缺陷机制；网络梗也用culture维度标注。认真问题可长答，笑话无唯一标准台词。

## 最小执行闭环

Python 3.12标准库，无需安装依赖；仓库相关模块测试需要Node 22.13+。在仓库根执行：

```powershell
python tools/dialogue-quality/scripts/evaluate.py validate
python tools/dialogue-quality/scripts/smoke.py
python -m unittest discover -s tools/dialogue-quality/scripts -p "test_*.py" -v
node --test src/fangyuan-agent/test/current-batch.test.mjs src/fangyuan-agent/test/reply-decision.test.mjs
```

这条闭环不调用模型、不读生产库、不连接QQ。合成演示含故意错误，smoke成功表示评测器抓住错误，不能说Bot通过12例聊天。

```powershell
python tools/dialogue-quality/scripts/evaluate.py audit --results tools/dialogue-quality/examples/synthetic-results.jsonl --out tools/dialogue-quality/private/demo-audit.json
```

上条预期返回1（fixture故意含错对象/泄露），0表示所提供观察没有fail，2表示命令或数据错误。`reviewed`仅表示所列维度完成审核，`unverified`表示执行/证据/评分不完整，均不是整机放行。通信失败不打语言0分。不要重复执行收费请求来处理异常。

完整Bot、多轮生成、model-only与真人QQ分别标记执行模式。当前没有公开的完整Agent运行适配器。新增生成前确认隔离入口、实际模型与费用授权；QQ测试另需明确账号与目标授权。

## 数据及缺陷契约

用例字段：`id/category/risk/purpose/history/input/participants/expected/forbidden/dimensions/dependencies/provenance/version`，可选`forbidden_literals`仅放合成保护标记。结果字段：`case_id/run_id/trial/mode/execution_status/decision/text/ratings`；每项评分为`{score:0..4,evidence:具体理由}`。未运行不打分。格式生成方法：复制`data/cases.v1.jsonl`一行，改ID/目的/上下文/行为/来源/版本，运行validate；不是必须调用生成模型。

重复发送需区分`delivery_key`与`message_id`，同回执重复日志不等于重发。盲评需要完整`conditions`：case_version、完整输入input_sha256、code、persona、memory、retrieval、model、parameters、feature_flags、seed。缺条件拒绝配对；导出上下文与A/B文本，映射key留私有。旧模型评委分数不直接当事实或平移量表。

缺陷清单为`tools/dialogue-quality/data/issues.jsonl`，这是最小可版本追踪清单，不是已建立的在线缺陷服务。每项应记录ID、状态、优先级、摘要、证据位置、版本、根因确认度、复现用例、负责角色、修复建议/验收与回归状态；涉及私人证据只留访问指引，不公开内容。修复交接按“现象→复现→证据→可能根因→确认度→建议→验收”。阶段日志缺失时不能从一句回复断言Prompt有错。

## 持续维护与里程碑

真实高价值失败、用户反馈、模型/人格/记忆/检索/时机变更触发增量回归。人格变更选B/H；记忆选D/C；检索选E；时机选F/G；输出权限选I/J。保存提交与条件、旧/新输出、改善/未改善/退化/未验证。随机问题按需小规模重复，不能以单条好回复宣称稳定提升。

没有固定例行调度；重大变更后运行相关回归，长期无变更时按用户指定周期再评，不自行建立计费循环。已暴露留出集转回归集；评委与用户分歧、系统性偏爱短句/正式表达或优化指标导致模板化时，先修订评分规则并保留旧版。

用户确认的决策、机制/成本变化、重要阶段结果及时更新HANDOFF和缺陷清单；新机制记入口、依赖、存储、周期、幂等/失败处理及验证命令。接近上下文上限前写回。不要覆盖媒体规范或全局协作规则。
