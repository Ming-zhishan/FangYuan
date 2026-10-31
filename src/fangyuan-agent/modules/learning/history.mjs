import { hash } from './store.mjs'
import { messageLinks, describeDeliveredMessage } from './message-context.mjs'

export const rawText = (m) => typeof m.message === 'string' ? m.message.replace(/\[CQ:[^\]]+\]/g, '[非文本片段]') : (m.message || []).map((s) => s.type === 'text' ? s.data?.text || '' : s.type === 'at' ? `<at:${s.data?.qq}>` : `[${s.type || '非文本'}]`).join('')

export function heartbeat(store, connected, scopes, now = store.clock()) {
  const previous = store.get('presence'), gapStart = store.get('disconnectStart')
  if (!connected) {
    if (!gapStart) store.set('disconnectStart', previous?.at || now)
  } else {
    const start = gapStart || (previous && now - previous.at > 120000 ? previous.at : null)
    if (start && (gapStart || now - start > 120000)) {
      const id = hash(`gap|${start}|${now}`)
      store.db.prepare('INSERT OR IGNORE INTO gaps VALUES(?,?,?,?)').run(id, start, now, 'last confirmed online to resumed connection; exact outage start unknown')
      for (const scope of scopes) store.db.prepare('INSERT OR IGNORE INTO coverage(id,gap,scope) VALUES(?,?,?)').run(hash(id + scope), id, scope)
    }
    store.set('disconnectStart', null)
  }
  store.set('presence', { at: now, connected })
}

export function scheduleReconciliation(store, scopes) {
  const now = store.clock()
  for (const scope of scopes) {
    if (store.db.prepare("SELECT c.id FROM coverage c JOIN gaps g ON g.id=c.gap WHERE c.scope=? AND g.reason='delivery_reconciliation' AND c.status!='covered' LIMIT 1").get(scope)) continue
    const last = store.get('lastSync:' + scope) || store.db.prepare('SELECT max(at) at FROM messages WHERE scope=?').get(scope)?.at || now - 86400000
    if (now - last < 300000) continue
    const id = hash(`reconcile|${scope}|${last}|${now}`)
    store.db.prepare('INSERT OR IGNORE INTO gaps VALUES(?,?,?,?)').run(id, last - 1000, now, 'delivery_reconciliation')
    store.db.prepare('INSERT OR IGNORE INTO coverage(id,gap,scope) VALUES(?,?,?)').run(hash(id + scope), id, scope)
  }
}

/** Older pages must move backwards. Empty/failing/stalled pages prove a coverage gap, not completeness. */
export async function recoverPage(store, coverage, { call, permitted, selfId, count = 100, stickers = [] }) {
  if (!permitted(coverage.scope)) return
  const gap = store.db.prepare('SELECT * FROM gaps WHERE id=?').get(coverage.gap), group = coverage.scope.startsWith('group:')
  const params = { [group ? 'group_id' : 'user_id']: coverage.scope.split(':')[1], count, reverse_order: true, ...(coverage.cursor ? { message_seq: coverage.cursor } : {}) }
  try {
    const data = await call(group ? 'get_group_msg_history' : 'get_friend_msg_history', params, { retries: 0, timeoutMs: 20000 })
    if (!permitted(coverage.scope)) throw new Error('scope_no_longer_authorized')
    const messages = data?.messages
    if (!Array.isArray(messages) || !messages.length) throw new Error('history_empty_coverage_unproven')
    const sorted = messages.filter((m) => Number.isFinite(Number(m.time)) && Number(m.time) > 0).sort((a, b) => Number(a.time) - Number(b.time))
    if (!sorted.length) throw new Error('history_missing_timestamps')
    for (const m of sorted) {
      const uid = String(m.user_id || m.sender?.user_id || ''), at = Number(m.time) * 1000
      if (at < gap.start || at > gap.end) continue
      const role = uid === String(selfId) ? 'bot' : 'user'
      const direct = !group || (m.message || []).some?.((s) => s.type === 'at' && String(s.data?.qq) === String(selfId)) || rawText(m).includes('[CQ:at,qq=' + selfId)
      const row = store.observe({ scope: coverage.scope, uid, mid: m.message_id || m.message_seq, at, text: rawText(m), origin: gap.reason === 'delivery_reconciliation' ? 'reconciled_history' : 'history', role, direct })
      if (row) {
        store.linkMessage(row.id, messageLinks(m))
        if (role === 'bot' && Array.isArray(m.message) && m.message.some(s => ['image', 'record'].includes(s.type))) store.annotateDeliveredMedia(row.id, describeDeliveredMessage(m.message, { stickers }))
      }
    }
    const oldest = Number(sorted[0].time) * 1000, cursor = String(sorted[0].message_id || sorted[0].message_seq || '')
    if (oldest > gap.start && (!cursor || cursor === coverage.cursor || (coverage.oldest && oldest >= coverage.oldest))) throw new Error('history_cursor_did_not_move_backwards')
    store.db.prepare('UPDATE coverage SET status=?,cursor=?,oldest=?,pages=pages+1,error=NULL,retryAt=? WHERE id=?').run(oldest <= gap.start ? 'covered' : 'pending', cursor, oldest, 0, coverage.id)
    if (oldest <= gap.start && gap.reason === 'delivery_reconciliation') store.set('lastSync:' + coverage.scope, gap.end)
  } catch (e) {
    store.db.prepare("UPDATE coverage SET status='partial',error=?,retryAt=? WHERE id=?").run(String(e.message).slice(0, 300), store.clock() + 3600000, coverage.id)
  }
}

export function pendingCatchup(store, scope, now = store.clock()) {
  // Only real direct requests from an actual absence; regular group silence is not a missed request.
  return store.db.prepare(`SELECT m.* FROM messages m WHERE m.scope=? AND m.origin IN ('history','reconciled_history') AND m.role='user' AND m.direct=1 AND m.at>? AND m.forgotten=0
    AND NOT EXISTS(SELECT 1 FROM messages b WHERE b.scope=m.scope AND b.role='bot' AND b.at>=m.at)
    AND NOT EXISTS(SELECT 1 FROM outbound o WHERE o.source=m.id) ORDER BY m.at DESC LIMIT 6`).all(scope, now - 7 * 86400000)
}
