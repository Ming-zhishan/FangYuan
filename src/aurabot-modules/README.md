# 旧快照入口

这里不再维护第二套完整源码。基础实现位于 [fangyuan-agent/modules](../fangyuan-agent/modules/)，六处有意差异及运行独有文件位于 [aurabot-runtime-overrides](../aurabot-runtime-overrides/)。

在仓库根运行 `npm run build:modules -- --profile runtime --out artifacts/runtime-modules`，生成独立的 `modules/`、人物卡、关闭状态的配置模板及来源清单。默认不带 `--out` 只校验并输出计划；已有输出拒绝覆盖。

此路径保留供旧链接导航，不能再作为实际模块装载目录。生成包不自动部署，具体差异、验证及迁移依据见[构建说明](../../docs/MODULE_BUILD.md)。
