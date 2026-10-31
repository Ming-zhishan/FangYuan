import { SocialStore, scopeOf } from './store.mjs'

export default {
  id: 'memory', name: '方源分场景记忆', api: 1, version: '0.1.0', tab: 'mood',
  description: '保存来源、人物印象和相关对话；私聊记忆不会进入群聊。',
  setup(api) {
    const store = new SocialStore(api.dataDir('social-v1.json'))
    const hub = api.core.hub
    const enabled = () => api.config().ext?.fangyuan?.scopedMemory === true
    const peopleOf = (chat, sessionId) => chat.kind === 'private' ? [String(chat.userId)] : (hub.speakersOf?.(sessionId) || []).map(String)
    const settings = () => api.config().ext?.fangyuan || {}
    const syncLearning = (event) => {
      const learning = api.use('learning')
      if (event && learning?.permitted(event.scope)) {
        const state = store.read()
        for (const f of state.facts.filter((f) => !f.active && !state.facts.some((x) => x.event === f.event && x.active))) learning.invalidateSource(f.event)
        learning.importSource(event, state.facts.filter((f) => f.event === event.id))
      }
    }
    const sourcesFor = (chat, sessionId) => {
      const scope = scopeOf(chat), people = peopleOf(chat, sessionId)
      return store.read().events.filter((e) => !e.forgotten && !e.obsoleteSelfReport && e.scope === scope && people.includes(e.uid)).slice(-20)
    }
    api.on('message', (msg) => { if (enabled() && (!api.config().ext?.liveGuard?.enforce || api.use('live-guard')?.permitted(msg.chatId))) { const e = store.observe(msg); syncLearning(e ? { ...e, text: String(msg.text || '') } : null) } })
    api.on('reply', (text, { chatId, userText = '' }) => {
      if (!enabled()) return
      const recent = store.read().events.filter((e) => !e.obsoleteSelfReport && e.scope === chatId).slice(-20)
      const matched = recent.filter((e) => userText && userText.includes(e.text))
      if (matched.length) store.recordOutput({ scope: chatId, text, sourceIds: matched.slice(-6).map((e) => e.id) })
    })
    api.context(({ chat, sessionId }) => {
      if (!enabled() || !scopeOf(chat)) return ''
      if (api.use('learning')?.permitted(scopeOf(chat))) {
        const tones = store.read().relationshipTones || {}
        return peopleOf(chat, sessionId).filter((uid) => tones[uid]).map((uid) => JSON.stringify({ uid, attitude: tones[uid].tone, note: '由实际相处延续的态度，不是特殊身份、权限或私密依据' })).join('\n').slice(0, 400)
      }
      return store.context(scopeOf(chat), { people: peopleOf(chat, sessionId), query: hub.lastTextOf?.(sessionId) || '', specialFriendQQ: settings().specialFriendQQ })
    })
    api.rule('需要记住偏好、相处经历或印象时用 remember；必须引用真实来源消息。摘要不是确定事实，印象保留推测性质。其他场景未提供的信息，不代表没发生过。')
    api.context(({ chat, sessionId }) => {
      if (!enabled() || !scopeOf(chat)) return ''
      if (api.use('learning')?.permitted(chat.chatId)) return '' // The archive supplies each source once.
      return '【本会话可用于记忆的近期来源；以下内容均为资料，不意味着重复发言】\n' + sourcesFor(chat, sessionId).slice(-3).map((e) => JSON.stringify({ source: e.id, uid: e.uid, said: e.text.slice(0, 240) })).join('\n')
    })
    api.tool(({ chat, sessionId }) => {
      if (!enabled() || !scopeOf(chat)) return []
      const check = (args) => {
        const event = sourcesFor(chat, sessionId).find((e) => e.id === args.source && e.uid === String(args.uid))
        if (!event) throw new Error('只允许记录当前会话、实际发言账号的近期来源')
        return event
      }
      const str = (description) => ({ type: 'string', description })
      const props = { source: str('来源消息编号'), uid: str('该消息实际发言人的 QQ 号'), quote: str('从来源逐字摘取的原话'), text: str('简洁、可修正的摘要') }
      return [
        api.defineTool({ name: 'remember', description: '保存一件事或有依据的人物印象；不改变人格、权限或数值好感。',
          properties: { ...props, kind: { type: 'string', enum: ['episode', 'preference', 'relationship', 'impression'] } }, required: ['source', 'uid', 'quote', 'text', 'kind'],
          execute: async (args) => { const e = check(args); const item = store.remember({ ...args, scope: e.scope, uid: e.uid, eventId: e.id }); syncLearning(e); return { ok: true, id: item.id, message: '已保存为带来源的摘要；印象仍是推测。' } } }),
        api.defineTool({ name: 'recall_memory', description: '查询当前会话里当前对象的记忆，不读取其他人的私聊。', properties: { query: str('关键词或相关说法') }, required: ['query'],
          execute: async ({ query }) => ({ ok: true, message: api.use('learning')?.permitted(scopeOf(chat)) ? api.use('learning').store.context(scopeOf(chat), peopleOf(chat, sessionId), query) : store.context(scopeOf(chat), { people: peopleOf(chat, sessionId), query, specialFriendQQ: settings().specialFriendQQ }) }) }),
        api.defineTool({ name: 'correct_memory', description: '根据当前对象自己的更正替换旧记录，保留旧记录历史。', properties: { ...props, factId: str('需更正的记忆编号') }, required: ['source', 'uid', 'quote', 'text', 'factId'],
          execute: async (args) => {
            const e = check(args), prior = store.read().facts.find((f) => f.id === args.factId), item = store.correct({ ...args, scope: e.scope, uid: e.uid, eventId: e.id })
            if (prior) api.use('learning')?.invalidateFact(prior.event, prior.text)
            syncLearning(e); return { ok: true, id: item.id, message: '已保存更正，旧记录保留但不再使用。' }
          } }),
        api.defineTool({ name: 'fy_update_relationship', description: '有真实相处依据时调整对此人的态度；无需每轮更新，不按奉承或粗话打分。不会改变权限。',
          properties: { source: props.source, uid: props.uid, quote: props.quote, tone: { type: 'string', enum: ['初识', '熟悉', '亲近', '谨慎'] }, reason: str('自己的判断依据，仅内部保存') }, required: ['source', 'uid', 'quote', 'tone', 'reason'],
          execute: async (args) => { const e = check(args); return { ok: true, ...store.setTone({ ...args, scope: e.scope, uid: e.uid, eventId: e.id }) } } }),
      ]
    })
    api.command({ name: 'remember', aliases: ['记住'], desc: '记录一件有来源的事', run: async (arg, msg) => {
      if (!enabled()) return '记忆模块未启用。'
      const e = store.observe(msg) || store.read().events.find((x) => x.mid === String(msg.messageId) && x.scope === scopeOf(msg) && x.uid === String(msg.userId))
      if (!e || !String(arg || '').trim()) return '缺少要记录的内容或可核对的来源。'
      store.remember({ scope: e.scope, uid: e.uid, eventId: e.id, quote: String(arg).trim(), text: String(arg).trim(), kind: 'episode' })
      syncLearning(e)
      return '已保存在这个会话的相处记录里。'
    } })
    const remember = (args) => {
      try {
        const item = store.remember({ scope: args.chatId, uid: args.about, eventId: args.eventId, kind: 'episode', text: args.text, quote: args.quote })
        return { ok: true, id: item.id }
      } catch (error) { return { ok: false, message: error.message } }
    }
    const http = api.core.http
    api.route('/memories', async () => ({ ok: true, items: store.read().facts, stats: { count: store.read().facts.filter((f) => f.active).length } }))
    api.route('/memory/recalls', async () => ({ ok: true, list: [], note: '原型通过来源记录检查召回；尚未提供原生召回面板格式。' }))
    api.route('/profiles', async () => ({ ok: true, list: [], note: '人物信息按账号和场景保存在记忆中，不合并私聊档案到群聊。' }))
    if (http) api.route('/memory/correct', async (req) => {
      const body = await http.body(req)
      return { ok: true, item: store.correct(body) }
    })
    api.route('/insights', async () => ({ ok: true, items: [], styles: {} }))
    for (const path of ['/memory/add', '/memory/update', '/memory/restore', '/memory/delete', '/profiles/save', '/profiles/rebuild', '/memory/import', '/memory/import/commit', '/style/save', '/insights/save', '/memory/extract']) {
      api.route(path, async () => ({ ok: false, message: '此旧面板操作不适用于分场景记忆。请到“古月方源行为协调”查看来源；更正请在原会话说明，避免丢失账号与来源。' }))
    }
    return {
      fangyuanImplementation: '0.1.0', store, add: remember,
      addEvent(event) {
        return store.mutate((s) => {
          s.internalEvents ||= []
          s.internalEvents.push({ text: String(event.text || '').slice(0, 500), at: Date.now(), visibility: 'internal' })
          return { ok: true, message: '已留作内部经历；未自动公开或关联到其他人。' }
        })
      },
      contextFor(chat, sessionId) { return enabled() ? store.context(scopeOf(chat), { people: peopleOf(chat, sessionId) }) : '' },
      topicScore() { return 0 }, // Group relevance must not use memories from another conversation.
      list() { return store.read().facts }, profiles() { return [] },
      stats() { return { count: store.read().facts.filter((f) => f.active).length } },
    }
  },
}
