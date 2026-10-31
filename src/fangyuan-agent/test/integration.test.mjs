import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import memory from '../modules/memory/index.mjs'
import fangyuan from '../modules/fangyuan/index.mjs'
import mood from '../modules/mood/index.mjs'
import speakup from '../modules/speakup/index.mjs'
import diary from '../modules/diary/index.mjs'
import { removeTestDirectory } from './temp.mjs'

const A = '100001', B = '100002', G = 'group:200001'
async function harness(t, changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-adapter-'))
  t.after(() => removeTestDirectory(dir))
  const cfg = { enabled: true, dryRun: false, ownerQQ: A, allow: { private: [B] }, memory: { enabled: true },
    speakUp: { enabled: true, awakeFrom: 0, awakeTo: 24, idleMinutes: 5, minIntervalMinutes: 5, maxPerDay: 4 },
    diary: { enabled: true, timesPerDay: 2, maxChars: 140, minGapMinutes: 60 },
    ext: { fangyuan: { specialFriendQQ: A, scopedMemory: true, proactive: true, proactiveTargets: [`private:${A}`, `private:${B}`], publicActions: true } }, ...changes }
  const live = new Map(), builders = new Map(), contexts = new Map(), listeners = [], calls = [], routes = []
  let speakers = [A], response = '上次的话题，你后来想得如何？', receipt = { message_id: 80001 }, ownerPresent = true
  const core = { mutes: { muted: () => false }, hub: {
    speakersOf: () => speakers, lastTextOf: () => '喜欢', turnSendersAllOwner: () => ownerPresent,
    async runSystemTurn(name, title, prompt, opts) { calls.push({ type: 'think', name, prompt, opts }); return typeof response === 'function' ? response(name, prompt) : response },
    chatLogOf() { throw new Error('Public writing must not read private transcripts') },
  }, http: { body: async (req) => req } }
  for (const definition of [fangyuan, memory, mood, speakup, diary]) {
    const ownTools = [], ownContexts = []; builders.set(definition.id, ownTools); contexts.set(definition.id, ownContexts)
    const api = {
      config: () => cfg, core, use: (id) => live.get(id),
      dataDir: (...parts) => { const p = join(dir, definition.id); mkdirSync(p, { recursive: true }); return join(p, ...parts) },
      on: (event, fn) => listeners.push({ event, fn }), context: (fn) => ownContexts.push(fn),
      rule: () => {}, command: () => {}, tool: (fn) => ownTools.push(fn), defineTool: (x) => x, every: () => {}, route: (path, fn) => routes.push({ path, fn }),
      log: { warn: (...args) => calls.push({ type: 'warning', args }) },
      async sendSegments(chatId, segments) { calls.push({ type: 'send', chatId, segments }); return receipt },
      async onebot(action, args) { calls.push({ type: 'onebot', action, args }); return receipt },
      lib(path) { assert.equal(path, 'features/qzone-audience.js'); return { resolveAudience: () => ({ visibility: 'self', ugc_right: 64 }) } },
    }
    live.set(definition.id, await definition.setup(api))
  }
  return { cfg, live, calls, contexts, core, routes,
    tools: (id, chat, sessionId = 'test') => builders.get(id).flatMap((fn) => fn({ chat, sessionId })),
    emit: async (msg) => { for (const { event, fn } of listeners) if (event === 'message') await fn(msg) },
    prompt: (content) => listeners.filter((x) => x.event === 'prompt').reduce((value, { fn }) => value === null ? null : fn(value), content),
    speakers: (ids) => { speakers = ids }, answer: (value) => { response = value }, receipt: (value) => { receipt = value }, ownerPresent: (value) => { ownerPresent = value },
  }
}
async function source(h, uid = A, scope = `private:${uid}`, text = '我喜欢吃辣') {
  await h.emit({ chatId: scope, userId: uid, messageId: `${uid}-${scope}-${text}`, text })
  return h.live.get('memory').store.read().events.at(-1)
}
function pending(h, e) {
  const store = h.live.get('memory').store
  const j = store.schedule({ scope: e.scope, uid: e.uid, eventId: e.id, reason: '继续实际谈过的话题', dueAt: Date.now() + 1000 })
  store.mutate((s) => { s.events.find((x) => x.id === e.id).at = Date.now() - 3600000; s.jobs.find((x) => x.id === j.id).dueAt = Date.now() - 1000 })
  return j
}
test('adapter observes sources and returns only the current speakers scoped context', async (t) => {
  const h = await harness(t)
  await source(h, A, `private:${A}`, '记住：私事金丝雀')
  await source(h, B, G, '我喜欢甜食')
  h.speakers([B])
  const context = h.contexts.get('memory').map((fn) => fn({ chat: { kind: 'group', chatId: G, groupId: '200001' }, sessionId: 'group' })).join('\n')
  assert.match(context, /甜食/); assert.doesNotMatch(context, /金丝雀/)
})
test('tool extra arguments cannot override trusted scope or identity', async (t) => {
  const h = await harness(t), e = await source(h)
  const tool = h.tools('memory', { kind: 'private', chatId: e.scope, userId: A }).find((x) => x.name === 'remember')
  await tool.execute({ source: e.id, uid: A, quote: '我喜欢吃辣', text: '喜欢吃辣', kind: 'preference', scope: G, eventId: 'injected' })
  assert.equal(h.live.get('memory').store.read().facts.at(-1).scope, `private:${A}`)
  await assert.rejects(tool.execute({ source: e.id, uid: B, quote: '我喜欢吃辣', text: 'borrowed', kind: 'preference' }))
})
test('disabled memory exposes no tools or context', async (t) => {
  const h = await harness(t, { ext: { fangyuan: { scopedMemory: false } } })
  await source(h)
  assert.equal(h.live.get('memory').store.read().events.length, 0)
  assert.deepEqual(h.tools('memory', { kind: 'private', userId: A }), [])
  assert.ok(h.contexts.get('memory').every((fn) => fn({ chat: { kind: 'private', userId: A } }) === ''))
})
test('mood replacement does not punish banter or reward flattery', async (t) => {
  const h = await harness(t), m = h.live.get('mood')
  m.observe('滚，笑死我了', '熟人'); m.observe('你最可爱最乖', '陌生人')
  assert.equal(m.contextLine(), ''); assert.equal(m.effects().chatty, 1)
})
test('shared native memory can stay disabled while scoped memory works', async (t) => {
  const h = await harness(t, { memory: { enabled: false } }); await source(h)
  assert.equal(h.live.get('memory').store.read().facts.length, 1)
})
test('a missing or native fallback module blocks admission instead of silently proceeding', async (t) => {
  const h = await harness(t), content = [{ type: 'text', text: '你好' }]
  assert.deepEqual(h.prompt(content), content)
  h.live.set('memory', { contextFor: () => 'unsafe native fallback' })
  assert.equal(h.prompt(content), null)
})
test('follow-ups use different no-tools background sessions for different people', async (t) => {
  const h = await harness(t), a = pending(h, await source(h, A)), b = pending(h, await source(h, B))
  await h.live.get('speakup').tick()
  h.live.get('memory').store.mutate((s) => { for (const x of s.outcomes) x.at -= 3600000 })
  await h.live.get('speakup').tick()
  const thoughts = h.calls.filter((x) => x.type === 'think')
  assert.equal(thoughts.length, 2); assert.notEqual(thoughts[0].name, thoughts[1].name)
  assert.ok(thoughts.every((x) => x.opts.noTools === true))
  assert.equal(h.live.get('memory').store.read().jobs.find((j) => j.id === a.id).status, 'sent')
  assert.equal(h.live.get('memory').store.read().jobs.find((j) => j.id === b.id).status, 'sent')
})
test('permission revoked during thought prevents a send', async (t) => {
  const h = await harness(t); pending(h, await source(h, B))
  h.answer(() => { h.cfg.allow.private = []; return '后来如何？' })
  await h.live.get('speakup').tick()
  assert.equal(h.calls.filter((x) => x.type === 'send').length, 0)
})
test('an empty send acknowledgement never becomes a claimed success or repeated send', async (t) => {
  const h = await harness(t); pending(h, await source(h)); h.receipt(null)
  await h.live.get('speakup').tick(); await h.live.get('speakup').tick()
  assert.equal(h.live.get('memory').store.read().jobs[0].status, 'unknown')
  assert.equal(h.calls.filter((x) => x.type === 'send').length, 1)
})
test('public writing receives no private transcripts and can choose silence', async (t) => {
  const h = await harness(t); await source(h, A, `private:${A}`, '记住：私事金丝雀'); h.answer('[沉默]')
  const r = await h.live.get('diary').writeDiary()
  assert.equal(r.sent, false); assert.equal(h.calls.filter((x) => x.type === 'onebot').length, 0)
  assert.doesNotMatch(h.calls.find((x) => x.type === 'think').prompt, /金丝雀/)
})
test('a simulated public draft never sends and persists as simulated', async (t) => {
  const h = await harness(t, { dryRun: true }); h.answer('路还长，走下去便是。')
  const r = await h.live.get('diary').writeDiary()
  assert.equal(r.simulated, true); assert.equal(h.calls.filter((x) => x.type === 'onebot').length, 0)
  assert.equal(h.live.get('memory').store.read().publications.at(-1).status, 'simulated')
})
test('public writes require an actual returned identifier and never retry an unknown outcome', async (t) => {
  const h = await harness(t); h.answer('路还长，走下去便是。'); h.receipt({})
  const r = await h.live.get('diary').writeDiary(); await h.live.get('diary').writeDiary()
  assert.equal(r.unknown, true); assert.equal(h.calls.filter((x) => x.type === 'onebot').length, 1)
  h.live.get('memory').store.mutate((s) => { for (const row of s.publications) row.at -= 7200000 })
  await h.live.get('diary').writeDiary()
  assert.equal(h.calls.filter((x) => x.type === 'onebot').length, 1)
})
test('non-owner chats do not gain public posting tools', async (t) => {
  const h = await harness(t)
  assert.deepEqual(h.tools('diary', { kind: 'group', chatId: G }), [])
  assert.deepEqual(h.tools('diary', { kind: 'private', userId: B }), [])
  const tool = h.tools('diary', { kind: 'private', userId: A })[0]
  h.ownerPresent(false)
  assert.equal((await tool.execute({ topic: '随想' })).ok, false)
})

test('opened public proposals work in friend and group scenes without exporting other private material', async (t) => {
  const h = await harness(t)
  h.cfg.ext.fangyuan.publicRequestsFromAll = true; h.cfg.allow.groups = ['200001']
  await source(h, A, `private:${A}`, '记住：私密金丝雀不能外传')
  await source(h, B, `private:${B}`, '发条关于下雨的说说吧')
  h.live.set('learning', { publicRelationship: (uid) => ({ uid, kind: 'friend', affinity: -12 }) })
  const friend = h.tools('diary', { kind: 'private', chatId: `private:${B}`, userId: B })[0]
  assert.ok(friend, 'an admitted friend can propose a public post')
  assert.ok(h.tools('diary', { kind: 'group', chatId: G, userId: B, groupId: '200001' })[0])
  h.answer('{"accept":true,"text":"雨还在下。"}'); h.receipt({ tid: 'public-1' })
  const result = await friend.execute({ topic: '下雨', proposal: '雨还在下。' })
  assert.equal(result.sent, true, 'low affinity is not a permission barrier')
  const prompt = h.calls.find((x) => x.type === 'think').prompt
  assert.match(prompt, /-12/); assert.match(prompt, /雨还在下/); assert.doesNotMatch(prompt, /金丝雀/)
})

test('high affinity does not force publication and a revoked scene cannot execute an old tool', async (t) => {
  const h = await harness(t); h.cfg.ext.fangyuan.publicRequestsFromAll = true
  await source(h, B)
  h.live.set('learning', { publicRelationship: (uid) => ({ uid, kind: 'friend', affinity: 95 }) })
  const tool = h.tools('diary', { kind: 'private', chatId: `private:${B}`, userId: B })[0]
  assert.ok(tool)
  h.answer('{"accept":false,"reason":"今天不想发。"}')
  assert.equal((await tool.execute({ topic: '随想' })).sent, false)
  assert.equal(h.calls.filter((x) => x.type === 'onebot').length, 0)
  h.cfg.ext.fangyuan.publicRequestsFromAll = false
  assert.equal((await tool.execute({ topic: '随想' })).ok, false)
})

test('fresh explicit public proposals are not blocked by an autonomous consideration cooldown', async (t) => {
  const h = await harness(t); h.cfg.ext.fangyuan.publicRequestsFromAll = true
  h.answer('[沉默]'); await h.live.get('diary').writeDiary()
  await source(h, B)
  const tool = h.tools('diary', { kind: 'private', chatId: `private:${B}`, userId: B })[0]
  assert.ok(tool)
  h.answer('{"accept":true,"text":"今天就这样。"}'); h.receipt({ tid: 'public-2' })
  assert.equal((await tool.execute({ topic: '随想' })).sent, true)
  assert.equal((await tool.execute({ topic: '换个文字' })).sent, false, 'the same real request cannot publish twice')
})
test('every module imports from its own snapshot without sibling folder assumptions', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-snapshot-')); t.after(() => removeTestDirectory(dir))
  for (const name of ['memory', 'fangyuan', 'mood', 'speakup', 'diary']) {
    const dest = join(dir, name, '.aurabot-cache', 'test')
    cpSync(resolve('modules', name), dest, { recursive: true })
    const { default: mod } = await import(pathToFileURL(join(dest, 'index.mjs')))
    assert.equal(mod.id, name); assert.equal(mod.api, 1)
  }
})
