import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import conversation from '../modules/conversation/index.mjs'
import { removeTestDirectory } from './temp.mjs'

function harness(t, module = conversation) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-turn-input-'))
  t.after(() => removeTestDirectory(dir))
  const hooks = {}, contexts = [], prompts = []
  const rows = [
    { id: 'before', uid: '100001', role: 'user', text: '旧问题' },
    { id: 'sent', uid: '900001', role: 'bot', text: '已经答过' },
    { id: 'a', uid: '100001', role: 'user', text: '被误解时你怎么想？' },
    { id: 'b', uid: '100001', role: 'user', text: '被夸奖呢？' },
  ]
  const cfg = { enabled: true, ownerQQ: '100001', ext: { conversation: { reviewEnabled: true } } }
  const store = { conversationFrame: () => rows, context: () => '可信但非全知的相处记录' }
  module.setup({
    config: () => cfg, dataDir: name => join(dir, name),
    on: (name, fn) => { hooks[name] = fn }, context: fn => contexts.push(fn), route() {}, log: { warn() {} },
    use: id => id === 'learning' ? { store, permitted: () => true, reviewText: async prompt => { prompts.push(prompt); return '{"change":false}' } } : undefined,
    core: { hub: { lastTextOf: () => '被夸奖呢？' } },
  })
  const chat = { chatId: 'private:100001', userId: '100001', kind: 'private' }
  return { hooks, contexts, prompts, rows, cfg, chat, dir }
}

for (const [name, load] of [
  ['development', async () => conversation],
  ['deployment mirror', async () => (await import('../../aurabot-modules/conversation/index.mjs')).default],
]) {
  test(`${name}: review and context keep the full merged input beyond the host tail`, async t => {
    const h = harness(t, await load())
    const first = '开头的重要约束：' + '甲'.repeat(2000)
    h.rows.splice(2, 0, { id: 'long', uid: '100001', role: 'user', text: first })
    const queryText = first + '\n被误解时你怎么想？\n被夸奖呢？'
    const content = [{ type: 'text', text: queryText }]
    assert.equal(await (h.hooks.prompt?.(content, { chat: h.chat, senderId: '100001', queryText }) ?? content), content)
    const scene = JSON.parse(h.contexts[0]({ chat: h.chat, sessionId: 's' }).split('\n')[1])
    assert.equal(scene.currentBatch.text, queryText)
    assert.deepEqual(scene.currentBatch.sourceIds, ['long', 'a', 'b'])
    await h.hooks.reply('只答了夸奖', { chatId: h.chat.chatId, userText: '被夸奖呢？' })
    const prompt = h.prompts[0]
    assert.ok(prompt.includes(JSON.stringify(queryText).slice(1, -1)))
    assert.ok(prompt.includes('"sourceIds":["long","a","b"]'), 'review-row compression must not change current source identity')
    const diagnostic = JSON.parse(readFileSync(join(h.dir, 'review-events.jsonl'), 'utf8').trim())
    assert.equal(diagnostic.currentInputChars, queryText.length)
    assert.deepEqual(diagnostic.currentSourceIds, ['long', 'a', 'b'])
    assert.equal(diagnostic.currentInputSha256.length, 64)
    assert.equal(Object.hasOwn(diagnostic, 'text'), false)
  })

  test(`${name}: steering retains earlier questions; a fresh turn replaces them`, async t => {
    const h = harness(t, await load())
    const send = (text, extra = {}) => h.hooks.prompt?.([{ type: 'text', text }], { chat: h.chat, senderId: '100001', queryText: text, ...extra })
    await send('被误解时你怎么想？')
    await send('被夸奖呢？', { steer: true })
    await h.hooks.reply('草稿', { chatId: h.chat.chatId, userText: '被夸奖呢？' })
    assert.ok(h.prompts[0].includes('被误解时你怎么想？\\n被夸奖呢？'))
    await send('新话题')
    const scene = JSON.parse(h.contexts[0]({ chat: h.chat, sessionId: 's' }).split('\n')[1])
    assert.equal(scene.currentBatch.text, '新话题')
  })
}
