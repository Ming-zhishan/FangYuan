import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fangyuan from '../modules/fangyuan/index.mjs'
import { SocialStore } from '../modules/memory/store.mjs'
import { removeTestDirectory } from './temp.mjs'

test('compiled persona respects a changed persona card instead of silently replacing user edits', () => {
  const listeners = []
  const service = fangyuan.setup({ on: (event, fn) => listeners.push({ event, fn }), rule() {}, route() {} })
  const persona = listeners.find((l) => l.event === 'persona').fn
  assert.equal(persona('用户修改后的人格卡'), '用户修改后的人格卡')
  assert.equal(service.personaCore(), '用户修改后的人格卡')
  const full = readFileSync(new URL('../personas/gu-yue-fang-yuan.md', import.meta.url), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
  const compact = persona(full)
  assert.equal(compact, readFileSync(new URL('../modules/fangyuan/core.txt', import.meta.url), 'utf8').trim())
  assert.match(compact, /古月方源|九转炼道尊者|永生|关系不代替权限/)
})
test('forgetting a source excludes its facts, original text, generated answers and relationship inference', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-forget-')); t.after(() => removeTestDirectory(dir))
  const store = new SocialStore(join(dir, 'memory.json'))
  const e = store.observe({ chatId: 'private:100001', userId: '100001', messageId: '1', text: '我喜欢金丝雀' })
  store.setTone({ scope: e.scope, uid: e.uid, eventId: e.id, quote: '金丝雀', tone: '熟悉', reason: '测试依据' })
  store.recordOutput({ scope: e.scope, sourceIds: [e.id], text: '以前谈过金丝雀' })
  const fact = store.read().facts[0]
  store.forget({ scope: e.scope, factId: fact.id })
  assert.doesNotMatch(new SocialStore(store.file).context(e.scope, { query: '以前金丝雀' }), /金丝雀|熟悉/)
  assert.throws(() => store.remember({ scope: e.scope, uid: e.uid, eventId: e.id, quote: '金丝雀', text: '又记回来' }))
  assert.equal(store.read().events[0].forgotten, true)
  assert.throws(() => store.forget({ scope: 'private:100002', factId: fact.id }))
})
