> **历史快照**：本文件记录早期迁移或 Git 准备状态，可能包含已过时的路径/状态；当前协作流程请以仓库根 README 和 docs/Git协作与安全边界.md 为准。

# 方源项目：未来 Git 协作准备（本轮没有初始化 Git）

## 当前可协作源码

- `src/fangyuan-agent`：方源人格与模块扩展。完整离线单元测试：106 项通过。
- `src/aurabot-modules`：在线 Aurabot 自定义模块的开发快照，**不是自动部署的工作树**。
- `src/qq-bootstrap`：QQ 监督进程、云网关、模型配置模板及启动脚本（107 文件），**不含可执行程序和 Python 环境**。
- `config/project-paths.json`：跨机器可用的相对路径布局。
- `config/.env.example`：仅变量名称和占位路径。
- `operations/verify-layout.mjs`、`operations/check-source-drift.mjs`：只读验证与开发快照对照。
- `docs/`：目录与迁移说明。

## 绝对不要加入未来仓库

`runtime/`（生产登录、密钥、数据库、模型与历史）、`archive/`（发布包）、`operations/legacy-tools/`（历史混合工作目录）、`config/project-paths.local.json`（本机绝对路径）、语音模型文件和有未经确认授权的图片、音频、原著文本。

根目录已提供 `.gitignore`，但 **.gitignore 不是保密工具**。建立仓库前仍应对所有将要提交的文本进行一次凭证、个人聊天和版权素材审查。

## 协作约定（将来才实施）

1. 此项目根目录作为未来仓库根；`src/` 下是可审查的开发代码，`runtime/` 是每个人自己的部署状态。
2. 约定代码分支、Pull Request、review、离线测试；**不要直接修改团队共用生产数据库**。
3. 路径通过 `operations/enter.ps1` 和相对路径表取得；每个开发者自行配置被忽略的本机路径文件。
4. 生产升级要比较 `operations/check-source-drift.mjs`，备份后审核部署，不能反向把私有运行数据复制进源码。
5. 研究素材如确需共同维护，另用外部对象存储/带权限的共享目录；不要让 9GB 音频模型、28GB 环境进入 Git 历史。
6. 现有旧目录 `fangyuan-dsh/.git` 已保留在原位置。未来若要将其历史并入新根目录，需另行决定保留旧仓库历史还是从新基线开始；本轮未执行任何 Git 命令。

## 现在不做的事情

不运行 git init、git add、git commit、git remote、git push；不创建 GitHub 仓库，也不转移任何密钥。

## 一次性验证

在新目录的 PowerShell 中运行：

```powershell
.\operations\enter.ps1
node .\operations\verify-layout.mjs
node .\operations\check-source-drift.mjs
```

以上均不会向 QQ 发消息，也不会调用任何付费模型。
