import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { installSocialTools } from './social-tools.mjs'

export default {
  id: 'live-guard', name: '真实QQ接入与回执', api: 1, version: '0.3.0',
  description: '真实账号、好友核验、旧通道停发及有回执的定向私信。',
  setup(api) {
    let friends = new Set(), checkedAt = 0, refreshing = false, account = ''
    const settings = () => api.config().ext?.liveGuard || {}
    const temporaryContacts = () => new Set((settings().temporaryPrivateContacts || []).map(String).filter((id) => /^\d{5,12}$/.test(id)))
    const legacyDisabled = () => {
      try { return JSON.parse(readFileSync(settings().legacyModePath, 'utf8').replace(/^\uFEFF/, '')).mode === 'disabled' } catch { return false }
    }
    const ready = () => settings().enforce === true && legacyDisabled() && account === String(api.config().botQQ) && Date.now() - checkedAt < 180000
    const permitted = (chatId) => ready() && (String(chatId).startsWith('private:') ? (friends.has(String(chatId).slice(8)) || settings().temporaryPrivate === true && temporaryContacts().has(String(chatId).slice(8))) : (api.config().allow.groups || []).map(String).some((id) => chatId === 'group:' + id))
    const capabilitySnapshot = installSocialTools(api, { ready, permitted })
    const syncContacts = () => {
      const learning = api.use('learning')
      for (const uid of new Set([...friends, ...temporaryContacts(), ...(api.config().allow.private || []).map(String)])) learning?.syncContact?.(uid, friends.has(uid) ? 'friend' : 'temporary')
    }
    async function refresh() {
      if (!settings().enforce || refreshing) return
      refreshing = true
      try {
        const onebot = api.core.onebot
        const login = await onebot.call('get_login_info', {}, { timeoutMs: 7000, retries: 0 })
        if (String(login?.user_id) !== String(api.config().botQQ)) throw new Error('真实QQ账号不匹配')
        const rows = await onebot.call('get_friend_list', { no_cache: true }, { timeoutMs: 7000, retries: 0 })
        if (!Array.isArray(rows) || rows.some((r) => !/^\d{5,12}$/.test(String(r.user_id || r.uin || '')))) throw new Error('真实好友列表无效')
        friends = new Set(rows.map((r) => String(r.user_id || r.uin)).filter((id) => id !== String(login.user_id)))
        account = String(login.user_id); checkedAt = Date.now()
        const list = [...new Set([...friends, ...(settings().temporaryPrivate === true ? temporaryContacts() : [])])].sort(), previous = (api.config().allow.private || []).map(String).sort()
        syncContacts()
        if (JSON.stringify(list) !== JSON.stringify(previous)) api.setConfig({ allow: { private: list } })
      } catch (error) {
        checkedAt = 0
        api.log.warn('真实好友或账号未核实，本轮不接收或发送：', error.message)
      } finally { refreshing = false }
    }
    api.every(30000, refresh, '核对真实QQ好友')
    api.later(1000, refresh)
    // The native host emits the authenticated raw event synchronously before hub admission.
    // Admit only an actual inbound conversation, never an arbitrary guessed outbound account.
    api.on('onebot', (event) => {
      if (event.post_type === 'notice' && event.notice_type === 'friend_add') { refresh(); return }
      if (settings().temporaryPrivate !== true || !ready() || event.post_type !== 'message' || event.message_type !== 'private' || String(event.self_id || account) !== account) return
      const uid = String(event.user_id || event.sender?.user_id || '')
      if (!/^\d{5,12}$/.test(uid) || uid === account) return
      if (!friends.has(uid) && !temporaryContacts().has(uid)) {
        const contacts = [...temporaryContacts(), uid]
        api.setConfig({ ext: { liveGuard: { temporaryPrivateContacts: contacts } }, allow: { private: [...new Set([...(api.config().allow.private || []).map(String), uid])] } })
      }
      api.use('learning')?.syncContact?.(uid, friends.has(uid) ? 'friend' : 'temporary')
    })
    api.on('message', (msg) => { if (settings().enforce && !permitted(msg.chatId)) return true })
    api.on('prompt', (content, { chat } = {}) => settings().enforce && !permitted(chat?.chatId) ? null : content)
    api.on('send', (message, { chatId }) => settings().enforce && !permitted(chatId) ? null : message)
    api.tool(({ chat, sessionId }) => {
      if (!settings().enforce || settings().ownerOutbound !== true || chat.kind !== 'private' || String(chat.userId) !== String(api.config().ownerQQ)) return []
      const allowedOwner = () => ready() && settings().ownerOutbound === true && api.config().enabled && String(chat.userId) === String(api.config().ownerQQ) && api.core.hub.turnSendersAllOwner(sessionId)
      return [
        api.defineTool({ name: 'fy_friend_directory', description: '只列机器人当前已验证好友的QQ号；不读取这些人的聊天。发私信前核对真实对象，不凭名字猜账号。',
          execute: async () => allowedOwner() ? { ok: true, friends: [...friends] } : { ok: false, message: '当前身份或账号未核实' } }),
        api.defineTool({ name: 'fy_send_private_message', description: '操作者在本私聊要求你给某位已验证好友发消息时使用。你可决定接受或拒绝。回复当前操作者不算给第三人发送；只有sent=true及messageId才可报告已发。',
          properties: { userId: { type: 'string', description: '真实目标QQ号，必须在当前好友列表' }, text: { type: 'string', description: '实际发送的短消息，不附带私聊流水或CQ代码' } }, required: ['userId', 'text'],
          execute: async ({ userId, text }) => {
            const target = 'private:' + String(userId), cfg = api.config(), store = api.use('memory')?.store
            if (!allowedOwner() || !friends.has(String(userId)) || !permitted(target) || !store) return { ok: false, sent: false, message: '当前对象、权限或记忆账本未就绪' }
            if (typeof text !== 'string' || !text.trim() || text.length > 500 || /\[CQ:|【通道记录】/.test(text)) return { ok: false, sent: false, message: '消息内容无效' }
            if (cfg.dryRun) return { ok: true, sent: false, simulated: true, message: '试运行，未向目标发送' }
            const source = store.read().events.filter((e) => e.scope === chat.chatId && e.uid === String(chat.userId)).at(-1)
            if (!source) return { ok: false, sent: false, message: '缺少本轮真实操作者来源' }
            const id = createHash('sha256').update(source.id + '|' + target).digest('hex')
            const claimed = store.mutate((s) => { s.directMessages ||= []; if (s.directMessages.some((r) => r.id === id)) return false; s.directMessages.push({ id, source: source.id, target, status: 'attempted', at: Date.now() }); return true })
            if (!claimed) return { ok: false, sent: false, message: '本轮已向此对象尝试发送；先核对结果，不重复发送' }
            const settle = (status, extra = {}) => store.mutate((s) => Object.assign(s.directMessages.find((r) => r.id === id), { status, ...extra }))
            try {
              if (!allowedOwner() || !friends.has(String(userId)) || !permitted(target)) throw new Error('发送前授权已变化')
              const result = await api.sendSegments(target, [{ type: 'text', data: { text: text.trim() } }], '操作者要求的定向好友私信')
              if (result?.message_id == null || String(result.message_id).startsWith('sim-')) throw new Error('没有明确发送回执')
              settle('sent', { messageId: String(result.message_id) })
              return { ok: true, sent: true, messageId: String(result.message_id), target, message: '网关已返回发给该对象的消息编号。' }
            } catch (error) { settle('unknown'); return { ok: false, sent: false, unknown: true, message: '结果未确认，不自动重发：' + error.message } }
          },
        }),
      ]
    })
    api.route('/state', async () => ({ ok: true, ready: ready(), legacyDisabled: legacyDisabled(), account, friendCount: friends.size, temporaryPrivateEnabled: settings().temporaryPrivate === true, temporaryContactCount: temporaryContacts().size, checkedAt }))
    api.route('/refresh', async () => { await refresh(); return { ok: ready(), account, friendCount: friends.size } })
    return { ready, refresh, permitted, capabilities: capabilitySnapshot, isFriend: (uid) => ready() && friends.has(String(uid)), fangyuanImplementation: '0.5.0' }
  },
}
