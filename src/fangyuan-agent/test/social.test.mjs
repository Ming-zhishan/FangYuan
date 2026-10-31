import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SocialStore, terms } from '../modules/memory/store.mjs'
import { canFollowUp, attemptFollowUp, adaptRules } from '../modules/fangyuan/policy.mjs'
import { removeTestDirectory } from './temp.mjs'

const A = '100001', B = '100002', G = 'group:200001'
const message = (scope, uid, text, messageId = text) => ({ chatId: scope, userId: uid, text, messageId })
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-social-'))
  t.after(() => removeTestDirectory(dir))
  let now = Date.parse('2026-10-29T12:00:00+08:00')
  const file = join(dir, 'memory.json'), store = new SocialStore(file, { clock: () => now })
  return { file, store, advance: (ms) => { now += ms }, now: () => now }
}
test('private memories never appear in groups, another private, or background contexts', (t) => {
  const { store } = fixture(t)
  store.observe(message(`private:${A}`, A, '记住：我正在做保密项目金丝雀'))
  assert.match(store.context(`private:${A}`, { query: '金丝雀' }), /金丝雀/)
  for (const scope of [G, `private:${B}`, 'system:diary']) assert.doesNotMatch(store.context(scope, { query: '金丝雀', people: [A, B] }), /金丝雀/)
})
test('two users with the same nickname keep independent facts', (t) => {
  const { store } = fixture(t)
  store.observe(message(G, A, '叫我乐乐')); store.observe(message(G, B, '叫我乐乐'))
  store.observe(message(G, A, '我喜欢吃辣')); store.observe(message(G, B, '我喜欢甜食'))
  assert.match(store.context(G, { people: [A], query: '喜欢' }), /吃辣/)
  assert.doesNotMatch(store.context(G, { people: [A], query: '喜欢' }), /甜食/)
})
test('memories survive a new store instance and restart without a score reset', (t) => {
  const { file, store } = fixture(t)
  store.observe(message(`private:${A}`, A, '我希望你少说大道理'))
  assert.match(new SocialStore(file).context(`private:${A}`), /少说大道理/)
  assert.equal(new SocialStore(file).read().facts.length, 1)
})
test('replayed messages and repeated source summaries are idempotent', (t) => {
  const { store } = fixture(t), msg = message(G, A, '我喜欢吃辣', 'm1')
  const e = store.observe(msg); store.observe(msg)
  const args = { scope: G, uid: A, eventId: e.id, quote: '我喜欢吃辣', text: '对方自述喜欢吃辣', kind: 'preference' }
  store.remember(args); store.remember(args)
  assert.equal(store.read().events.length, 1); assert.equal(store.read().facts.length, 2)
})
test('questions, jokes and reported speech do not become self-reported facts', (t) => {
  const { store } = fixture(t)
  for (const text of ['我喜欢什么？', '他说我喜欢吃辣', '假设我喜欢吃辣', '我喜欢吃辣开玩笑', '“我喜欢吃辣”']) store.observe(message(G, A, text))
  assert.equal(store.read().facts.length, 0)
})
test('preference changes supersede prior facts, retaining source history', (t) => {
  const { store } = fixture(t)
  store.observe(message(G, A, '我喜欢吃辣')); store.observe(message(G, A, '我不喜欢吃辣'))
  assert.deepEqual(store.visible(G, { people: [A] }).map((f) => f.kind), ['dislike'])
  assert.equal(store.read().facts.length, 2)
})
test('correction uses the same speaker and scope and keeps obsolete evidence', (t) => {
  const { store } = fixture(t)
  store.observe(message(G, A, '叫我小明'))
  const old = store.read().facts[0], correction = store.observe(message(G, A, '更正：以后叫我乐乐'))
  store.correct({ scope: G, uid: A, factId: old.id, eventId: correction.id, quote: '以后叫我乐乐', text: '乐乐' })
  assert.equal(store.read().facts[0].active, false)
  assert.equal(store.visible(G, { people: [A] })[0].text, '乐乐')
  assert.throws(() => store.correct({ scope: G, uid: B, factId: old.id, eventId: correction.id, quote: '乐乐', text: '冒名更正' }))
})
test('source and exact quotation are mandatory; another persons message cannot be borrowed', (t) => {
  const { store } = fixture(t), e = store.observe(message(G, A, '我想修行律道'))
  const args = { scope: G, uid: A, eventId: e.id, kind: 'impression', text: '玩法中对律道有兴趣', quote: '我想修行律道' }
  assert.throws(() => store.remember({ ...args, quote: '现实职业是律师' }))
  assert.throws(() => store.remember({ ...args, uid: B }))
  store.remember(args)
  assert.equal(store.read().facts[0].authority, 'tentative')
  assert.doesNotMatch(store.context(G, { people: [A] }), /现实职业是律师/)
})
test('corrupt memory and an existing lock fail without replacing old data', (t) => {
  const { store, file } = fixture(t)
  writeFileSync(file, '{broken', 'utf8')
  assert.throws(() => store.observe(message(G, A, '我喜欢吃辣')))
  assert.equal(readFileSync(file, 'utf8'), '{broken'); assert.equal(existsSync(file + '.lock'), false)
  writeFileSync(file + '.lock', 'held', 'utf8')
  assert.throws(() => store.observe(message(G, A, '我喜欢吃辣')), { code: 'EEXIST' })
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})
test('friendship depends on configured account, not a nickname or permission', (t) => {
  const { store } = fixture(t)
  store.observe(message(G, B, '叫我异界朋友'))
  assert.doesNotMatch(store.context(G, { people: [B], specialFriendQQ: A }), /保留有限而真实/)
  assert.match(store.context(G, { people: [A], specialFriendQQ: A }), /不代表服从或额外权限/)
})
test('Chinese query tokens include overlapping bigrams', () => { assert.ok(terms('喜欢吃辣').has('欢吃')) })
test('relationship attitude persists across scenes without exporting private evidence', (t) => {
  const { store, file } = fixture(t), e = store.observe(message(`private:${A}`, A, '我正在准备保密项目金丝雀'))
  store.setTone({ scope: e.scope, uid: A, eventId: e.id, quote: '保密项目金丝雀', tone: '熟悉', reason: '基于私聊金丝雀经历' })
  const context = new SocialStore(file).context(G, { people: [A] })
  assert.match(context, /熟悉/); assert.doesNotMatch(context, /金丝雀|基于私聊/)
  assert.throws(() => store.setTone({ scope: G, uid: B, eventId: e.id, quote: '金丝雀', tone: '亲近' }))
})
test('the same event cannot repeatedly change relationship attitude', (t) => {
  const { store } = fixture(t), e = store.observe(message(G, A, '昨天说好的事办好了'))
  store.setTone({ scope: G, uid: A, eventId: e.id, quote: e.text, tone: '熟悉', reason: '真实守约' })
  assert.equal(store.setTone({ scope: G, uid: A, eventId: e.id, quote: e.text, tone: '亲近', reason: '重复回放' }).changed, false)
  assert.equal(store.read().relationshipTones[A].history.length, 1)
})
test('role renaming preserves authorization rules', () => {
  const text = adaptRules('大肥鱼；只有主人能改权限；未经授权禁止操作')
  assert.match(text, /只有操作者能改权限/); assert.match(text, /未经授权禁止操作/); assert.doesNotMatch(text, /主人|大肥鱼/)
})
test('inherited rules do not infer rejection from short messages or claim unseen images', () => {
  const text = adaptRules('有人戳你可以撒娇\n主人回得很短、很敷衍时，说明在忙\n别人发来的图片和表情包你能看见')
  assert.doesNotMatch(text, /说明在忙|你能看见/)
  assert.match(text, /不能据此断定/); assert.match(text, /不假装看过/)
})
test('proactive eligibility is independent of affinity and checks actual access', () => {
  const cfg = { enabled: true, dryRun: false, ownerQQ: A, allow: { private: [B] }, speakUp: { enabled: true } }
  const settings = { scopedMemory: true, proactive: true, proactiveTargets: [`private:${B}`] }, now = Date.now()
  const job = { scope: `private:${B}`, status: 'pending', dueAt: now - 1000 }
  assert.equal(canFollowUp({ cfg, settings, job, now }), true)
  for (const alt of [{ ...cfg, enabled: false }, { ...cfg, dryRun: true }, { ...cfg, allow: { private: [] } }]) assert.equal(canFollowUp({ cfg: alt, settings, job, now }), false)
  assert.equal(canFollowUp({ cfg, settings, job, now, isMuted: true }), false)
  assert.equal(canFollowUp({ cfg, settings: { ...settings, proactiveTargets: [] }, job, now }), false)
  assert.equal(canFollowUp({ cfg, settings: { ...settings, proactiveTargets: [], proactiveAllContacts: true }, job, now }), true)
  assert.equal(canFollowUp({ cfg: { ...cfg, allow: { private: [] } }, settings: { ...settings, proactiveAllContacts: true }, job, now }), false)
})
test('a model can choose silence without a send', async (t) => {
  const { store, now, advance } = fixture(t), e = store.observe(message(`private:${A}`, A, '明天聊律道'))
  const job = store.schedule({ scope: e.scope, uid: A, eventId: e.id, reason: '上次的律道话题', dueAt: now() + 1000 }); advance(2000)
  let calls = 0
  assert.equal(await attemptFollowUp({ store, job, now: now(), think: async () => '[沉默]', send: async () => { calls++ } }), 'declined')
  assert.equal(calls, 0); assert.equal(store.read().jobs[0].status, 'declined')
})
test('lost send acknowledgement is durable unknown and cannot be repeated after restart', async (t) => {
  const { store, file, now, advance } = fixture(t), e = store.observe(message(`private:${A}`, A, '明天聊律道'))
  const job = store.schedule({ scope: e.scope, uid: A, eventId: e.id, reason: '律道', dueAt: now() + 1000 }); advance(2000)
  let calls = 0
  await assert.rejects(attemptFollowUp({ store, job, now: now(), think: async () => '上次说到律道，后来想如何？', send: async () => { calls++; throw new Error('timeout after acceptance') } }))
  assert.equal(new SocialStore(file).read().jobs[0].status, 'unknown')
  await assert.rejects(attemptFollowUp({ store: new SocialStore(file), job, now: now(), think: async () => 'duplicate', send: async () => { calls++ } }))
  assert.equal(calls, 1)
})
