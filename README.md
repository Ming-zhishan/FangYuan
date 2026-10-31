# FangYuan｜方源 QQ Bot · 开发协作仓库

> **本仓库是经过筛选的源码与维护资料，不是可以直接登录 QQ 的生产环境。** GitHub 上的代码、开发克隆与实际运行实例相互隔离；不要直接运行启动/部署/账号控制脚本。

## 架构

QQ → NapCat / OneBot → DSH NEXT / Aurabot → 方源自定义模块 → 本地 Ollama / 云模型网关、检索与记忆。

| 路径 | 作用 | 说明 |
| --- | --- | --- |
| `src/fangyuan-agent/` | 方源模块与离线测试的研发基线 | 首选修改入口；含部分镜像模块 |
| `src/aurabot-modules/` | Aurabot 的独立模块源码快照 | 与基线存在有意镜像；不得未经核对就合并/删除 |
| `src/qq-bootstrap/` | 旧 QQ 启动、配置、云模型网关和实验代码 | 混合历史与仍可复用代码；不能视为即插即用部署包 |
| `operations/` | 本机布局核验、来源差异与维护入口 | 部分脚本依赖未纳入 Git 的实际运行环境；不要在协作克隆中执行生产操作 |
| `config/` | 跨设备相对路径配置与模板 | `project-paths.local.json`、真实凭证不能提交 |
| `docs/` | 架构、迁移记录、协作规范、安全边界 | 某些迁移报告是历史快照，日期及路径不能当作当前状态 |

## 新协作者从这里开始

1. 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [安全发布边界](docs/SECURITY_RELEASE_GATE.md)。
2. 创建个人分支；不同 AI 工具使用独立工作树，不共享同一个可写 Git 工作区。
3. 改动模块前先确认实际调用方，尤其是 `src/fangyuan-agent/modules` 与 `src/aurabot-modules` 两套源码快照的差异。
4. 在 **Node.js 22.13+** 环境中执行离线测试：

   ```powershell
   cd src/fangyuan-agent
   npm test
   ```

5. 提交前检查 `git diff --cached`，并在仓库根目录运行 `node tools/audit-staged.mjs`；敏感信息检测不能替代人工审核。
6. 以 Pull Request 讨论变更。涉及 QQ、人格、模型配置或记忆数据库的上线部署，需独立授权、备份和验收。

## 运行环境边界

Git **不包含**生产服务、QQ 会话、Cookie/Token、真实模型凭证、私聊/记忆数据库、模型权重、媒体资源、日志和自动生成的 `.aurabot-cache`。

`config/project-paths.json` 是可移植的 **相对路径** 映射；真实 Windows 路径保存在被 Git 忽略的 `config/project-paths.local.json`。空白克隆无法仅凭源码运行全部生产验收脚本；这是刻意的隔离策略，而非缺文件错误。

模块镜像中有完全相同的源码，但其目录位置代表不同的装载/部署语义。已去除无意义的 Aurabot 生成缓存；其他镜像在有测试证明和迁移计划前继续保留。

## 代码权属与公开风险

当前没有经过统一的第三方许可及原著引文授权审核；**仓库公开不等于代码自动获得开源许可**。不要擅自再分发第三方组件、长篇原著、语音或表情素材。

维护记录见 [协作与安全边界](docs/Git协作与安全边界.md)。迁移记录可能包含历史状态，不代表当前部署。