/** Identify only messages reliably present in this turn, not arbitrary substrings of recalled history.
 * A quoted or repeated historical phrase must never authorize a new @recipient.
 */
const normalized = value => String(value ?? '').replace(/\r\n/g, '\n').trim()
const validUid = value => /^\d{5,12}$/.test(String(value ?? ''))

function completeLines(query) {
  let fenced = false
  return normalized(query).split('\n').map(line => {
    const s = line.trim()
    if (/^```/.test(s)) { fenced = !fenced; return '' }
    if (fenced || /^(?:>|&gt;|\[引用|\[quote|引用[:：]|原消息[:：])/i.test(s)) return ''
    return s
  }).filter(Boolean)
}

export function currentBatch(recent, query) {
  const text = String(query ?? ''), whole = normalized(text)
  const rows = Array.isArray(recent) ? recent.filter(r => r?.role === 'user' && normalized(r.text)) : []
  let candidates = rows.filter(r => normalized(r.text) === whole)
  let matchQuality = candidates.length ? 'whole_turn_exact' : 'unresolved'

  // Multiple independently delimited messages are useful; a lone quoted line is not evidence.
  if (!candidates.length && whole.includes('\n')) {
    const lines = completeLines(whole), unique = new Set(lines)
    const matching = rows.filter(r => unique.has(normalized(r.text)))
    if (new Set(matching.map(r => normalized(r.text))).size >= 2) {
      candidates = matching
      matchQuality = 'multi_message_lines'
    }
  }

  const grouped = new Map()
  for (const row of candidates) {
    const key = normalized(row.text)
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key).push(row)
  }
  const confirmed = [], ambiguousTexts = []
  for (const [message, matched] of grouped) {
    const uids = new Set(matched.map(r => String(r.uid ?? '')))
    // Identical historical messages from different people cannot prove who spoke now.
    if (uids.size !== 1 || !validUid(matched.at(-1).uid)) {
      ambiguousTexts.push(message)
      continue
    }
    confirmed.push(matched.at(-1))
  }
  return {
    text,
    sourceIds: confirmed.map(r => r.id).filter(id => id !== undefined && id !== null),
    senderUids: [...new Set(confirmed.map(r => String(r.uid)))],
    matchQuality: ambiguousTexts.length ? 'ambiguous_sender' : matchQuality,
    note: '本轮新消息以text为准。只有完整匹配且发言人可明确归属时才允许新增@；引用、历史和猜测不得成为发言证据。'
  }
}
