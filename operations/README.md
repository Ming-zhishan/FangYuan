# 运维检查入口

本目录面向具备授权本机布局的维护人员。普通开发克隆先按根 [README](../README.md) 执行离线测试，不需运行真实环境检查。涉及生产配置、部署或发送的授权规则继续有效。

## 源码差异检查

`check-source-drift.mjs` 比较以下固定相对目录，以脚本所在仓库根为起点，不依赖调用者当前目录，也不读取本机路径覆盖配置：

| 源码 | 对照目录 |
| --- | --- |
| `src/fangyuan-agent` | `operations/legacy-tools/fangyuan-dsh` |
| `src/aurabot-modules` | `runtime/dsh-live/aurabot/modules` |
| `src/qq-bootstrap` | `runtime/qq-stack/setup` |

只有确认这些目录确实对应本次获授权的比较对象后，才执行检查。顶层目录可为既有布局链接；树内的链接或特殊文件会拒绝继续，不跟随它们读取其他内容。

```powershell
# 无需真实运行目录即可查看帮助
node operations/check-source-drift.mjs --help
# 默认仅向终端输出 JSON，不创建目录或报告
node operations/check-source-drift.mjs
# 仅显式指定时写入一个新报告；父目录须已存在
node operations/check-source-drift.mjs --report .\operations\migration\source-drift-review.json
```

不再自动写入旧 `source_drift_latest.json`。报告路径相对调用者当前目录解析；已存在的文件不会覆盖，比较树内及其链接别名下禁止写报告。显式写入成功时 `readOnly:false`、`reportWritten:true`；`comparedTreesReadOnly:true` 只说明不修改对照源码。写入中途出现 I/O 错误时可能留下不完整报告，须人工检查该次指定文件。

| 退出码 | 含义 |
| --- | --- |
| `0` | 完成比较，或成功显示帮助；存在差异也返回 0 |
| `2` | 参数、目录、读取或报告写入失败；JSON 的 `error.code` 提供类别，结果不代表完整比较 |

结果列出缺失、修改和额外文件，额外文件预览最多 30 个，`extraLiveFileCount` 提供总数；不再隐藏额外 README。按原始字节与精确路径大小写比较，CRLF / LF 差异会报告修改；这与 [SOURCE_MAP](../docs/SOURCE_MAP.json) 的历史 LF 归一化来源核对口径不同。

`.git`、依赖目录、Python 缓存、备份、日志、模块数据和 Aurabot 缓存按代码中的排除名单跳过。结果不含文件正文或完整项目路径，但相对文件名仍可能涉及私有资料，报告留在授权环境，禁止未经审核直接提交。比较期间文件可能变化，结果不是完整发布清单或进程装载证明，也不会据此同步生产文件。

## 布局检查与测试

`verify-layout.mjs` 仍依赖本机覆盖配置，包含本地端口探测并写入布局报告，**不是纯只读工具**；其路径与环境假设尚未在本轮修正，不作为普通克隆入口。

`check-source-drift.test.mjs` 只使用合成临时目录，不读取真实生产环境或调用网络，已纳入 `src/fangyuan-agent` 下的 `npm run test:repo`。单独验证可在仓库根运行 `node --test operations/check-source-drift.test.mjs`。
