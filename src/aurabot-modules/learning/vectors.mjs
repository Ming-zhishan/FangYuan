import { hash } from './store.mjs'

export class MemoryVectors {
  constructor(store, { fetcher = fetch } = {}) {
    this.store = store; this.fetcher = fetcher
    store.db.exec(`CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES messages(id),part INTEGER NOT NULL,text TEXT NOT NULL,vector BLOB,error TEXT,retryAt INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS embeddings_source ON embeddings(source);`)
  }
  seed() {
    const db = this.store.db
    const rows = db.prepare("SELECT id,text,COALESCE((SELECT sum(length(e.text)) FROM embeddings e WHERE e.source=m.id),0) AS indexed_chars FROM messages m WHERE role='user' AND forgotten=0 AND length(text)>COALESCE((SELECT sum(length(e.text)) FROM embeddings e WHERE e.source=m.id),0) LIMIT 200").all()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const r of rows) for (let part = r.indexed_chars; part < r.text.length; part += 1800) db.prepare('INSERT OR IGNORE INTO embeddings(id,source,part,text) VALUES(?,?,?,?)').run(hash(r.id + '|offset:' + part), r.id, part, r.text.slice(part, part + 1800))
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  async embed(input, timeout = 12000) {
    const r = await this.fetcher('http://127.0.0.1:11434/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout), body: JSON.stringify({ model: 'qwen3-embedding:0.6b', input, truncate: false, keep_alive: '30m', options: { num_gpu: 0 } }) })
    if (!r.ok) throw new Error('local_embedding_http_' + r.status)
    const body = await r.json()
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== input.length || body.embeddings.some((v) => v.length !== 1024 || v.some((x) => !Number.isFinite(x)))) throw new Error('invalid_local_embedding')
    return body.embeddings.map((v) => { const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)); return Float32Array.from(v, (x) => x / Math.max(norm, 1e-12)) })
  }
  async tick() {
    this.seed()
    const rows = this.store.db.prepare('SELECT e.* FROM embeddings e JOIN messages m ON m.id=e.source WHERE e.vector IS NULL AND e.retryAt<=? AND m.forgotten=0 ORDER BY m.at DESC,e.part LIMIT 12').all(this.store.clock())
    if (!rows.length) return false
    try {
      const vectors = await this.embed(rows.map((r) => r.text || '（空消息）'), 45000)
      for (let i = 0; i < rows.length; i++) this.store.db.prepare('UPDATE embeddings SET vector=?,error=NULL WHERE id=?').run(Buffer.from(vectors[i].buffer), rows[i].id)
    } catch (e) { for (const r of rows) this.store.db.prepare('UPDATE embeddings SET error=?,retryAt=? WHERE id=?').run(e.message, this.store.clock() + 300000, r.id); throw e }
    return true
  }
  search(vector, scope, people, { excludeIds = [], limit = 4 } = {}) {
    const ids = scope.startsWith('private:') ? [scope.slice(8)] : [...new Set(people.map(String))]
    const dm = scope.startsWith('private:')
    if (dm && !ids.length) return []
    const rows = this.store.db.prepare(`SELECT e.source,e.text,e.vector,m.scope,m.uid,m.at FROM embeddings e JOIN messages m ON m.id=e.source WHERE e.vector IS NOT NULL AND m.forgotten=0 AND (m.scope=? ${dm ? "OR (m.scope LIKE 'group:%' AND m.uid=?)" : ''}) ${dm ? 'AND m.uid=?' : ''}`).all(scope, ...(dm ? [ids[0], ids[0]] : []))
    const scored = []
    for (const r of rows) {
      if (excludeIds.includes(r.source) || r.vector.length !== 4096) continue
      const bytes = Buffer.from(r.vector); let score = 0
      for (let i = 0; i < 1024; i++) score += vector[i] * bytes.readFloatLE(i * 4)
      if (score >= .42) scored.push({ source: r.source, scope: r.scope, uid: r.uid, at: r.at, quote: r.text.slice(0, 380), score: Math.round(score * 1000) / 1000, status: 'original_user_message_not_objective_fact' })
    }
    const seen = new Set()
    return scored.sort((a, b) => b.score - a.score || b.at - a.at).filter((r) => !seen.has(r.source) && seen.add(r.source)).slice(0, limit)
  }
}
