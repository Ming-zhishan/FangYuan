import { createHash } from 'node:crypto'

export function deliveryFingerprint(scope, message) {
  const content = Array.isArray(message) ? message.filter(s => !['at', 'reply'].includes(s.type) && !(s.type === 'text' && !String(s.data?.text || '').trim())) : message
  return createHash('sha256').update(String(scope) + '|' + JSON.stringify(content)).digest('hex')
}

// Keep recipients and quoted IDs separate from prose: a quote is not a new utterance.
export function messageLinks(raw = {}) {
  const segments = Array.isArray(raw.message) ? raw.message : []
  const cq = typeof raw.message === 'string' ? raw.message : ''
  const addressedUids = [...new Set([...segments.filter(s => s.type === 'at').map(s => String(s.data?.qq)), ...[...cq.matchAll(/\[CQ:at,qq=(\d+|all)[^\]]*\]/g)].map(m => m[1])])].filter(s => /^(\d{5,12}|all)$/.test(s))
  const replyMid = String(segments.find(s => s.type === 'reply')?.data?.id || /\[CQ:reply,id=([^,\]]+)/.exec(cq)?.[1] || '')
  return { senderName: String(raw.sender?.card || raw.sender?.nickname || '').slice(0, 100), addressedUids, replyMid }
}

export function describeDeliveredMessage(message, { stickers = [], note = '' } = {}) {
  if (!Array.isArray(message)) return String(message || '').replace(/\[CQ:(image|record)[^\]]*\]/g, (_, kind) => kind === 'image' ? '[图片:内容未识别]' : '[语音:正文未转写]')
  return message.map(s => {
    if (s.type === 'text') return s.data?.text || ''
    if (s.type === 'at') return `<at:${s.data?.qq}>`
    if (s.type === 'reply') return `<reply:${s.data?.id}>`
    if (s.type === 'image') {
      const file = String(s.data?.file || '')
      let md5 = /^([a-f0-9]{32})(?:\.|$)/i.exec(file)?.[1]?.toLowerCase()
      if (file.startsWith('base64://')) md5 = createHash('md5').update(Buffer.from(file.slice(9), 'base64')).digest('hex')
      const asset = md5 && stickers.find(i => i.md5?.toLowerCase() === md5)
      return asset ? `[图片:表情库「${asset.name || asset.md5.slice(0, 8)}」;标签=${(asset.tags || []).join('/') || '未标注'};图意以实际画面为准]` : '[图片:内容未识别]'
    }
    if (s.type === 'record') {
      const excerpt = String(note).replace(/^\[语音[^\]]*\]\s*/, '')
      return `[语音:${excerpt && excerpt !== note ? '发送时正文摘要=' + excerpt : '正文未转写'}]`
    }
    if (s.type === 'face') return `[QQ表情:${s.data?.id}]`
    return `[${s.type || '非文本'}]`
  }).join('')
}
