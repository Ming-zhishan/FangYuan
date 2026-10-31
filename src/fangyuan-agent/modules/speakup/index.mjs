const scopeOf = (chat) => chat?.kind === 'private' && /^\d{5,12}$/.test(String(chat.userId)) ? `private:${chat.userId}` : ''

export default {
  id: 'speakup', name: '方源有依据的主动联系', api: 1, version: '0.1.0', tab: 'speakup',
  description: '有真实来源、有待续话题才考虑联系；可以沉默，不随机撒娇。',
  setup(api) {
    let running = false
    const memory = () => api.use('memory')
    async function tick() {
      if (running) return
      running = true
      try {
        const cfg = api.config(), settings = cfg.ext?.fangyuan || {}, store = memory()?.store
        const policy = api.use('fangyuan')
        if (!store || !policy) return
        const now = Date.now(), state = store.read()
        const max = Math.max(0, Number(cfg.speakUp?.maxPerDay) || 0)
        if (state.outcomes.filter((x) => x.status === 'attempted' && now - x.at < 86400000).length >= max) return
        const hour = new Date(now).getHours()
        if (hour < (cfg.speakUp?.awakeFrom ?? 8) || hour >= (cfg.speakUp?.awakeTo ?? 23)) return
        for (const job of state.jobs) {
          if (!policy.canFollowUp({ cfg, settings, job, now, isMuted: api.core.mutes?.muted(job.scope) })) continue
          const recent = state.events.filter((e) => e.scope === job.scope).at(-1)
          if (recent && recent.at > job.createdAt) { store.settle(job.id, 'expired'); continue }
          if (recent && now - recent.at < Math.max(5, cfg.speakUp.idleMinutes || 40) * 60000) continue
          const last = state.outcomes.filter((x) => x.status === 'attempted').at(-1)?.at || 0
          if (now - last < Math.max(5, cfg.speakUp.minIntervalMinutes || 60) * 60000) break
          await policy.attemptFollowUp({ store, job, now, think: (prompt) => api.core.hub.runSystemTurn(`fy-followup-${job.uid}`, '方源考虑回访', prompt, { noTools: true }), send: async (chatId, text) => {
            // Recheck current access after thinking; no stale settings or affinity-based authorization.
            const latest = api.config()
            if (!latest.enabled || latest.dryRun || latest.ext?.fangyuan?.proactive !== true || latest.ext?.fangyuan?.scopedMemory !== true || (latest.ext?.fangyuan?.proactiveAllContacts !== true && !(latest.ext?.fangyuan?.proactiveTargets || []).includes(chatId)) || api.core.mutes?.muted(chatId)) throw new Error('触发后权限或发送状态变化；未发送')
            const uid = chatId.slice(8)
            if (uid !== String(latest.ownerQQ) && !(latest.allow.private || []).map(String).includes(uid)) throw new Error('对象已不在允许范围')
            const result = await api.sendSegments(chatId, [{ type: 'text', data: { text } }], '方源主动联系')
            // Unknown adapter acknowledgements must never be described as confirmed delivery.
            if (!result || result.message_id === undefined || String(result.message_id).startsWith('sim-')) throw new Error('发送结果未明确确认，不自动重试')
          } })
          break
        }
      } catch (error) { api.log.warn('主动联系未确认完成：', error.message) }
      finally { running = false }
    }
    api.every(60000, tick, '方源检查待续话题')
    api.tool(({ chat, sessionId }) => {
      const scope = scopeOf(chat)
      if (!scope || chat.kind !== 'private') return []
      if (api.config().ext?.fangyuan?.proactive !== true) return []
      return api.defineTool({ name: 'fy_follow_up_later', description: '为真实谈过的话题留一次待续机会；到时自行判断是否愿意联系。不是承诺必发，也不是永久排程。',
        properties: { source: { type: 'string', description: '本私聊近期来源编号' }, reason: { type: 'string', description: '为何值得之后继续' }, dueAt: { type: 'string', description: '未来时间，ISO 格式，带时区' } }, required: ['source', 'reason', 'dueAt'],
        execute: async ({ source, reason, dueAt }) => {
          const store = memory()?.store
          if (!store) return { ok: false, message: '记忆模块不可用，未创建' }
          const event = store.read().events.filter((e) => e.scope === scope && e.uid === String(chat.userId)).slice(-20).find((e) => e.id === source)
          if (!event) return { ok: false, message: '未找到本人的近期来源' }
          const job = store.schedule({ scope, uid: chat.userId, eventId: source, reason, dueAt: Date.parse(dueAt) })
          return { ok: true, id: job.id, message: '已保留一次待续机会；实际联系仍按意愿、时机和授权判断。' }
        },
      })
    })
    return { fangyuanImplementation: '0.1.0', tick, state: () => ({ jobs: memory()?.store?.read().jobs || [] }) }
  },
}
