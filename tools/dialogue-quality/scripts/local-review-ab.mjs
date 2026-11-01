#!/usr/bin/env node
/** Small explicit model review comparison. Local Ollama or verified non-cash primary gateway; no QQ or production DB access. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const baseline = arg('--baseline-root')
const model = arg('--model')
const credentialFile = arg('--guarded-credential-file')
if (!baseline || !model) throw new Error('Specify --baseline-root and an already installed --model; add --execute to call local Ollama')
const cases = readFileSync(arg('--fixtures') ? resolve(arg('--fixtures')) : join(repo, 'tools/dialogue-quality/examples/interaction-review.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
if (cases.length > 3) throw new Error('This small-check entry permits at most three cases; larger runs need a separate reviewed plan')
const options = { temperature: 0.2, seed: 20261101, num_ctx: 16384, num_predict: 500 }
const sha = s => createHash('sha256').update(s).digest('hex')
if (!args.includes('--execute')) {
  console.log(JSON.stringify({ mode: 'plan', model, cases: cases.length, maximumCalls: cases.length * 2, options: credentialFile ? 'gateway controlled; primary only, no cash' : options, endpoint: credentialFile ? 'local guarded gateway' : 'local Ollama' }))
} else {
  const endpoint = credentialFile ? 'http://127.0.0.1:11435' : 'http://127.0.0.1:11434'
  let token, installed
  if (credentialFile) {
    const health = await fetch(endpoint + '/health', { signal: AbortSignal.timeout(5000) }).then(r => r.json())
    if (health.provider !== 'tongji' || health.cash_allowed !== false || health.model !== model) throw new Error('Non-cash primary route not verified')
    token = JSON.parse(readFileSync(resolve(credentialFile), 'utf8').replace(/^\uFEFF/, '')).gateway_token
    if (!token) throw new Error('Missing local gateway credential')
    installed = { digest: 'gateway-route-verified-not-upstream-digest' }
  } else {
    const tags = await fetch(endpoint + '/api/tags', { signal: AbortSignal.timeout(5000) }).then(r => r.json())
    installed = tags.models.find(m => m.name === model)
    if (!installed) throw new Error('Model not installed; this script never downloads models')
  }
  const output = join(repo, 'tools/dialogue-quality/private', credentialFile ? 'guarded-review-ab' : 'local-review-ab')
  mkdirSync(output, { recursive: true })
  let lastRequestAt = 0
  for (const [variant, root] of [['before', resolve(baseline)], ['after', repo]]) {
    const dir = join(root, 'src/fangyuan-agent/modules')
    const { conversationReviewPrompt } = await import(pathToFileURL(join(dir, 'conversation/index.mjs')))
    const { applyReviewDecision } = await import(pathToFileURL(join(dir, 'conversation/decision.mjs')))
    const core = readFileSync(join(dir, 'fangyuan/core.txt'), 'utf8').trim()
    const social = readFileSync(join(dir, 'conversation/social-policy.txt'), 'utf8')
    const interaction = variant === 'after' ? (await import(pathToFileURL(join(dir, 'conversation/interaction-frame.mjs')))).interactionFrame({ ownerQQ: '100001', ext: { conversation: { ownerBond: 'close_companion' } } }, 'private:100001') : null
    for (const c of cases) {
      // hostTail is an explicit counterfactual fixture, never inferred from archive recency.
      const userText = variant === 'before' && typeof c.hostTail === 'string' ? c.hostTail : c.userText
      const prompt = conversationReviewPrompt({ ...c, userText, personaCore: core, scene: 'private', direct: true, interaction, recent: c.userText.split('\n').map((text, i) => ({ id: 'synthetic-' + i, uid: '100001', role: 'user', text })) })
      const conditions = { mode: credentialFile ? 'guarded_model_review_only' : 'local_model_review_only', model, digest: installed.digest, options: credentialFile ? { gateway_controls_parameters: true, max_tokens: 8192, primary_only: true, cash_allowed: false } : options, persona_sha256: sha(core), social_sha256: sha(social), input_sha256: sha(JSON.stringify(c)), prompt_sha256: sha(prompt), interaction, qq_sent: 0 }
      const key = sha(JSON.stringify(conditions)), target = join(output, key + '.json')
      if (existsSync(target)) { console.log(JSON.stringify({ variant, id: c.id, cached: true })); continue }
      // Save the attempt before HTTP. Unknown or failed attempts are not automatically resent.
      const record = { variant, case_id: c.id, conditions, execution_status: 'attempted', prompt, at: new Date().toISOString() }
      writeFileSync(target, JSON.stringify(record, null, 2))
      try {
        if (credentialFile && lastRequestAt) await new Promise(r => setTimeout(r, Math.max(0, 21000 - (Date.now() - lastRequestAt))))
        lastRequestAt = Date.now()
        const messages = [{ role: 'system', content: prompt }, { role: 'user', content: '复核以上合成草稿，只输出约定JSON。' }]
        const r = await fetch(endpoint + (credentialFile ? '/v1/chat/completions' : '/api/chat'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, signal: AbortSignal.timeout(180000), body: JSON.stringify(credentialFile ? { model, messages, stream: false, max_tokens: 8192, fy_background: false, fy_primary_only: true } : { model, messages, stream: false, think: false, options }) })
        if (!r.ok) throw new Error('model_http_' + r.status)
        const d = await r.json()
        if (credentialFile && d.model !== model) throw new Error('unexpected_model')
        Object.assign(record, { execution_status: 'ok', raw: credentialFile ? d.choices?.[0]?.message?.content || '' : d.message?.content || '', usage: credentialFile ? d.usage : { prompt_tokens: d.prompt_eval_count, completion_tokens: d.eval_count }, done_reason: credentialFile ? d.choices?.[0]?.finish_reason : d.done_reason })
        try { record.decision = JSON.parse(record.raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { record.parse_error = true }
        record.applied = record.decision ? applyReviewDecision(c.draft, record.decision, { direct: true, currentSenderUids: ['100001'] }) : { text: c.draft, status: 'kept_invalid_review' }
      } catch (e) { Object.assign(record, { execution_status: 'failed_or_unknown', error: e.name === 'TimeoutError' ? 'timeout_no_resend' : String(e.message).slice(0, 100) }) }
      writeFileSync(target, JSON.stringify(record, null, 2))
      console.log(JSON.stringify({ variant, id: c.id, execution_status: record.execution_status, usage: record.usage, parse_error: record.parse_error || false }))
      if (record.execution_status !== 'ok') { process.exitCode = 1; process.exit(1) }
    }
  }
}
