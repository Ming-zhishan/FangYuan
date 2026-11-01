# 离线对话质量评测工具

完整输入与关系候选的相关测试、已有模型小规模比较入口`local-review-ab.mjs`及缓存/失败处理见[本轮研发与复验](../../docs/dialogue-quality/DIALOGUE-REPAIR-20261101.md)。该脚本默认仅计划，执行模型需显式`--execute`，不属于下方零模型smoke。`interaction-review.jsonl`和`wire-review.jsonl`是纯合成复核fixture，不混入12例主基线的通过数。

入口与操作步骤见[工作规范](../../docs/dialogue-quality/README.md)。只依赖Python 3.12标准库，无网络/模型/QQ/数据库执行接口。

`data/cases.v1.jsonl`为12例纯合成PUBLIC-QB-1.0；`examples/synthetic-results.jsonl`含故意错例及未执行例。`scripts/evaluate.py`与6项契约测试复用已有独立评测工具，`scripts/smoke.py`是公开可复现闭环。

`data/issues.jsonl`保留未解问题的状态与验收方法；不包含实际聊天。示例内的评分是格式fixture，不能当作用户或LLM真正评分。所有运行输出放`private/`，不提交缓存、私有A/B映射或原始日志。
