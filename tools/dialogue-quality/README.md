# 离线对话质量评测工具

入口与操作步骤见[工作规范](../../docs/dialogue-quality/README.md)。只依赖Python 3.12标准库，无网络/模型/QQ/数据库执行接口。

`data/cases.v1.jsonl`为12例纯合成PUBLIC-QB-1.0；`examples/synthetic-results.jsonl`含故意错例及未执行例。`scripts/evaluate.py`与6项契约测试复用已有独立评测工具，`scripts/smoke.py`是公开可复现闭环。

`data/issues.jsonl`保留未解问题的状态与验收方法；不包含实际聊天。示例内的评分是格式fixture，不能当作用户或LLM真正评分。所有运行输出放`private/`，不提交缓存、私有A/B映射或原始日志。
