import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const STOP = new Set(['什么', '原文', '章节', '当时', '怎么', '为什么', '告诉', '一下', '现在', '自己', '是不是', '到底', '可以', '请问', '你的', '如何', '知道', '哪些'])
const terms = (q) => {
  const clean = q.replace(/原文|章节|出处|详细经过/g, ' ')
  // Generic word dictionaries split rare Gu names into single characters.
  const names = [...clean.matchAll(/(?:^|\s)([\u4e00-\u9fff]{2,8})(?=$|\s)/g)].map((m) => m[1]).filter((s) => !STOP.has(s) && !/什么|怎么|为什么|如何|是不是|的/.test(s))
  const words = [...segmenter.segment(clean)].filter((x) => x.isWordLike && x.segment.length >= 2 && !STOP.has(x.segment)).map((x) => x.segment)
  return [...new Set([...names, ...words])].slice(0, 5)
}
const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&')
export class LoreSearch {
  constructor({ catalogPath, originalDbPath }) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    if (catalog.version !== 1 || !Array.isArray(catalog.cards)) throw new Error('Invalid reviewed catalog')
    const anchors = JSON.parse(readFileSync(new URL('./anchors.json', import.meta.url), 'utf8')).cards
    this.cards = [...anchors, ...catalog.cards.filter((c) => !anchors.some((a) => a.id === c.id))]; this.path = originalDbPath
  }
  search(query, { limit = 2 } = {}) {
    const q = String(query || '').trim().slice(0, 160), max = Math.max(1, Math.min(3, limit))
    if (!q) return []
    const reviewed = this.cards.filter((c) => c.keys.some((key) => q.includes(key))).slice(0, max)
      .map((c) => ({ id: c.id, kind: 'reviewed_anchor', text: c.facts, perspective: c.perspective, sources: c.sources }))
    if (reviewed.length && !/原文|章节|出处|详细经过/.test(q)) return reviewed
    const keys = terms(q)
    if (!this.path || !keys.length) return reviewed
    const db = new DatabaseSync(this.path, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON')
      const columns = 'id,volume,number_text,title,passage,source_label,heading_line'
      const where = keys.map(() => "passage LIKE ? ESCAPE '\\'").join(' AND ')
      let rows = db.prepare(`SELECT ${columns} FROM chunks WHERE ${where} ORDER BY sequence LIMIT ?`).all(...keys.map((x) => '%' + escapeLike(x) + '%'), max)
      if (!rows.length && keys.length > 1) {
        for (const key of keys.slice().sort((a, b) => b.length - a.length)) {
          rows = db.prepare(`SELECT ${columns} FROM chunks WHERE passage LIKE ? ESCAPE '\\' ORDER BY sequence LIMIT ?`).all('%' + escapeLike(key) + '%', max)
          if (rows.length) break
        }
      }
      return [...reviewed.slice(0, Math.max(0, max - (rows.length ? 1 : 0))), ...rows.map((r) => {
        const at = keys.map((k) => r.passage.indexOf(k)).filter((i) => i >= 0).sort((a, b) => a - b)[0] || 0
        const start = Math.max(0, at - 220)
        return { id: 'original:' + r.id, kind: 'original_excerpt_not_automatically_personal_experience', volume: r.volume, chapter: r.number_text, title: r.title,
          source: r.source_label, headingLine: r.heading_line, text: r.passage.slice(start, start + 700) }
      })].slice(0, max)
    } finally { db.close() }
  }
}
