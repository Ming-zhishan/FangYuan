import { createHash } from 'node:crypto'

export function installSocialTools(api, { ready, permitted }) {
  const capabilities = (chat) => {
    const cfg = api.config(), owner = chat?.kind === 'private' && String(chat.userId) === String(cfg.ownerQQ)
    const admitted = cfg.enabled && ready() && (!chat?.chatId || permitted(chat.chatId))
    const writes = Object.fromEntries(['qqNickname', 'qqSignature', 'qqAvatar', 'qqFriendRequest'].map((k) => [k, Boolean(admitted && (cfg.profilePerms?.[k] === 'all' || (owner && (cfg.profilePerms?.[k] ?? 'owner') === 'owner')))]))
    const publicScene = owner || cfg.ext?.fangyuan?.publicRequestsFromAll === true
    return { accountVerified: ready(), scene: chat?.kind, ownerConversation: owner,
      ordinaryGroupReply: { enabled: cfg.enabled && ready(), note: '在已接入群正常回复不依赖主动群发工具；收到@可直接进入会话。' },
      groupDirectory: { tool: owner ? 'fy_group_directory' : null, available: owner && ready() },
      directedGroupMessage: { tool: owner ? 'fy_send_group_message' : null, enabled: owner && ready() && cfg.ext?.liveGuard?.ownerGroupOutbound === true },
      qzone: { tool: publicScene && api.use('diary') ? 'qq_send_qzone' : null, enabled: Boolean(admitted && publicScene && api.use('diary') && cfg.diary?.enabled && cfg.ext?.fangyuan?.publicActions === true), note: '已开放时可以考虑提议，也可按关系、场合和意愿拒绝；只有真实tid回执才可说已发布。' },
      profileWriteEnabled: writes, proactiveAddFriend: { available: false, note: '主动加好友未挂载；处理收到的好友申请是另一项权限。' },
      memory: Boolean(api.use('learning')), originalSearch: Boolean(api.use('lore')),
      ...(owner ? { enabledGroupIds: (cfg.allow?.groups || []).map(String), ownerLevel: cfg.ownerLevel } : {}) }
  }
  api.context?.(({ chat }) => permitted(chat?.chatId) ? '【当前实际能力，以本轮状态为准，不能沿用旧回答猜测】\n' + JSON.stringify(capabilities(chat)) : '')
  api.rule?.('被问到能做什么、有哪些群或缺少什么工具时，先用fy_capabilities/fy_group_directory核对当前状态。区分未提供接口、接口存在但开关未启用、执行失败和自己选择不做。正常群聊回复不依赖跨会话群发工具；不能因为私聊里看不到群历史就说机器人没加入那个群。')
  api.tool(({ chat, sessionId }) => {
    if (!permitted(chat.chatId)) return []
    const result = [api.defineTool({ name: 'fy_capabilities', description: '读取当前会话真实可用能力和开关，区别已接入、未授权及未提供工具；不要凭历史回答猜。', execute: async () => ({ ok: permitted(chat.chatId), capabilities: permitted(chat.chatId) ? capabilities(chat) : null }) })]
    const cfg = api.config()
    if (chat.kind !== 'private' || String(chat.userId) !== String(cfg.ownerQQ)) return result
    const allowed = () => ready() && api.config().enabled && chat.kind === 'private' && String(chat.userId) === String(api.config().ownerQQ) && api.core.hub.turnSendersAllOwner(sessionId)
    const directory = async () => {
      if (!allowed()) return { ok: false, groups: [], message: '当前操作者或账号未核实' }
      const rows = await api.core.onebot.call('get_group_list', { no_cache: true }, { timeoutMs: 7000, retries: 0 })
      if (!allowed() || !Array.isArray(rows) || rows.some((g) => !/^\d{5,12}$/.test(String(g.group_id || '')))) return { ok: false, groups: [], message: '未取得可核验的群列表' }
      return { ok: true, groups: rows.map((g) => ({ groupId: String(g.group_id), name: String(g.group_name || ''), enabled: permitted('group:' + g.group_id) })), note: '来自当前QQ网关，不是旧聊天推测；这里只查看列表，未读取群聊天。' }
    }
    result.push(api.defineTool({ name: 'fy_group_directory', description: '在操作者私聊中只读查询机器人实际加入的QQ群、群号及是否已接入；可回答有几个群。', execute: directory }))
    if (cfg.ext?.liveGuard?.ownerGroupOutbound !== true) return result
    result.push(api.defineTool({ name: 'fy_send_group_message', description: '操作者明确要求给指定已接入群发话时使用；你可接受或拒绝。不是回复当前私聊。只有sent=true及messageId才可说已发；结果未知不重试，不转发私聊流水。', properties: { groupId: { type: 'string' }, text: { type: 'string' } }, required: ['groupId', 'text'], execute: async ({ groupId, text }) => {
      const target = 'group:' + String(groupId), enabled = () => allowed() && api.config().ext?.liveGuard?.ownerGroupOutbound === true && permitted(target)
      const store = api.use('memory')?.store
      if (!enabled() || !store || typeof text !== 'string' || !text.trim() || text.length > 1000 || /\[CQ:|【通道记录】/.test(text)) return { ok: false, sent: false, message: '目标、内容或当前授权无效' }
      const source = store.read().events.filter((e) => e.scope === chat.chatId && e.uid === String(chat.userId) && !e.forgotten).at(-1)
      if (!source) return { ok: false, sent: false, message: '缺少本轮真实操作者来源' }
      const actual = await directory()
      if (!enabled() || !actual.ok || !actual.groups.some((g) => g.groupId === String(groupId) && g.enabled)) return { ok: false, sent: false, message: '未核实目标群确已加入且已启用' }
      if (api.config().dryRun) return { ok: true, sent: false, simulated: true }
      const id = createHash('sha256').update(source.id + '|' + target).digest('hex')
      const claimed = store.mutate((s) => { s.directMessages ||= []; if (s.directMessages.some((r) => r.id === id)) return false; s.directMessages.push({ id, kind: 'group', source: source.id, target, status: 'attempted', at: Date.now() }); return true })
      if (!claimed) return { ok: false, sent: false, message: '本来源已向此群尝试，先核对结果，不重复发送' }
      const settle = (status, extra = {}) => store.mutate((s) => Object.assign(s.directMessages.find((r) => r.id === id), { status, ...extra }))
      try {
        if (!enabled()) throw new Error('发送条件已变化')
        const response = await api.sendSegments(target, [{ type: 'text', data: { text: text.trim() } }], '操作者要求的指定群发言')
        if (response?.message_id == null || String(response.message_id).startsWith('sim-')) throw new Error('没有真实发送回执')
        settle('sent', { messageId: String(response.message_id) }); return { ok: true, sent: true, target, messageId: String(response.message_id) }
      } catch { settle('unknown'); return { ok: false, sent: false, unknown: true, message: '发送结果未确认，不自动重试' } }
    } }))
    return result
  })
  api.route('/capabilities', async () => ({ ok: true, capabilities: capabilities({ kind: 'private', userId: api.config().ownerQQ }) }))
  return capabilities
}
