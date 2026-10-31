import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LearningStore, dayOf, dueDay, dayStart, nextDay } from '../modules/learning/store.mjs'
import { BackgroundModel } from '../modules/learning/model.mjs'
import { LearningWorker } from '../modules/learning/worker.mjs'
import { heartbeat, recoverPage, pendingCatchup, scheduleReconciliation } from '../modules/learning/history.mjs'
import { MemoryVectors } from '../modules/learning/vectors.mjs'
import { publicExcerpt, publicAddress } from '../modules/learning/public-web.mjs'
import { parse360, searchPublicTerm } from '../modules/learning/search-web.mjs'
import { DatabaseSync } from 'node:sqlite'

const A = '100001', B = '100002', G = 'group:200001', P = `private:${A}`
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fy-learning-')); let now = Date.parse('2026-10-30T04:01:00+08:00')
  const file = join(dir, 'learning.db'), store = new LearningStore(file, { clock: () => now })
  const beforeClose = []
  t.after(() => { for (const fn of beforeClose) fn(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  const observe = (scope = P, uid = A, text = '别端着，正常说就行', mid = '1', extra = {}) => store.observe({ scope, uid, mid, text, at: now - 86400000, ...extra })
  return { store, file, observe, beforeClose: (fn) => beforeClose.push(fn), now: () => now, advance: (ms) => { now += ms } }
}
const item = (e, kind = 'style', text = '日常可以用自然口语，不必故作高深') => ({ source: e.id, scope: e.scope, uid: e.uid, quote: e.text, kind, text })

test('learning keeps unique original messages across replays and validates scope and source quotes', (t) => {
  const f = fixture(t), e = f.observe(); f.observe()
  assert.equal(f.store.stats().messages, 1)
  assert.throws(() => f.store.learn({ ...item(e), uid: B }))
  assert.throws(() => f.store.learn({ ...item(e), scope: G }))
  assert.throws(() => f.store.learn({ ...item(e), quote: '根本没说过' }))
  f.store.learn(item(e)); f.store.learn(item(e)); assert.equal(f.store.stats().items, 1)
})

test('private learning never leaves the person or enters a group, public group learning can follow its own speaker into private', (t) => {
  const f = fixture(t), e = f.observe(P, A, '私密金丝雀'), g = f.observe(G, A, '群里别老解释梗', '2')
  f.store.learn(item(e, 'preference', '私密金丝雀')); f.store.learn(item(g, 'style', '群聊不要每次解释笑点'))
  assert.doesNotMatch(f.store.context(G, [A]), /私密金丝雀/)
  assert.doesNotMatch(f.store.context(`private:${B}`, [A]), /私密金丝雀|解释笑点/)
  assert.match(f.store.context(P, [A]), /解释笑点/)
})

test('numeric affinity is persistent and idempotent, does not grant permission and forget removes its basis', (t) => {
  const f = fixture(t), e = f.observe()
  const args = { ...item(e), delta: 2, reason: '对方明确指出表达问题，我愿意调整' }
  assert.equal(f.store.changeAffinity(args).value, 2)
  assert.equal(f.store.changeAffinity(args).changed, false)
  assert.match(f.store.context(P), /无服从阈值/)
  f.store.forgetSource(e.id)
  assert.equal(f.store.db.prepare('SELECT value FROM affinity WHERE uid=?').get(A).value, 0)
})

test('one person accumulates impressions and affinity from both scenes without exporting private evidence', (t) => {
  const f = fixture(t), p = f.observe(P, A, '私密金丝雀，跟我可以随便开玩笑'), g = f.observe(G, A, '这回接得不错', 'g2')
  f.store.observeImpression({ ...item(p), axis: 'banter', value: 0.8, confidence: 0.8, reason: '私密金丝雀依据' })
  f.store.observeImpression({ ...item(g), axis: 'familiarity', value: 0.4, confidence: 0.5, reason: '这次交流' })
  f.store.changeAffinity({ ...item(p), delta: 2, reason: '关系改善' }); f.store.changeAffinity({ ...item(g), delta: 1, reason: '真实反馈' })
  const relationship = f.store.publicRelationship(A)
  assert.equal(relationship.affinity, 3); assert.equal(relationship.impressions.banter.value, 0.8)
  const group = f.store.context(G, [A]), privateContext = f.store.context(P)
  assert.match(group, /banter/); assert.match(privateContext, /familiarity/)
  assert.doesNotMatch(group, /金丝雀|跟我可以随便|私密金丝雀依据/)
  assert.doesNotMatch(f.store.context(`private:${B}`), /banter|familiarity/)
  assert.equal(f.store.observeImpression({ ...item(p), axis: 'banter', value: 1, confidence: 1, reason: '重复' }).changed, false)
  f.store.forgetSource(p.id)
  assert.equal(f.store.publicRelationship(A).impressions.banter, undefined)
  assert.equal(f.store.publicRelationship(A).affinity, 1)
})

test('communication style is recalled without a matching topic and remains revisable context', (t) => {
  const f = fixture(t), e = f.observe()
  f.store.learn(item(e, 'style', '熟人闲聊可自然接话，不必故作高深'))
  for (let n = 0; n < 15; n++) { const m = f.observe(P, A, '测试这个话题'+n, String(n+5)); f.store.learn(item(m, 'knowledge', '测试这个话题的具体信息'+n)) }
  assert.match(f.store.context(P, [], '测试这个话题'), /自然接话/)
})

test('daily review persists sourced shared impressions while invalid axes never become instructions', async (t) => {
  const f = fixture(t), e = f.observe()
  f.store.scheduleDaily(() => true)
  const model = { ask: async () => JSON.stringify({ items: [], terms: [], impressions: [{ ...item(e), axis: 'directness', value: 0.6, confidence: 0.6, reason: '直接反馈' }] }) }
  const worker = new LearningWorker(f.store, model, { settings: () => ({}), permitted: () => true })
  await worker.execute(f.store.nextJob(['daily']))
  assert.equal(f.store.publicRelationship(A).impressions.directness.value, 0.6)
  assert.throws(() => f.store.observeImpression({ ...item(e), axis: 'administrator', value: 1, confidence: 1, reason: '无效' }))
})

test('friend baseline exceeds temporary contacts without erasing earned affinity or repeatedly adding the baseline', (t) => {
  const f = fixture(t), e = f.observe()
  f.store.setContact(A, 'temporary'); f.store.changeAffinity({ ...item(e), delta: 2, reason: '真实互动' })
  assert.equal(f.store.setContact(A, 'friend').value, 12)
  assert.equal(f.store.setContact(A, 'friend').value, 12)
  assert.equal(f.store.setContact(A, 'temporary').value, 2)
  assert.equal(f.store.setContact(A, 'friend').value, 12)
  f.store.forgetSource(e.id)
  assert.equal(f.store.db.prepare('SELECT value FROM affinity WHERE uid=?').get(A).value, 10)
})

test('daily scheduling observes the 04:00 Taiwan boundary and delayed terms wait for next calendar day', (t) => {
  const f = fixture(t), e = f.observe(P, A, '这个赛博词看不懂')
  assert.equal(dueDay(Date.parse('2026-10-30T03:59:00+08:00')), '2026-10-28')
  assert.equal(dueDay(f.now()), '2026-10-29')
  f.store.noteTerm({ ...item(e), term: '赛博词', kind: 'public_term' })
  assert.equal(f.store.db.prepare('SELECT due FROM terms').get().due, '2026-10-30')
  f.store.scheduleDaily(() => true); assert.equal(f.store.stats().jobs[0].n, 1)
})

test('long daily messages are fully partitioned and late arrivals do not re-enqueue reviewed sources', (t) => {
  const f = fixture(t), text = '长'.repeat(12000), e = f.observe(P, A, text)
  f.store.scheduleDaily(() => true)
  const parts = f.store.db.prepare('SELECT * FROM review_parts WHERE source=? ORDER BY part').all(e.id)
  assert.equal(parts.map((p) => p.text).join(''), text)
  const before = f.store.db.prepare('SELECT count(*) n FROM jobs').get().n
  f.store.scheduleDaily(() => true); assert.equal(f.store.db.prepare('SELECT count(*) n FROM jobs').get().n, before)
  f.observe(P, A, '这条迟到了', '2'); f.store.scheduleDaily(() => true)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM jobs').get().n, before + 1)
})

test('large interaction review advances through every source without a thinking-budget retry loop', async (t) => {
  const f = fixture(t), parts = []
  for (let n = 0; n < 12; n++) { const e = f.observe(P, A, '一段实际对话'.repeat(300), String(n)); parts.push(e) }
  f.store.enqueue({ id: 'refresh', kind: 'daily', scope: P, day: '0000-interaction-refresh', payload: { mode: 'interaction-quality-v1', parts } })
  const seen = new Set(), model = { ask: async (_system, text) => { const input = JSON.parse(text); for (const e of input.messages) seen.add(e.text); assert.ok(input.messages.reduce((n, e) => n + e.text.length, 0) <= 6000); return '{"items":[],"terms":[]}' } }
  let calls = 0; model.ask = ((original) => async (...args) => { calls++; return original(...args) })(model.ask)
  const worker = new LearningWorker(f.store, model, { settings: () => ({}), permitted: () => true })
  for (let n = 0; n < 20; n++) { const job = f.store.nextJob(['daily']); if (!job) { f.advance(2000); continue }; await worker.execute(job); f.advance(2000) }
  assert.equal(f.store.db.prepare("SELECT status FROM jobs WHERE id='refresh'").get().status, 'done')
  assert.equal(calls, 4)
})

test('daily review keeps valid rows and quarantines foreign sources without importing them', async (t) => {
  const f = fixture(t), e = f.observe(), other = f.observe(G, B, '另一群的消息', '3')
  f.store.scheduleDaily((s) => s === P)
  const model = { ask: async () => JSON.stringify({ items: [{ ...item(e) }, { ...item(other) }], terms: [] }) }
  const worker = new LearningWorker(f.store, model, { settings: () => ({}), permitted: () => true })
  const job = f.store.nextJob(['daily'])
  await worker.execute(job)
  assert.equal(f.store.stats().items, 1)
  const saved = f.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id)
  assert.equal(saved.status, 'pending'); assert.match(saved.error, /daily_evidence_pending/)
  assert.deepEqual(JSON.parse(saved.payload).parts.map((p) => p.id), [e.id])
  assert.doesNotMatch(f.store.context(P), /另一群/)
  assert.equal(JSON.parse(saved.result).rejected[0].error, 'daily_source_outside_batch')
})

test('daily cached review resolves short aliases and unique same-speaker quotes without another paid call', async (t) => {
  const f = fixture(t), e = f.observe(), e2 = f.observe(P, A, '朋友说话别装神秘', '2', { at: e.at + 1000 })
  f.store.scheduleDaily(() => true)
  const response = { items: [{ ...item(e), source: 'm1' }, { ...item(e2), source: 'wrong-hash' }, null], terms: [], relationships: [{ ...item(e), delta: 99, reason: 'invalid' }] }
  f.store.db.prepare('INSERT INTO model_outputs VALUES(?,?,?,?)').run('cached', JSON.stringify(response), '{}', f.now())
  const job = f.store.nextJob(['daily']); job.payload = JSON.stringify({ ...JSON.parse(job.payload), cachedOutputId: 'cached' })
  const worker = new LearningWorker(f.store, { ask: () => { throw new Error('must reuse cache') } }, { settings: () => ({}), permitted: () => true })
  const result = await worker.daily(job)
  assert.equal(result.itemCount, 2); assert.equal(result.relationshipCount, 0)
  assert.equal(result.sourceCorrections.length, 1); assert.equal(result.sourceCorrections[0].to, e2.id)
  assert.equal(result.rejected.length, 2); assert.equal(f.store.stats().items, 2)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM affinity_events').get().n, 0)
})

test('forgotten sources cannot return through daily learning or cached terms', async (t) => {
  const f = fixture(t), e = f.observe(P, A, '记住私密金丝雀')
  f.store.learn(item(e, 'episode', '私密金丝雀')); f.store.noteTerm({ ...item(e), term: '金丝雀', kind: 'local_alias' })
  f.store.scheduleDaily(() => true); f.store.forgetSource(e.id)
  const worker = new LearningWorker(f.store, { ask: () => { throw new Error('must not call') } }, { settings: () => ({}), permitted: () => true })
  assert.equal((await worker.daily(f.store.nextJob(['daily']))).itemCount, 0)
  assert.doesNotMatch(f.store.context(P), /金丝雀/)
})

test('budget waits retain a visible reason and resume time until a real job succeeds', async (t) => {
  const f = fixture(t); f.observe(); f.store.scheduleDaily(() => true)
  const worker = new LearningWorker(f.store, { ask: async () => { throw new Error('background_daily_foreground_reserve_wait') } }, { settings: () => ({}), permitted: () => true })
  const job = f.store.nextJob(['daily'])
  await assert.rejects(worker.execute(job), /foreground_reserve_wait/)
  const reasons = f.store.pendingReasons()
  assert.equal(reasons.length, 1); assert.equal(reasons[0].kind, 'daily')
  assert.equal(reasons[0].retryAt, Date.parse('2026-10-30T00:00:00Z'))
  assert.equal(f.store.nextJob(['daily']), undefined)
  assert.equal(f.store.pendingReasons()[0].error, 'background_daily_foreground_reserve_wait')
  f.store.settle(job, { result: { recovered: true } }); assert.deepEqual(f.store.pendingReasons(), [])
})

test('normal silence is not offline, actual disconnection creates durable scope coverage tasks', (t) => {
  const f = fixture(t)
  heartbeat(f.store, true, [P]); f.advance(20000); heartbeat(f.store, true, [P])
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM gaps').get().n, 0)
  f.advance(10000); heartbeat(f.store, false, [P]); f.advance(180000); heartbeat(f.store, true, [P, G])
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM gaps').get().n, 1)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM coverage').get().n, 2)
})

test('history pagination saves real missed messages and stops only at the prior online boundary', async (t) => {
  const f = fixture(t); heartbeat(f.store, true, [P]); const start = f.now()
  f.advance(180000); heartbeat(f.store, true, [P])
  let coverage = f.store.db.prepare('SELECT * FROM coverage').get()
  const call = async () => ({ messages: [{ time: start / 1000 + 90, user_id: A, message_id: 'h1', message: [{ type: 'text', data: { text: '你刚才不在吗？' } }] }, { time: start / 1000 - 1, user_id: A, message_id: 'old', message: [] }] })
  await recoverPage(f.store, coverage, { call, permitted: () => true, selfId: B })
  coverage = f.store.db.prepare('SELECT * FROM coverage').get()
  assert.equal(coverage.status, 'covered'); assert.equal(f.store.stats().messages, 1)
  assert.equal(pendingCatchup(f.store, P).length, 1)
  f.store.observe({ scope: P, uid: B, mid: 'bot-proof', role: 'bot', text: '刚补看', at: f.now() })
  assert.equal(pendingCatchup(f.store, P).length, 0)
})

test('repeated history pages and empty pages leave honest partial coverage', async (t) => {
  const f = fixture(t); heartbeat(f.store, true, [P]); const start = f.now(); f.advance(180000); heartbeat(f.store, true, [P])
  const data = { messages: [{ time: start / 1000 + 90, user_id: A, message_id: 'h1', message: [] }] }
  const opts = { call: async () => data, permitted: () => true, selfId: B }
  await recoverPage(f.store, f.store.db.prepare('SELECT * FROM coverage').get(), opts)
  await recoverPage(f.store, f.store.db.prepare('SELECT * FROM coverage').get(), opts)
  assert.equal(f.store.db.prepare('SELECT status FROM coverage').get().status, 'partial')
  assert.equal(f.store.stats().messages, 1)
})

test('revoked scope cannot be backfilled even if an API request already returned', async (t) => {
  const f = fixture(t); heartbeat(f.store, true, [P]); f.advance(180000); heartbeat(f.store, true, [P]); let permission = true
  await recoverPage(f.store, f.store.db.prepare('SELECT * FROM coverage').get(), { call: async () => { permission = false; return { messages: [] } }, permitted: () => permission, selfId: B })
  assert.equal(f.store.stats().messages, 0)
})

test('failed earlier book study cannot be skipped while unrelated daily work can proceed', (t) => {
  const f = fixture(t)
  for (const id of ['book:000001', 'book:000002']) f.store.enqueue({ id, kind: 'book', payload: {} })
  const job = f.store.nextJob(); f.store.claim(job); f.store.settle(job, { error: 'source failure', delay: 60000 })
  assert.equal(f.store.nextJob(), undefined)
  f.observe(); f.store.scheduleDaily(() => true); assert.equal(f.store.nextJob().kind, 'daily')
})

test('background budget reserves before paid calls and retains unknown costs', async (t) => {
  const f = fixture(t); let calls = 0
  const model = new BackgroundModel(f.store, () => ({ modelEnabled: true, dailyPoints: 1 }), { token: () => 'test', fetcher: async () => { calls++; throw new Error('unreachable') } })
  await assert.rejects(model.ask('a', 'b'), /unreachable/)
  assert.equal(f.store.db.prepare('SELECT status FROM budget').get().status, 'failed_or_unknown')
  await assert.rejects(model.ask('a', 'b'), /budget/)
  assert.equal(calls, 1)
})

test('explicit unrestricted usage continues past historical local budgets while retaining an auditable bill', async (t) => {
  const f = fixture(t); f.store.db.prepare('INSERT INTO budget VALUES(?,?,?,?,?,?)').run('old', '2026-10-29', 9999, 9999, 'finished', f.now())
  const fetcher = async (url) => ({ ok: true, json: async () => url.endsWith('/health') ? { provider: 'tongji', model: 'DeepSeek-V4.1-Flash', cash_allowed: false, local_usage_limits: 'unrestricted' } : { model: 'DeepSeek-V4.1-Flash', choices: [{ message: { content: 'continued' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } })
  const model = new BackgroundModel(f.store, () => ({ modelEnabled: true, unrestrictedUsage: true, dailyPoints: 0 }), { token: () => 'test', fetcher })
  assert.equal(await model.ask('system', 'book', { maxTokens: 32768 }), 'continued')
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM budget').get().n, 2)
})

test('foreground semantic review remains available when study is paused and uses a system instruction without model fallback',async t=>{
  const f=fixture(t);let request
  const fetcher=async (url,opts)=>({ok:true,json:async()=>url.endsWith('/health')?{provider:'tongji',model:'DeepSeek-V4.1-Flash',cash_allowed:false,local_usage_limits:'unrestricted'}:(request=JSON.parse(opts.body),{model:'DeepSeek-V4.1-Flash',choices:[{message:{content:'{"change":false}'}}],usage:{prompt_tokens:10,completion_tokens:5}})})
  const model=new BackgroundModel(f.store,()=>({modelEnabled:false,unrestrictedUsage:true}),{token:()=> 'test',fetcher})
  await assert.rejects(model.ask('人物核心','草稿'),/not_configured/)
  assert.equal(await model.ask('人物核心','草稿',{foreground:true,timeoutMs:45000}),'{"change":false}')
  assert.equal(request.fy_background,false);assert.equal(request.fy_primary_only,true)
  assert.deepEqual(request.messages,[{role:'system',content:'人物核心'},{role:'user',content:'草稿'}])
})

test('local aliases and uncertain terms stay local without network requests', async (t) => {
  const f = fixture(t), e = f.observe(P, A, '阿某是我们给朋友起的外号')
  f.store.noteTerm({ ...item(e), term: '阿某', kind: 'local_alias' })
  const worker = new LearningWorker(f.store, null, { settings: () => ({}), permitted: () => true, fetcher: () => { throw new Error('private term must not leave device') } })
  await worker.termTick(); assert.equal(f.store.db.prepare('SELECT status FROM terms').get().status, 'local_only')
})

test('semantic memory filters by scope before ranking and respects forget and current-message exclusion', (t) => {
  const f = fixture(t), vectors = new MemoryVectors(f.store), privateSource = f.observe(P, A, '私密金丝雀'), groupSource = f.observe(G, A, '群里提过备考计划', '2')
  const v = new Float32Array(1024); v[0] = 1
  vectors.seed(); f.store.db.prepare('UPDATE embeddings SET vector=?').run(Buffer.from(v.buffer))
  assert.equal(vectors.search(v, G, [A]).length, 1)
  assert.doesNotMatch(JSON.stringify(vectors.search(v, G, [A])), /私密金丝雀/)
  assert.equal(vectors.search(v, `private:${B}`, [A]).length, 0)
  assert.equal(vectors.search(v, P, [A], { excludeIds: [privateSource.id] }).length, 1)
  f.store.forgetSource(privateSource.id); f.store.forgetSource(groupSource.id)
  assert.deepEqual(vectors.search(v, P, [A]), [])
})

test('local semantic indexing fully partitions long messages and does not index bot replies as user facts', async (t) => {
  const f = fixture(t); f.observe(P, A, '话'.repeat(12000))
  f.observe(P, B, '机器人自己说过的话', 'bot', { role: 'bot' })
  const vectors = new MemoryVectors(f.store, { fetcher: async (_url, opts) => {
    const input = JSON.parse(opts.body).input
    return { ok: true, json: async () => ({ embeddings: input.map(() => [1, ...Array(1023).fill(0)]) }) }
  } })
  await vectors.tick()
  assert.equal(f.store.db.prepare('SELECT sum(length(text)) n FROM embeddings').get().n, 12000)
  assert.equal(f.store.db.prepare('SELECT count(vector) n FROM embeddings').get().n, 7)
})

test('delivery reconciliation fills silent transport losses without inventing an absence', (t) => {
  const f = fixture(t); f.observe()
  scheduleReconciliation(f.store, [P]); scheduleReconciliation(f.store, [P])
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM coverage').get().n, 1)
  assert.equal(f.store.db.prepare('SELECT reason FROM gaps').get().reason, 'delivery_reconciliation')
  assert.doesNotMatch(f.store.context(P), /absence|未保持在线/)
})

test('an explicit short disconnect is not discarded before history recovery', (t) => {
  const f = fixture(t); heartbeat(f.store, true, [P]); f.advance(1000); heartbeat(f.store, false, [P]); f.advance(2000); heartbeat(f.store, true, [P])
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM gaps').get().n, 1)
})

test('public word lookup refuses local targets and validation pages rather than bypassing them', async () => {
  assert.equal(publicAddress('127.0.0.1'), false); assert.equal(publicAddress('10.0.0.1'), false); assert.equal(publicAddress('::1'), false); assert.equal(publicAddress('8.8.8.8'), true)
  let fetched = false
  await assert.rejects(publicExcerpt('https://private.example/path', { resolver: async () => [{ address: '127.0.0.1' }], fetcher: async () => { fetched = true } }), /not_public/)
  assert.equal(fetched, false)
  const body = new Response('<html>Verify you are human CAPTCHA</html>', { headers: { 'Content-Type': 'text/html' } })
  await assert.rejects(publicExcerpt('https://public.example/path', { resolver: async () => [{ address: '8.8.8.8' }], fetcher: async () => body }), /requires_interaction/)
})

test('public search retains actual source links and rejects generated answer pages and verification pages', () => {
  const html = '<h3 class="res-title"><a href="https://www.so.com/link?x=1" data-mdurl="https://source.example/explain?a=1&amp;b=2">网络<em>新词</em></a></h3><p>原始解释摘要</p><h3 class="res-title"><a data-mdurl="https://ai.so.com/search?q=新词">模型总结</a></h3><p>生成答案</p>'
  const items = parse360(html)
  assert.equal(items.length, 1); assert.equal(items[0].url, 'https://source.example/explain?a=1&b=2')
  assert.match(items[0].snippet, /原始解释摘要/)
  assert.throws(() => parse360('<title>安全验证</title>'), /requires_interaction/)
  assert.throws(() => parse360('<title>访问异常页面</title>'), /requires_interaction/)
})

test('public lookup preserves both provider failure reasons without treating verification as evidence', async () => {
  let calls = 0
  const fetcher = async () => { if (++calls === 1) return { ok: true, url: 'https://qcaptcha.so.com/index', text: async () => '<title>访问异常页面</title>' }; throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }) }
  await assert.rejects(searchPublicTerm('公开新词', fetcher), /360=search_requires_interaction;bing=ECONNRESET/)
  assert.equal(calls, 2)
})

test('missed daily life jobs remain separate days rather than pretending nothing happened', async (t) => {
  const f = fixture(t)
  const worker = new LearningWorker(f.store, { ask: async () => JSON.stringify({ text: '一次小试验未成，先封存记录，隔日再看。' }) }, { settings: () => ({}), permitted: () => true })
  await worker.tick(); f.advance(3 * 86400000); await worker.tick()
  const jobs = f.store.db.prepare("SELECT day,status FROM jobs WHERE kind='life' ORDER BY day").all()
  assert.equal(jobs.length, 4); assert.equal(jobs[1].day, '2026-10-31'); assert.equal(jobs.at(-1).status, 'pending')
})

test('recovering a previously truncated source reviews and indexes only the missing suffix', async (t) => {
  const f = fixture(t), e = f.observe(P, A, '字'.repeat(3000)), vectors = new MemoryVectors(f.store)
  f.store.scheduleDaily(() => true); vectors.seed()
  f.observe(P, A, '字'.repeat(6000)); f.store.scheduleDaily(() => true); vectors.seed()
  assert.equal(f.store.db.prepare('SELECT sum(length(text)) n FROM review_parts WHERE source=?').get(e.id).n, 6000)
  assert.equal(f.store.db.prepare('SELECT sum(length(text)) n FROM embeddings WHERE source=?').get(e.id).n, 6000)
  f.observe(P, A, '更换原话不被接受'.repeat(1000))
  assert.equal(f.store.message(e.id).text, '字'.repeat(6000))
})

test('dialogue recall includes delivered past replies with honest labels and hides forgotten echoes', (t) => {
  const f = fixture(t), e = f.observe(P, A, '私密金丝雀约定')
  f.observe(P, B, '我记住金丝雀了', 'bot1', { role: 'bot', at: e.at + 1000, origin: 'gateway_receipt' })
  f.observe(`private:${B}`, B, '另一个人的秘密', 'other')
  for (let i = 0; i < 130; i++) f.observe(P, A, '不相关的后来聊天', 'later' + i, { at: e.at + 600000 + i * 1000 })
  const recalled = f.store.dialogue(P, '金丝雀')
  assert.ok(recalled.some((r) => r.role === 'bot' && r.status.includes('not_verified_fact_or_action')))
  assert.doesNotMatch(JSON.stringify(recalled), /另一个人的秘密/)
  f.store.forgetSource(e.id)
  assert.doesNotMatch(JSON.stringify(f.store.dialogue(P, '金丝雀')), /金丝雀/)
})

test('book reading salvages exact same-chapter source corrections, retains verified progress and rereads only the evidence gap', async (t) => {
  const f = fixture(t), path = f.file + '.original', original = new DatabaseSync(path)
  original.exec('CREATE TABLE chunks(id TEXT,sequence INTEGER,volume INTEGER,number_text TEXT,title TEXT,part INTEGER,passage TEXT,source_label TEXT)')
  for (const row of [ ['a', 1, 1, '一', '第一章', 1, '【资料】\n\n第一章的起因在这里。', '来源一'], ['b', 1, 1, '一', '第一章', 2, '【资料】\n\n另一分片明确记录了后果。', '来源二'], ['c', 2, 1, '二', '第二章', 1, '【资料】\n\n是酒虫！这是第二章新发现的线索。', '来源三'] ]) original.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)').run(...row)
  original.close()
  t.after(() => { try { rmSync(path) } catch {} })
  let calls = 0
  const model = { ask: async (_system, text) => {
    calls++; const parts = JSON.parse(text).parts
    if (calls === 1) return JSON.stringify({ claims: [{ source: '1:1', quote: '另一分片明确记录了后果。', subject: '事件', relation: '结果', object: '后果', stage: '卷1章1', perspective: '叙述', text: '第一章局势发生转变' }], chapterChecks: [{ sequence: 1, source: '1:1', quote: '第一章的起因在这里。', chain: '起因推动行动，行动产生后果。' }, { sequence: 2, source: '2:1', quote: '这句话并不存在', chain: '不应入库' }], continuity: '第一章已读，第二章还要核对。' })
    assert.deepEqual(parts.map((p) => p.sequence), [2])
    return JSON.stringify({ claims: [], chapterChecks: [{ sequence: 2, source: '2:1', quote: '是酒虫！', chain: '追踪线索后发现酒虫。' }], continuity: '第二章线索已核对。' })
  } }
  const worker = new LearningWorker(f.store, model, { settings: () => ({ originalDbPath: path }), permitted: () => true }); f.beforeClose(() => worker.close())
  worker.seedBook(); let job = f.store.nextJob(['book']); await worker.execute(job)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM book_claims').get().n, 2)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM book_sources WHERE readJob IS NOT NULL').get().n, 2)
  job = f.store.db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id)
  assert.equal(job.status, 'pending'); assert.deepEqual(JSON.parse(job.payload).pendingIds, ['c'])
  await worker.execute(job)
  assert.equal(f.store.db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id).status, 'done')
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM book_claims').get().n, 3)
  worker.seedReviews(); worker.seedReviews()
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM jobs WHERE kind='review'").get().n, 1)
})
