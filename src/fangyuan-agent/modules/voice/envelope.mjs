/** QQ voice messages travel alone. Reply/@ envelopes can create a visible, unplayable PTT bubble. */
export function normalizeVoiceEnvelope(message) {
  if (!Array.isArray(message)) return message
  const records = message.filter(s => s.type === 'record')
  if (records.length !== 1) return message
  const controlsOnly = message.every(s => ['record', 'reply', 'at'].includes(s.type) || s.type === 'text' && !String(s.data?.text || '').trim())
  return controlsOnly ? records : message
}
