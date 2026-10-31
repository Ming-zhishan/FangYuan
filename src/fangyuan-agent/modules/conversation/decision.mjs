const tags = s => String(s).match(/<(?:at|reply|sticker):[^>]+>|<\/?voice>/g) || []
export function mustRespond(chatId, rows, userText) {
  if (chatId.startsWith('private:')) return true
  const lastBot = rows.findLastIndex(r => r.role === 'bot')
  const users = rows.slice(lastBot + 1).filter(r => r.role === 'user')
  const current = users.filter(r => r.text?.trim() && String(userText).includes(r.text))
  return (current.length ? current : users.slice(-1)).some(r => r.direct === true || r.direct === 1)
}
export function applyReviewDecision(draft, decision, { direct = true, catalog = [], voiceEnabled = false, currentSenderUids = [] } = {}) {
  if (decision.change !== true || typeof decision.text !== 'string' || !decision.text.trim()) return { text: draft, status: 'kept' }
  let revised = decision.text.trim()
  if (revised === '[沉默]') return direct ? { text: draft, status: 'kept_direct_silence_rejected' } : { text: revised, status: 'withheld_unaddressed_group_reply' }
  const original = tags(draft), added = tags(revised).filter(tag => !original.includes(tag))
  if (added.some(tag => /^<reply:/.test(tag) || /^<at:/.test(tag) && !currentSenderUids.includes(tag.slice(4, -1)))) return { text: draft, status: 'kept_unprovided_target' }
  if (added.some(tag => /^<(\/?voice)>/.test(tag) && !voiceEnabled || /^<sticker:/.test(tag) && !catalog.some(i => tag === `<sticker:${i.name}>` || tag === `<sticker:id:${i.md5}>`))) return { text: draft, status: 'kept_unavailable_media' }
  if ((revised.match(/<voice>/g) || []).length !== (revised.match(/<\/voice>/g) || []).length) return { text: draft, status: 'kept_invalid_voice' }
  // A draft's unsent media/@ can change; only native quote numbering must remain grounded.
  const missing = original.filter(tag => /^<reply:/.test(tag) && !revised.includes(tag))
  revised = missing.join('') + revised
  return { text: revised, status: 'revised' }
}
