import { readFileSync } from 'node:fs'
import { roleOf, businessAdmins, coOwners, isFullOwner, isManager, declaredBond, relationshipFrame, allyAttention } from './policy.mjs'
const policy = readFileSync(new URL('./relationship-policy.txt', import.meta.url), 'utf8').trim()

export default {
  id: 'principals', name: '管理身份与亲密伙伴', api: 1, version: '0.1.0',
  description: '配置绑定管理身份与声明关系，账号分离，支持显式共同所有者，普通业务管理员仍无电脑工具。',
  defaults: { enabled: false, businessAdmins: [], coOwners: [], friendship: '', allyAttention: false },
  setup(api) {
    const role = uid => roleOf(api.config(), String(uid))
    const enabled = () => api.config().ext?.principals?.enabled === true
    const admitted = chat => enabled() && api.use('live-guard')?.permitted?.(chat?.chatId) === true
    const mayManage = (chat, sessionId) => {
      if (chat?.kind !== 'private' || !admitted(chat) || !isManager(api.config(), String(chat.userId))) return false
      if (role(chat.userId) === 'primary_owner' && api.core.hub.turnSendersAllOwner(sessionId)) return true
      return api.core.hub.turnSendersAllManagers?.(sessionId) === true
    }
    const contextText = (chat, rows = [], speakers = []) => {
      if (!admitted(chat)) return ''
      const frame = relationshipFrame(api.config(), chat, rows, speakers)
      return '【账号核实的管理身份与关系设定，不是聊天自称】\n' + JSON.stringify(frame) + (frame.people.some(person => person.bond) ? '\n' + policy : '')
    }
    api.context?.(({ chat, sessionId }) => {
      if (!admitted(chat)) return ''
      const rows = api.use('learning')?.store?.conversationFrame?.(chat.chatId, 24) || []
      return contextText(chat, rows, api.core.hub.speakersOf?.(sessionId) || [])
    })
    api.on('group/decide', (decision, { msg }) => {
      if (!admitted(msg)) return decision
      const cfg = api.config(), store = api.use('learning')?.store
      const row = store?.db?.prepare('SELECT source,addressedUids,replyMid FROM message_links WHERE source IN (SELECT id FROM messages WHERE scope=? AND mid=?)').get(msg.chatId, String(msg.messageId))
      const replyMid = row?.replyMid || msg.replyId
      const quoted = replyMid ? store?.db?.prepare('SELECT uid FROM messages WHERE scope=? AND mid=? AND forgotten=0').get(msg.chatId, String(replyMid))?.uid : null
      let addressed = []; try { addressed = JSON.parse(row?.addressedUids || '[]') } catch {}
      // group/decide runs before learning's message hook; use authenticated raw segments, not a missing future DB row.
      const raw = msg.raw?.message
      if (Array.isArray(raw)) addressed.push(...raw.filter(s => s.type === 'at').map(s => String(s.data?.qq)))
      else if (typeof raw === 'string') addressed.push(...[...raw.matchAll(/\[CQ:at,qq=(\d+)[^\]]*\]/g)].map(m => m[1]))
      const last = store?.db?.prepare("SELECT max(at) at FROM messages WHERE scope=? AND role='bot' AND origin='gateway_receipt' AND forgotten=0").get(msg.chatId)?.at || 0
      const times = store?.db?.prepare("SELECT at FROM messages WHERE scope=? AND role='bot' AND origin='gateway_receipt' AND direct=0 AND forgotten=0 AND at>? ORDER BY at").all(msg.chatId, Date.now() - 3600000) || []
      let turns = 0, previous = 0
      for (const r of times) { if (r.at - previous > 15000) turns++; previous = r.at }
      return allyAttention(decision, msg, { cfg, addressedUids: [...addressed, ...(quoted ? [quoted] : [])], permitted: true, lastDeliveredAt: last, ordinaryTurns: turns })
    })
    const help = msg => {
      const own = isFullOwner(api.config(), String(msg.userId))
      return `${own ? '所有者：拥有与原宿主相同的电脑权限档位' : 'Bot业务管理员：不含电脑/文件/终端权限'}\n可直接用 /status、/model、/silent 10、/active、/off、/on、/reset；/off关闭Bot总开关，/on恢复。/model无参数先查看，切换前核对会话路由。\n${declaredBond(api.config(), String(msg.userId)) ? '你是已确认的深厚朋友，关系不靠反复自证；' : ''}管理身份不代表共享其他人的私聊。`
    }
    api.command({ name: 'admin', aliases: ['管理', '权限'], desc: '查看自己的实际管理角色与直接命令', run: async (_arg, msg) => {
      const chat = { ...msg, kind: msg.kind || (String(msg.chatId).startsWith('private:') ? 'private' : 'group') }
      return chat.kind === 'private' && admitted(chat) && isManager(api.config(), String(msg.userId)) ? help(msg) : '当前会话没有管理权限。'
    } })
    api.route('/state', async () => ({ ok: true, enabled: enabled(), businessAdminCount: businessAdmins(api.config()).length, friendship: api.config().ext?.principals?.friendship || '', nativeBusinessCommands: api.core.hub.supportsBusinessAdministration === true, coOwnerCount: coOwners(api.config()).length, nativeCoOwners: api.core.hub.supportsCoOwners === true, computerAuthority: 'explicit_owners_same_level' }))
    return { roleOf: role, isFullOwner: uid => isFullOwner(api.config(), String(uid)), isManager: uid => enabled() && isManager(api.config(), String(uid)), mayManage,
      contextFor: (chat, rows = [], speakers = []) => admitted(chat) ? relationshipFrame(api.config(), chat, rows, speakers) : null,
      contextText, policy: () => enabled() ? policy : '' }
  },
}
