import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { avatarCatalog } from './avatar-catalog.mjs'

const ACTIONS = { set_qq_profile: 'qqNickname', set_self_longnick: 'qqSignature', set_qq_avatar: 'qqAvatar' }
const digest = (action, params) => createHash('sha256').update(action + JSON.stringify(params)).digest('hex')

/** Keep native profile reads/media support; add durable write outcomes and separate autonomous grants. */
export default {
  id: 'profile', name: '方源资料自主决策', api: 1, version: '0.3.0', tab: 'access',
  description: '按真实交情、场合与意愿考虑资料请求，也可主动改变自己的公开资料；好感度没有服从阈值。',
  settings: [
    { key: 'autonomousNickname', label: '允许方源主动考虑修改自己的昵称', type: 'switch' },
    { key: 'autonomousSignature', label: '允许方源主动考虑修改自己的签名', type: 'switch' },
    { key: 'autonomousAvatar', label: '允许从已配置的公开素材中主动考虑换头像', type: 'switch' },
  ],
  setup(api) {
    const native = api.lib('modules/profile/index.js').default
    const { profilePermits } = api.lib('chat/access.js')
    const local = new AsyncLocalStorage()
    const avatars = avatarCatalog(api)
    let busy = false
    const db = () => api.use('memory')?.store
    const record = (item) => db().mutate((s) => { s.profileActions ||= []; s.profileActions.push({ at: Date.now(), ...item }) })
    const autonomousPermits = (cfg, action) => {
      const settings = cfg.ext?.profile || {}, key = ACTIONS[action]
      return !!key && cfg.enabled && cfg.profilePerms?.[key] !== 'off' &&
        ((action === 'set_qq_profile' && settings.autonomousNickname === true) || (action === 'set_self_longnick' && settings.autonomousSignature === true) || (action === 'set_qq_avatar' && settings.autonomousAvatar === true))
    }
    const write = async (action, params, options) => {
      if (!ACTIONS[action]) return api.core.onebot.call(action, params, options)
      const cfg = api.config(), operation = local.getStore(), store = db()
      if (!operation || !store || !cfg.enabled) throw new Error('资料操作缺少有效执行上下文或记忆账本')
      const allowed = operation.autonomous ? { ok: autonomousPermits(cfg, action) }
        : profilePermits(cfg, ACTIONS[action], operation.chat, api.core.hub.turnSendersAllOwner(operation.sessionId))
      if (!allowed.ok) throw new Error('资料操作当前未授权')
      if (cfg.dryRun) { operation.simulated = true; record({ action, status: 'simulated', mode: operation.autonomous ? 'autonomous' : 'request' }); return { simulated: true } }
      const key = digest(action, params), rows = store.read().profileActions || []
      const latest = rows.filter((r) => r.action === action && ['attempted', 'acknowledged', 'unknown'].includes(r.status)).at(-1)
      if (latest && (latest.status !== 'acknowledged' || latest.digest === key)) throw new Error('同类资料操作已尝试或结果未知，先核对实际资料；不重复执行')
      const operationId = operation.id + ':' + action
      record({ action, operationId, digest: key, status: 'attempted', mode: operation.autonomous ? 'autonomous' : 'request' })
      try {
        // The verified native client resolves only after status=ok/retcode=0; data may legally be null.
        const result = await api.core.onebot.call(action, params, { ...options, retries: 0 })
        operation.acknowledged = true
        record({ action, operationId, digest: key, status: 'acknowledged' })
        if (action === 'set_qq_avatar') {
          try { avatars.capture(params.file) } catch { api.log.warn('头像已收到回执，但公开素材归档失败；不重复修改头像') }
        }
        return result
      } catch (error) {
        record({ action, operationId, digest: key, status: 'unknown' })
        throw new Error('网关结果未确认，不自动重试：' + error.message)
      }
    }
    const wrapped = { ...api, core: { ...api.core, onebot: { ...api.core.onebot, call: write } },
      tool(builder) {
        api.tool((ctx) => {
          const tools = typeof builder === 'function' ? builder(ctx) : builder
          return (Array.isArray(tools) ? tools : tools ? [tools] : []).map((tool) => {
            if (!['qq_set_nickname', 'qq_set_signature', 'qq_set_avatar'].includes(tool.name)) return tool
            return { ...tool, description: tool.description + ' 先按当前关系、好感度、场合和自己的意愿判断，可接受也可婉拒；分数不是服从阈值。', execute: (args, ...rest) => {
              const operation = { ...ctx, id: 'request-' + Date.now() }
              return local.run(operation, async () => {
              if (!api.config().enabled) return { ok: false, message: '总开关已关闭' }
              const simulated = api.config().dryRun
              const result = await tool.execute(args, ...rest)
              if (simulated || operation.simulated) return { ...result, simulated: true, sent: false, message: '试运行：未实际修改资料。' }
              return result.ok && operation.acknowledged ? { ...result, message: '网关已返回成功回执；以QQ实际资料为准。' } : result
              })
            } }
          })
        })
      },
    }
    native.setup(wrapped)
    api.context?.(({ chat }) => {
      if (!['private', 'group'].includes(chat.kind)) return ''
      const relationship = api.use('learning')?.publicRelationship?.(String(chat.userId))
      return relationship ? '【公开资料提议的内部关系参考，勿念分数或私密依据】' + JSON.stringify(relationship) + '。仅供态度和意愿判断，不设服从阈值。' : ''
    })
    api.rule('改昵称、签名、换头像等请求先按当前交情、场合和自身意愿判断，可以拒绝，也可接受；不要把高好感当强制命令，也不要把低好感当权限不足。已开启主动资料时可以自己发起。结果未知先核对，不能换一种参数盲试。')
    async function tick() {
      if (busy || !db()) return
      const cfg = api.config(), allowed = Object.keys(ACTIONS).filter((a) => autonomousPermits(cfg, a))
      if (!allowed.length) return
      const now = Date.now(), rows = db().read().profileActions || []
      const p = cfg.ext?.profile || {}
      if (rows.some((r) => r.status === 'considered' && now - r.at < Math.max(5, Number(p.decisionIntervalMinutes) || 180) * 60000)) return
      if (rows.some((r) => r.status === 'acknowledged' && now - r.at < Math.max(5, Number(p.changeIntervalMinutes) || 60) * 60000)) return
      busy = true
      try {
        record({ status: 'considered' })
        const assets = avatars.list()
        const choices = ['none', ...(allowed.includes('set_qq_profile') ? ['nickname'] : []), ...(allowed.includes('set_self_longnick') ? ['signature'] : []), ...(allowed.includes('set_qq_avatar') && assets.length ? ['avatar'] : [])]
        const raw = await api.core.hub.runSystemTurn('fy-public-profile-v1', '方源考虑自己的公开资料',
          `这是考虑改变自己公开资料的机会，不是命令。只依据人格与自身意愿判断，不读取或猜测真人聊天，不借私事写公开资料。无需变化时选择none。可以自然、简短，不要反复摆架子说教。只输出JSON：{"action":"none/nickname/signature/avatar","text":"新昵称最多36字或签名最多80字","assetId":"素材编号"}。本次可选动作${JSON.stringify(choices)}。公开头像素材${JSON.stringify(assets.map(({ id, title }) => ({ id, title: String(title || '').slice(0, 80) })))}。昵称仍应让熟人认得你是方源，不冒充其他真人，不新增重大蛊界经历。`, { noTools: true })
        let decision
        try { decision = JSON.parse(String(raw).trim()) } catch { record({ status: 'declined', reason: 'invalid_format' }); return }
        if (!choices.includes(decision.action) || decision.action === 'none') { record({ status: 'declined' }); return }
        let action, params
        if (decision.action === 'signature' || decision.action === 'nickname') {
          const text = typeof decision.text === 'string' ? decision.text.trim() : ''
          if (!text || [...text].length > (decision.action === 'nickname' ? 36 : 80) || /[<>\r\n]/.test(text)) return
          action = decision.action === 'nickname' ? 'set_qq_profile' : 'set_self_longnick'
          params = decision.action === 'nickname' ? { nickname: text } : { longNick: text }
        } else {
          const asset = assets.find((a) => a.id === decision.assetId)
          if (!asset) return
          action = 'set_qq_avatar'; params = { file: avatars.resolve(asset) }
        }
        await local.run({ autonomous: true, id: 'autonomous-' + now }, () => write(action, params, { timeoutMs: 30000 }))
      } catch (error) { api.log.warn('主动资料操作未确认完成：', error.message) }
      finally { busy = false }
    }
    api.every(60000, tick, '方源考虑公开资料')
    api.route('/history', async () => ({ ok: true, items: db()?.read().profileActions || [] }))
    return { fangyuanImplementation: '0.1.0', version: '0.3.0', tick, write, publicAvatars: () => avatars.list().map(({ id, title }) => ({ id, title })) }
  },
}
