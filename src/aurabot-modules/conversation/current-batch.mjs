/** The host's current query is the new turn; recalled rows are context, never a new queue of commands. */
export function currentBatch(recent, query) {
  const text = String(query || '')
  const matches = recent.filter(r => r.role === 'user' && r.text?.trim() && text.includes(r.text.trim()))
  const latest = new Map()
  for (const row of matches) latest.set(row.uid + '|' + row.text, row)
  const rows = [...latest.values()]
  return { text, sourceIds: rows.map(r => r.id), senderUids: [...new Set(rows.map(r => String(r.uid)))], note: '本轮新消息以text为准；recent用于理解，不代表旧问题全部需要重答。引用内容不等于当前说话者的新观点。' }
}
