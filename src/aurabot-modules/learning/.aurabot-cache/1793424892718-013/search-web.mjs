export const cleanText = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n)))).replace(/\s+/g, ' ').trim()

export function parse360(html) {
  if (/<title[^>]*>[^<]*(?:安全验证|访问验证|访问异常|验证码|captcha)/i.test(html)) throw new Error('search_requires_interaction')
  const out = []
  const pattern = /<h3\b[^>]*class=["'][^"']*res-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b[^>]*class=["'][^"']*res-title|$)/gi
  for (const m of html.matchAll(pattern)) {
    const tag = m[1].match(/<a\b[^>]*>/i)?.[0] || ''
    const url = cleanText(tag.match(/data-mdurl=["']([^"']+)["']/i)?.[1] || tag.match(/data-cache=["']([^"']+)["']/i)?.[1] || tag.match(/href=["']([^"']+)["']/i)?.[1])
    if (!/^https?:\/\//.test(url) || /\/link\?/.test(url) || /^https?:\/\/(?:ai\.so\.com|chat\.)/.test(url) || out.some((s) => s.url === url)) continue
    out.push({ title: cleanText(m[1]).slice(0, 150), url, snippet: cleanText(m[2]).slice(0, 500), searchProvider: '360-public-search' })
    if (out.length === 3) break
  }
  return out
}

export async function searchPublicTerm(term, fetcher = fetch) {
  const shortError = (e) => String(e.cause?.code || e.message || 'unknown').replace(/[^a-zA-Z0-9_:]/g, '_').slice(0, 100)
  let primaryError = 'no_verified_results'
  try {
    const r = await fetcher('https://www.so.com/s?q=' + encodeURIComponent(term + ' 含义 用法'), { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!r.ok) throw new Error('search_http_' + r.status)
    if (r.url && /(^|\.)qcaptcha\.so\.com$/.test(new URL(r.url).hostname)) throw new Error('search_requires_interaction')
    const html = await r.text()
    if (html.length > 1200000) throw new Error('public_search_response_too_large')
    const items = parse360(html)
    if (items.length) return items
  } catch (e) { primaryError = shortError(e) /* Another independent provider may be available. Never bypass its verification. */ }
  try {
  const r = await fetcher('https://www.bing.com/search?format=rss&q=' + encodeURIComponent(term + ' 含义 用法'), { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) throw new Error('public_search_unavailable')
  const xml = await r.text()
  if (xml.length > 500000 || !xml.includes('<rss')) throw new Error('public_search_no_verified_results')
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 3).map((m) => ({ title: cleanText(m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1]), url: cleanText(m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1]), snippet: cleanText(m[1].match(/<description>([\s\S]*?)<\/description>/)?.[1]).slice(0, 500), searchProvider: 'bing-public-rss' })).filter((s) => /^https?:\/\//.test(s.url))
  } catch (e) { throw new Error('public_search_unavailable:360=' + primaryError + ';bing=' + shortError(e)) }
}
