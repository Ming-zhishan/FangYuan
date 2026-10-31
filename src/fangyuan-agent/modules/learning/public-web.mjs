import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function publicAddress(ip) {
  if (ip.includes(':')) return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip) && !ip.toLowerCase().includes('::ffff:')
  const [a, b] = ip.split('.').map(Number)
  return isIP(ip) === 4 && ![0, 10, 127, 169, 192, 224, 255].includes(a) && !(a === 172 && b >= 16 && b <= 31) && !(a === 100 && b >= 64 && b <= 127) && a < 224
}

/** Public search results are untrusted. No credentials, local addresses or captcha bypass. */
export async function publicExcerpt(url, { fetcher = fetch, resolver = lookup } = {}) {
  let target = new URL(url)
  for (let redirects = 0; redirects < 3; redirects++) {
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.port && !['80', '443'].includes(target.port) || target.hostname === 'localhost') throw new Error('not_public_web_url')
    const ips = await resolver(target.hostname, { all: true })
    if (!ips.length || ips.some((r) => !publicAddress(r.address))) throw new Error('not_public_web_address')
    const response = await fetcher(target, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'FangYuan-learning/0.4' } })
    if (response.status >= 300 && response.status < 400) { const next = response.headers.get('location'); if (!next) throw new Error('bad_public_redirect'); target = new URL(next, target); continue }
    if (!response.ok || !/text\/(html|plain)/i.test(response.headers.get('content-type') || '')) throw new Error('public_page_unreadable')
    const reader = response.body.getReader(); const chunks = []; let length = 0
    try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > 400000) throw new Error('public_page_too_large'); chunks.push(value) } } finally { await reader.cancel().catch(() => {}) }
    const bytes = Buffer.concat(chunks), charset = response.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1] || 'utf-8'
    const html = new TextDecoder(charset).decode(bytes)
    if (/captcha|verify you are human|checking your browser|访问验证|安全验证|人机验证/i.test(html.slice(0, 20000))) throw new Error('public_page_requires_interaction')
    return { url: target.href, excerpt: html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 1400) }
  }
  throw new Error('public_redirect_limit')
}
