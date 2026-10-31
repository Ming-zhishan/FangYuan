import { randomUUID } from 'node:crypto'
import { dayOf } from './store.mjs'
import { DatabaseSync } from 'node:sqlite'

/** All paid background requests use the existing production guard. Never use an unguarded fallback. */
export class BackgroundModel {
  constructor(store, settings, { fetcher = fetch, token = () => process.env.FY_PRODUCTION_TOKEN } = {}) { this.store = store; this.settings = settings; this.fetcher = fetcher; this.token = token }
  async ask(system, text, { maxTokens = 1200, jobId = '', foreground = false, timeoutMs = 255000 } = {}) {
    const cfg = this.settings(), db = this.store.db, now = this.store.clock(), day = new Date(now).toISOString().slice(0, 10)
    if ((!cfg.modelEnabled && !foreground) || !this.token()) throw new Error('background_model_not_configured')
    // Keep an auditable estimate. Explicit unrestricted use removes cumulative local caps,
    // while finite per-request context and short-term rate control protect the live service.
    const bytes = Buffer.byteLength(system + text), reserve = bytes * 30 / 1e6 + (maxTokens + 4096) * 120 / 1e6
    if (bytes > 250000) throw new Error('background_input_too_large')
    if (cfg.usageDbPath) {
      const ledger = new DatabaseSync(cfg.usageDbPath, { readOnly: true })
      try {
        const start = Math.floor(now / 86400000) * 86400
        const usage = ledger.prepare('SELECT SUM(COALESCE(actual,held)) tokens,SUM(COALESCE(actual_micropoints,held_micropoints))/1000000.0 points FROM calls WHERE created>=?').get(start)
        const total = ledger.prepare('SELECT SUM(COALESCE(actual,held)) tokens,SUM(COALESCE(actual_micropoints,held_micropoints))/1000000.0 points FROM calls').get()
        if (!foreground && ledger.prepare('SELECT count(*) n FROM calls WHERE created>?').get(now / 1000 - 60).n >= 4) throw new Error('background_foreground_rate_reserve_wait')
        if (cfg.unrestrictedUsage !== true && (Number(usage.points || 0) + reserve > 50 || Number(usage.tokens || 0) + bytes + maxTokens + 4096 > Number(cfg.dailyTokenBudget || 1400000))) throw new Error('background_daily_foreground_reserve_wait')
        if (cfg.unrestrictedUsage !== true && (Number(total.points || 0) + reserve > 570 || Number(total.tokens || 0) + bytes + maxTokens + 4096 > Number(cfg.totalTokenBudget || 19900000))) throw new Error('background_total_foreground_reserve_wait')
      } finally { ledger.close() }
    }
    db.exec('BEGIN IMMEDIATE')
    const id = randomUUID()
    try {
      const used = db.prepare('SELECT COALESCE(SUM(COALESCE(actual,reserved)),0) n FROM budget WHERE day=?').get(day).n
      if (cfg.unrestrictedUsage !== true && used + reserve > Math.min(50, Number(cfg.dailyPoints || 50))) throw new Error('background_daily_budget_wait')
      db.prepare('INSERT INTO budget VALUES(?,?,?,?,?,?)').run(id, day, reserve, null, 'reserved', now); db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    try {
      const health = await this.fetcher('http://127.0.0.1:11435/health', { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
      if (health.provider !== 'tongji' || health.model !== 'DeepSeek-V4.1-Flash' || health.cash_allowed !== false) throw new Error('production_model_route_not_verified')
      if (cfg.unrestrictedUsage === true && health.local_usage_limits !== 'unrestricted') throw new Error('production_usage_mode_not_verified')
      const r = await this.fetcher('http://127.0.0.1:11435/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token() }, signal: AbortSignal.timeout(Math.max(1000, Math.min(255000, timeoutMs))),
        body: JSON.stringify({ model: 'DeepSeek-V4.1-Flash', fy_background: !foreground, fy_primary_only: foreground, stream: false, temperature: 0.45, max_tokens: Math.min(32768, maxTokens), messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }) })
      if (!r.ok) { const error = await r.json().catch(() => ({})); throw new Error(/^(?:background_primary_unavailable|primary_unavailable):[a-zA-Z_]+$/.test(error.detail || '') ? error.detail : 'production_guard_http_' + r.status) }
      const out = await r.json()
      if (out.model !== 'DeepSeek-V4.1-Flash' || !out.choices?.[0]?.message?.content) throw new Error('wrong_or_empty_background_model')
      db.prepare('INSERT INTO model_outputs VALUES(?,?,?,?)').run(id, out.choices[0].message.content, JSON.stringify(out.usage || {}), this.store.clock())
      if (jobId) this.store.set('modelOutput:' + jobId, id)
      const usage = out.usage
      const actual = Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens) ? (usage.prompt_tokens * 30 + usage.completion_tokens * 120) / 1e6 : null
      db.prepare('UPDATE budget SET actual=?,status=? WHERE id=?').run(actual, 'finished', id)
      return out.choices[0].message.content
    } catch (e) {
      // Unknown HTTP outcomes retain conservative reservation rather than silently refunding it.
      db.prepare("UPDATE budget SET status='failed_or_unknown' WHERE id=?").run(id)
      throw e
    }
  }
}
