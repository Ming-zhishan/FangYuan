const scopeOf = (chat) => chat?.kind === 'private' && /^\d{5,12}$/.test(String(chat.userId)) ? `private:${chat.userId}` : ''
const PRIVATE = /^private:\d{5,12}$/

export default {
  id: 'speakup', name: '方源有依据的主动联系', api: 1, version: '0.2.0', tab: 'speakup',
  description: '有待续话题时可考虑回访；每小时也可按真实相处材料自己起一个新话题；两种都可以沉默。',
  setup(api) {
    let running = false, initiating = false
    const memory = () => api.use('memory')

    /** Authorization is re-read at the moment of sending; an old decision is not a licence. */
    async function confirmAndSend(chatId, text, label) {
      // Recheck current access after thinking; no stale settings or affinity-based authorization.
      const latest = api.config()
      if (!latest.enabled || latest.dryRun || latest.ext?.fangyuan?.proactive !== true || latest.ext?.fangyuan?.scopedMemory !== true || (latest.ext?.fangyuan?.proactiveAllContacts !== true && !(latest.ext?.fangyuan?.proactiveTargets || []).includes(chatId)) || api.core.mutes?.muted(chatId)) throw new Error('触发后权限或发送状态变化；未发送')
      const uid = chatId.slice(8)
      if (uid !== String(latest.ownerQQ) && !(latest.allow.private || []).map(String).includes(uid)) throw new Error('对象已不在允许范围')
      const result = await api.sendSegments(chatId, [{ type: 'text', data: { text } }], label)
      // Unknown adapter acknowledgements must never be described as confirmed delivery.
      if (!result || result.message_id === undefined || String(result.message_id).startsWith('sim-')) throw new Error('发送结果未明确确认，不自动重试')
    }

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
        if (hour < (cfg.speakUp?.awakeFrom ?? 6) || hour >= (cfg.speakUp?.awakeTo ?? 24)) return
        for (const job of state.jobs) {
          if (!policy.canFollowUp({ cfg, settings, job, now, isMuted: api.core.mutes?.muted(job.scope) })) continue
          const recent = state.events.filter((e) => e.scope === job.scope).at(-1)
          if (recent && recent.at > job.createdAt) { store.settle(job.id, 'expired'); continue }
          if (recent && now - recent.at < Math.max(5, cfg.speakUp.idleMinutes || 40) * 60000) continue
          const last = state.outcomes.filter((x) => x.status === 'attempted').at(-1)?.at || 0
          if (now - last < Math.max(5, cfg.speakUp.minIntervalMinutes || 60) * 60000) break
          await policy.attemptFollowUp({ store, job, now, think: (prompt) => api.core.hub.runSystemTurn(`fy-followup-${job.uid}`, '方源考虑回访', prompt, { noTools: true }), send: (chatId, text) => confirmAndSend(chatId, text, '方源主动联系') })
          break
        }
      } catch (error) { api.log.warn('主动联系未确认完成：', error.message) }
      finally { running = false }
    }

    /**
     * Hourly self-started topic. Nothing here waits for a new message or a scheduled job:
     * the material is the conversation's own record, and the model may still choose silence.
     */
    async function initiate() {
      if (initiating) return
      initiating = true
      try {
        const cfg = api.config(), settings = cfg.ext?.fangyuan || {}, store = memory()?.store, service = api.use('fangyuan')
        if (!store || !service?.canInitiate || !service?.attemptInitiation) return
        const s = cfg.speakUp || {}
        if (s.initiative === false) return
        const now = Date.now(), hour = new Date(now).getHours()
        if (hour < (s.awakeFrom ?? 6) || hour >= (s.awakeTo ?? 24)) return
        const state = store.read()
        const attempts = (state.initiatives || []).filter((x) => now - x.at < 86400000)
        if (attempts.length >= Math.max(0, Number(s.initiativeMaxPerDay ?? 24))) return
        // Hourly means hourly attempts, including ones that ended in silence; a declined hour is not retried every minute.
        const log = store.proactiveLog()
        const recentLog = log.filter((x) => now - x.at < 86400000)
        const lastAttempt = Math.max(0, ...attempts.map((x) => x.at), ...recentLog.map((x) => x.at))
        if (now - lastAttempt < Math.max(20, Number(s.initiativeEveryMinutes) || 60) * 60000) return
        const idle = Math.max(5, Number(s.idleMinutes) || 40) * 60000
        const allowed = new Set((cfg.allow?.private || []).map(String))
        const listed = settings.proactiveAllContacts === true ? [...allowed].map((uid) => `private:${uid}`) : (settings.proactiveTargets || []).map(String)
        const seen = new Set()
        const candidates = listed.map((raw) => PRIVATE.test(raw) ? raw : /^\d{5,12}$/.test(raw) ? `private:${raw}` : '')
          .filter((scope) => scope && !seen.has(scope) && seen.add(scope))
          .filter((scope) => service.canInitiate({ cfg, settings, scope, isMuted: api.core.mutes?.muted(scope) }))
          .map((scope) => {
            const events = state.events.filter((e) => e.scope === scope && !e.forgotten && !e.obsoleteSelfReport)
            return { scope, events, facts: state.facts.filter((f) => f.active && !f.forgotten && f.scope === scope), lastAt: events.at(-1)?.at || 0, lastProactive: log.filter((x) => x.scope === scope).at(-1)?.at || 0 }
          })
          // Silence in the middle of an active exchange is not a gap to fill; a topic needs a lull and real material.
          .filter((x) => x.events.length && now - x.lastAt >= idle && (x.facts.length || x.events.length >= 2))
          .filter((x) => !(state.jobs || []).some((job) => job.scope === x.scope && job.status === 'pending' && job.dueAt <= now))
        if (!candidates.length) return
        candidates.sort((a, b) => a.lastProactive - b.lastProactive || b.lastAt - a.lastAt || a.scope.localeCompare(b.scope))
        const chosen = candidates[0], uid = chosen.scope.slice(8)
        const learning = api.use('learning')
        let learned = ''
        try { if (learning?.permitted?.(chosen.scope)) learned = learning.store.context(chosen.scope, [uid], '', 900) } catch (error) { learned = '' }
        const material = {
          tone: state.relationshipTones?.[uid]?.tone || '',
          facts: chosen.facts.slice(-6).reverse().map((f) => ({ kind: f.kind, text: f.text, at: f.at })),
          episodes: chosen.events.filter((e) => String(e.text || '').trim().length >= 4).slice(-10).map((e) => ({ text: e.text, at: e.at })),
          previous: (state.outputs || []).filter((o) => o.scope === chosen.scope).slice(-2).map((o) => ({ text: o.text, at: o.at })),
          learned: learned && !/^\s*$/.test(learned) ? learned : '',
        }
        const recentTopics = [
          ...(state.initiatives || []).filter((x) => x.scope === chosen.scope && x.text && now - x.at < 72 * 3600000).map((x) => x.text),
          ...(state.outputs || []).filter((o) => o.scope === chosen.scope && o.text && now - o.at < 72 * 3600000).slice(-3).map((o) => o.text),
        ]
        await service.attemptInitiation({ store, scope: chosen.scope, now, material, recentTopics,
          think: (prompt) => api.core.hub.runSystemTurn(`fy-initiative-${uid}`, '方源考虑主动起话题', prompt, { noTools: true }),
          send: (chatId, text) => confirmAndSend(chatId, text, '方源主动起话题') })
      } catch (error) { api.log.warn('主动起话题未确认完成：', error.message) }
      finally { initiating = false }
    }

    api.every(60000, tick, '方源检查待续话题')
    api.every(60000, initiate, '方源考虑主动起话题')
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
    return { fangyuanImplementation: '0.1.0', version: '0.2.0', tick, initiate, state: () => ({ jobs: memory()?.store?.read().jobs || [], initiatives: memory()?.store?.read().initiatives || [] }) }
  },
}
