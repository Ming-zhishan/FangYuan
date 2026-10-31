/** Only a real OneBot poke event can enter this policy; chat keywords never trigger it. */
const qq = id => /^\d{5,12}$/.test(String(id ?? ''))
const hour = 60 * 60 * 1000
const sensitive = /(?:紧急求助|求救|急救|报警|自杀|自残|家暴|住院|人身安全|去世|有人受伤)/
const neutral = ['嗯？', '叫我？', '怎么了？']
const familiar = ['又戳？', '你倒是闲。', '想说什么？']

export function pokeIdentity(raw, { botQQ, allowGroups = [] } = {}) {
  if (!raw || raw.post_type !== 'notice' || raw.notice_type !== 'notify' || raw.sub_type !== 'poke')
    return { ok: false, reason: 'not_poke' }
  const bot = String(botQQ ?? ''), sender = String(raw.user_id ?? ''), target = String(raw.target_id ?? '')
  const group = String(raw.group_id ?? '')
  if (!qq(bot) || !qq(sender) || !qq(target) || target !== bot || sender === bot)
    return { ok: false, reason: 'not_directed_at_bot' }
  if (!qq(group) || !allowGroups.some(id => String(id) === group))
    return { ok: false, reason: 'group_not_admitted' }
  return { ok: true, chatId: 'group:' + group, sender }
}

/** Pure decision: no file IO, model, network or actual sending. */
export function evaluatePoke({ raw, botQQ, allowGroups = [], state = {}, recent = [], isFamiliar = false,
  enabled = false, liveSend = false, now = Date.now() } = {}) {
  const identity = pokeIdentity(raw, { botQQ, allowGroups })
  if (!identity.ok) return identity
  if (!enabled || !liveSend) return { ok: false, reason: 'approval_required' }
  if (state.corrupt) return { ok: false, reason: 'state_unreadable' }
  if (raw.time != null && Number.isFinite(Number(raw.time)) &&
      Math.abs(now - Number(raw.time) * 1000) > 180000)
    return { ok: false, reason: 'stale_event' }
  if ((Array.isArray(recent) ? recent : []).some(row =>
    row?.text && now - Number(row.at ?? now) <= 600000 && sensitive.test(String(row.text))))
    return { ok: false, reason: 'sensitive_conversation' }
  const { chatId, sender } = identity
  const events = (Array.isArray(state.attempts) ? state.attempts : [])
    .filter(e => e && Number.isFinite(e.at) && e.at <= now && now - e.at < 24 * hour)
  const group = events.filter(e => e.chatId === chatId)
  const member = group.filter(e => e.sender === sender)
  if (group.some(e => now - e.at < 900000)) return { ok: false, reason: 'group_cooldown' }
  if (member.some(e => now - e.at < 1800000)) return { ok: false, reason: 'member_cooldown' }
  if (group.filter(e => now - e.at < hour).length >= 2)
    return { ok: false, reason: 'hourly_group_cap' }
  const phrases = isFamiliar ? familiar : neutral
  return { ok: true, chatId, sender, text: phrases[member.length % phrases.length], kind: isFamiliar ? 'familiar' : 'neutral' }
}

/** Reserve an attempt before sending; an unknown delivery outcome must not be retried. */
export function registerPokeAttempt(state, decision, now = Date.now()) {
  if (!decision?.ok || !qq(decision.sender)) throw new Error('Invalid poke decision')
  const attempts = (Array.isArray(state?.attempts) ? state.attempts : [])
    .filter(e => e && Number.isFinite(e.at) && e.at <= now && now - e.at < 24 * hour)
  attempts.push({ chatId: decision.chatId, sender: decision.sender, at: now, status: 'attempted' })
  return { version: 1, attempts }
}
