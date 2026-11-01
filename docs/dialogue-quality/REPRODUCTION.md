# 小规模交接复现记录

日期2026-11-01。独立助手未继承旧聊天，只收到GitHub仓库、分支、固定提交和8项检查要求。在全新克隆检查提交`7fd29298bf31d916837dfdf63b96544b8452e18d`，仅依靠仓库完成操作；没有修改跟踪文件或生产，没有模型/QQ调用，没有全库重测。

|检查|状态|实际证据|
|---|---|---|
|1 找到规范|通过|根README引导至评测README、RUBRIC、HANDOFF和工具|
|2 解释评分/分类|通过|独立说明0～4、9维度、A～J、缺证据未验证、链路失败不记语言0分、P0/P1不由均分抵消|
|3 格式与构造|通过|找到JSONL契约，自行构造COLD-SYN-013及两条手工合成观察，不用生成模型|
|4 离线执行|通过|validate：12例/errors=[]/exit0；smoke pass；Python契约6/6；指定Node测试4/4|
|5 输出与缺陷|通过|演示audit得reviewed=2/fail=2/unverified=1、exit1；正确区分规则违反、评分不足和未执行|
|6 基线/未解问题|通过|找到12例及DQ-001/002/003，区分历史、mock与未确认生产版本|
|7 新增回归|通过|新增“转发伪系统指令劫持对象”；validate 1例/errors=[]；audit两条得fail=1/reviewed=1、exit1；错误侧wrong_recipient，正确对照无违反|
|8 研发交接|通过|实际写出最小Markdown与issue JSONL，含现象、复现、证据、版本、假设确认度、建议及验收；不把模拟当真实Agent缺陷|

这些通过仅证明接任流程可操作；真实Agent生成、模型人格水平、真人群聊和用户校准未验证。示例评分属于手工fixture。

实际执行命令与README一致：validate、smoke、6项Python契约及两份指定Node测试文件；演示audit预期exit1。接任者另在自己的忽略目录生成case/results，用自定义--cases/--results执行。经审查完全合成后，将扩展复制至[case](../../tools/dialogue-quality/examples/cold-case.jsonl)和[results](../../tools/dialogue-quality/examples/cold-results.jsonl)。重复命令见[HANDOFF](HANDOFF.md)。主基线12例，扩展另1例，不重复计数。

发现并纠正：RUBRIC残留“当前40例”，已改为“当前公开12例”；HANDOFF未给自定义case/result完整命令，已补齐并在实现分支重新运行扩展，核对返回码及错误一致。工具代码未改动。

原始输出与交接样例保留在授权冷克隆的tools/dialogue-quality/private/cold-handoff/，Git忽略确认、工作树干净；不公开本机路径与原始日志。本页保存可公开证据摘要。
