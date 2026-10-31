import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import conversation from '../modules/conversation/index.mjs'
import { personaDriftSignals } from '../modules/conversation/persona-drift.mjs'
const scope = 'private:100001'
function harness(t, answer) {
  const dir = mkdtempSync(join(tmpdir(), 'fy-conversation-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const prompts = [], store = { db: { prepare: () => ({ all: (s) => { assert.equal(s, scope); return [{ id: 'm1', uid: '100001', role: 'user', text: '你好' }] } }) }, context: (s) => { assert.equal(s, scope); return '共享印象：熟悉；本会话的可见记忆' } }
  let permitted = true
  const service = conversation.setup({ config: () => ({ enabled: true, ext: { conversation: { reviewEnabled: true } } }), dataDir: (name) => join(dir, name), on() {}, route() {}, log: { warn() {} }, use: (id) => id === 'fangyuan' ? { personaCore: () => '测试中实际生效的人格，不能被旧话改写' } : ({ store, permitted: () => permitted }),
    core: { hub: { runSystemTurn: async (id, title, prompt, opts) => { prompts.push({ id, prompt, opts }); return typeof answer === 'function' ? answer() : answer } } },
  })
  return { service, prompts, revoke: () => { permitted = false } }
}
test('semantic reply review uses only this conversation, no tools, and preserves real addressing', async (t) => {
  const h = harness(t, '{"change":true,"text":"你好。","reason":"普通问候无需审问"}')
  assert.equal(await h.service.review('<reply:123>你好，有事说事。', { chatId: scope, userText: '你好' }), '<reply:123>你好。')
  assert.equal(h.prompts[0].opts.noTools, true); assert.match(h.prompts[0].prompt, /共享印象/)
  assert.match(h.prompts[0].prompt, /测试中实际生效的人格，不能被旧话改写/)
})
test('reply reviewer cannot introduce another recipient or turn a direct response into silence', async (t) => {
  for (const text of ['<at:999999>过来', '[沉默]']) {
    const h = harness(t, JSON.stringify({ change: true, text }))
    assert.equal(await h.service.review('在。', { chatId: scope, userText: '方源' }), '在。')
  }
})
test('review failure preserves the draft and a permission change prevents delivery', async (t) => {
  const failed = harness(t, () => { throw new Error('model unavailable') })
  assert.equal(await failed.service.review('在。', { chatId: scope, userText: '你好' }), '在。')
  let h
  h = harness(t, () => { h.revoke(); return '{"change":true,"text":"你好。"}' })
  assert.equal(await h.service.review('在。', { chatId: scope, userText: '你好' }), null)
  h = harness(t, () => { h.revoke(); return '{"change":false}' })
  assert.equal(await h.service.review('在。', { chatId: scope, userText: '你好' }), null)
})

test('captured out-of-character drafts are not leaked when the reviewer returns bare silence or fails', async t => {
  const bad='我理解你在构建角色扮演。你希望进行什么样的互动？请提供更多细节。'
  const h=harness(t,'[沉默]')
  const result=await h.service.review(bad,{chatId:scope,userText:'名分比永生重要吗'})
  assert.equal(h.prompts.length,2);assert.notEqual(result,bad);assert.deepEqual(personaDriftSignals(result),[])
  assert.ok(personaDriftSignals('——我确实不是古月方源，也不是你的奴隶。').length)
  assert.deepEqual(personaDriftSignals('这边由DSH和模型承载，仍按方源的立场同你说话。'),[])
  assert.deepEqual(personaDriftSignals('叫声主人就有书看？先拿两页来瞧瞧。'),[])
})
