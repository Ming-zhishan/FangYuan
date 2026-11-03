# 共同所有者与 Mac 协作（2026-11-03）

## 用户的新授权

用户明确：保留原宿主，已指定的另一位开发者与其拥有同等权限，双方共同操作同一个方源，继续使用已授权账号；第二位开发者使用 Mac。本决定取代此前“第二账号仅 business_admin，无电脑权限”的限制，但不提升其他业务管理员或普通群友。

当前方案保留一份生产实例及数据库。通过 QQ 管理同一个 Bot 与使用什么桌面系统无关；电脑工具实际操作生产主机，不能据此声称可以操作对方 Mac。直接在 Mac 开发则使用 GitHub 独立分支/克隆；直接远程操作面板或主机还需对方的远程身份与设备授权，不能由 QQ 号猜测。

不复制一套在线数据库到 Mac 双开 Bot，不把自己的 QQ、模型或 Windows 登录密码打包给对方。模型凭据继续由生产网关使用。个人关系、原始私聊按实际账号保留，不合并成一个身份；完整电脑权限意味着受权者也有能力读取生产工作区文件，不作“所有者无法接触任何私聊文件”的虚假保证。

## 权限模型

- 原 `ownerQQ` 保持，始终是 primary_owner。新增显式 `ext.principals.coOwners`，角色为 co_owner；与原宿主共用 `ownerLevel` 及现有功能开关、工具审批策略。
- 共同所有者私聊进入与原宿主相同的完整预设；命令、资料工具、模块 isOwner、目录/公开提议及执行时检查采用同一身份判断。群聊仍是 social，不因群内有所有者就给全群电脑工具。
- 普通 business_admin 继续只有原业务权限。重复、非法、昵称、自称、Bot 自身及非字符串条目均不授所有者权限。
- 已挂载的 full 会话在工具真正执行前检查当前名单、档位和实际操作者，撤销后不能依赖旧工具继续执行。混合所有者与普通发送人的轮次不执行电脑工具。
- 若启用了原有危险确认，确认发给发起操作的所有者本人，只接受对应本人本私聊回复，执行前再次核撤销。原有危险确认开关不因本功能改变。
- 主人指向的后台通知、主动分享和默认收件人继续以原 ownerQQ 为准；这不是给所有者广播彼此私聊。`/remember` 的主体绑定当前真实操作者，不能把共同所有者的自述写成原宿主事实。

仅示意（合成账号）：

```json
{"ext":{"principals":{"enabled":true,"coOwners":["100002"],"businessAdmins":[],"friendship":"deep_allies"}}}
```

## 实现与隔离复现

两套模块镜像同步 policy/index、live-guard capabilities、diary 提议与 fangyuan 通道说明。人物正文、长期记忆内容、群频率、普通群白名单保持。

`tools/business-admin/prepare-co-owners.mjs` 只在新的隔离目录生成原生 fork，核对唯一源码锚点；不能对生产原地替换。它适配 access、模块 API、hub 执行守卫、commands 记忆主体、危险确认、群管理保护、联系人和 bridge。上游源为已验证的 business-admin fork；输出不兼容未知版本时停止，不模糊替换。

```powershell
node tools/business-admin/prepare-co-owners.mjs --source VERIFIED_NATIVE_FORK --out NEW_SEPARATE_COPY
```

在 `src/fangyuan-agent`：

```powershell
node --test test/co-owners.test.mjs test/principals.test.mjs test/live-guard.test.mjs
$env:AURABOT_SOURCE_ROOT = 'NEW_SEPARATE_COPY'
$env:FY_TEST_MODULES_ROOT = 'VERIFIED_MODULES_COPY'
node --test integration/co-owners.test.mjs integration/business-admin.test.mjs
```

21 项相关单测通过；真实宿主假网关共同所有者/危险确认 2 项、旧业务管理员 1 项、群互动和空间隐私 2 项通过。全部使用合成账号、新数据目录和假模型，不调用生产 QQ 或模型。第一次在回合结束、发送人状态已清空时直接测试 allow 失败，已在原生 simulateTurn 构造明确的测试回合，再核混合发送人和撤销拒绝；没有放松生产守卫去迎合测试。

## Mac 接收者的操作路径

1. QQ 入口：使用已绑定的真实 QQ 私聊 Bot，`/权限` 查看角色。获得完整所有者权限后，文件或终端工具作用于生产主机。这里不需要 Mac 再运行 NapCat 或复制记忆库。
2. 研发入口：从当前共同所有者分支读本文件及 HANDOFF，独立分支开发和隔离测试，PR 评审后按现有发布流程部署；不同时编辑同一生产工作树。
3. 远程面板/主机：生产机已有运行中的 Tailscale，但这不证明接收者可达。接收者安装 Mac 客户端并登录自己的连接身份，接受生产机共享邀请，再核服务权限及应用认证。邀请、设备加入和 Mac 实测必须分别记录，未完成不能写成已打通。
4. 本次不开放公网端口、Funnel、整个磁盘共享或默认远程桌面。需要哪项实际入口再配置对应主机与应用权限，不把 SSH/RDP/网页认证混为一层。

官方依据：[Mac 安装](https://tailscale.com/docs/install/mac)、[按设备共享与接受邀请](https://tailscale.com/docs/features/sharing)、[Serve 私有服务](https://tailscale.com/docs/reference/examples/serve)。同等 Bot 权限不要求共用个人 GitHub/Tailscale 登录密码。

## 当前交付边界

隔离实现及测试已完成，生产部署须按后续实测记录判断。Mac 远程设备和 GitHub 协作身份尚待提供；未发送邀请或泄露凭据。部署需保留原生 fork、包入口、profile 依赖、模块文件和配置备份，先做隔离还原演练；重启仅对应 DSH 进程，QQ 和模型服务不重启。回滚核对漂移，只还原本次变动，不回退聊天/记忆数据库或清空发送记录。
