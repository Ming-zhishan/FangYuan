import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { SocialStore } from '../modules/memory/store.mjs'
import { importLegacy } from '../tools/import_legacy.mjs'
import { LoreSearch } from '../modules/lore/search.mjs'
import { removeTestDirectory } from './temp.mjs'
import { needsOriginalEvidence } from '../modules/lore/index.mjs'

test('concrete canon techniques trigger evidence retrieval while casual Gu-word banter stays conversational', () => {
  assert.equal(needsOriginalEvidence('教我一道仙道杀招'), true)
  assert.equal(needsOriginalEvidence('讲讲本命蛊和仙蛊的区别'), true)
  assert.equal(needsOriginalEvidence('你的恩人到底是谁'), true)
  assert.equal(needsOriginalEvidence('你这是压力蛊吧哈哈'), false)
  assert.equal(needsOriginalEvidence('今天怎么说'), false)
})

test('legacy import retains scope/time, omits invalidated facts and is idempotent', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-import-')); t.after(() => removeTestDirectory(dir))
  const store = new SocialStore(join(dir, 'social.json'))
  const snapshot = { format: 'fangyuan-legacy-social-v1', interactions: [
    { scope: 'private:100001', uid: '100001', mid: 'old1', text: '我喜欢吃辣', answer: '我上次答过这个', created_at: 1700000000 },
    { scope: 'private:100001', uid: '100002', mid: 'wrong', text: '混入他人', created_at: 1700000001 },
    { scope: 'group:200001', uid: '100001', mid: 'retired', text: '叫我过时称呼', created_at: 1700000001 },
  ], facts: [
    { id: 'a', scope: 'private:100001', uid: '100001', source_mid: 'old1', content: '吃辣', slot: 'like:吃辣', active: 1, created_at: 1700000000 },
    { id: 'b', scope: 'group:200001', uid: '100001', source_mid: 'retired', content: '过时称呼', slot: 'address', active: 0, created_at: 1700000001 },
  ] }
  const r = importLegacy(store, snapshot)
  assert.equal(r.importedEvents, 2); assert.equal(r.importedFacts, 1); assert.equal(r.skippedEvents, 1)
  assert.equal(store.read().events[0].at, 1700000000000)
  assert.match(store.context('private:100001', { query: '吃辣' }), /historical_generated_answer_not_verified/)
  assert.doesNotMatch(store.context('group:200001', { people: ['100001'], query: '过时称呼' }), /过时称呼|我上次答过/)
  assert.equal(importLegacy(store, snapshot).importedEvents, 0)
  assert.equal(store.read().facts.length, 1)
})
test('new generated answers are recallable but never become verified facts or cross private boundaries', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-output-')); t.after(() => removeTestDirectory(dir))
  const store = new SocialStore(join(dir, 'social.json'))
  const e = store.observe({ chatId: 'private:100001', userId: '100001', messageId: 'x', text: '上次怎么说的' })
  store.recordOutput({ scope: e.scope, sourceIds: [e.id], text: '我曾回答的内容' })
  assert.match(store.context(e.scope, { query: '上次怎么说' }), /generated_not_verified/)
  assert.doesNotMatch(store.context('private:100002', { query: '上次怎么说' }), /我曾回答/)
  assert.equal(store.read().facts.length, 0)
})
test('lore search preserves reviewed facts, exact chapter metadata and a read-only original database', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-lore-')); t.after(() => removeTestDirectory(dir))
  const catalogPath = join(dir, 'cards.json'), originalDbPath = join(dir, 'book.sqlite3')
  writeFileSync(catalogPath, JSON.stringify({ version: 1, cards: [{ id: 'K-STAGE', keys: ['现在几转'], facts: '九转炼道尊者，未得永生', sources: ['W07'] }] }))
  const db = new DatabaseSync(originalDbPath)
  db.exec('CREATE TABLE chunks (id TEXT,sequence INTEGER,volume INTEGER,number_text TEXT,title TEXT,passage TEXT,source_label TEXT,heading_line INTEGER)')
  db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)').run('chapter-a', 1, 1, '第一章', '测试章', '这里是开窍蛊的原文片段', '用户原文', 8)
  db.prepare('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?)').run('chapter-b', 2, 1, '第二章', '测试索引', '白凝冰的测试索引条目，非原著事实', '测试数据', 12)
  db.close()
  const engine = new LoreSearch({ catalogPath, originalDbPath })
  assert.match(engine.search('现在几转')[0].text, /九转/)
  const result = engine.search('开窍蛊 原文')
  assert.equal(result[0].chapter, '第一章'); assert.match(result[0].kind, /not_automatically_personal/)
  assert.equal(engine.search('白凝冰 原文')[0].chapter, '第二章')
  assert.deepEqual(engine.search("' OR 1=1 --"), [])
  const read = new DatabaseSync(originalDbPath, { readOnly: true }); assert.equal(read.prepare('SELECT count(*) AS n FROM chunks').get().n, 2); read.close()
})
