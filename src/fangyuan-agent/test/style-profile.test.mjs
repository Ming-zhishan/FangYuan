import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LearningStore } from '../modules/learning/store.mjs'
import { removeTestDirectory } from './temp.mjs'

const UID = '100001'
const SCOPE = `private:${UID}`

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-style-'))
  let now = Date.parse('2026-10-29T12:00:00+08:00')
  const store = new LearningStore(join(dir, 'learning.sqlite3'), { clock: () => now })
  t.after(() => { store.close(); removeTestDirectory(dir) })
  return {
    store,
    advance: (ms) => { now += ms },
    say: (text, gap = 4000) => { now += gap; return store.observe({ scope: SCOPE, uid: UID, mid: text, text }) },
  }
}

function seed(env) {
  env.say('在吗', 0); env.say('睡了没'); env.say('刚看完一集')
  env.say('今天上班被骂了。', 90000); env.say('烦'); env.say('你说我是不是太软了？')
  env.say('算了', 190000); env.say('不说了'); env.say('明天再说吧')
  env.say('哈哈哈哈哈', 290000); env.say('行，听你的'); env.say('那我睡了')
}

test('speaking register counts length, split rhythm and punctuation', (t) => {
  const env = fixture(t); seed(env)
  const p = env.store.styleProfile(UID, SCOPE)
  assert.equal(p.samples, 12)
  assert.equal(p.runMean, 3, '四组 15 秒内连发，每组三条')
  assert.equal(p.multiRunRate, 1)
  assert.ok(p.periodRate > 0 && p.periodRate < 0.5, '只有一条用句号')
  assert.ok(p.questionRate > 0, '问号要被数出来')
  assert.ok(p.shortRate >= 0.5, '多数是短句')
  assert.ok(Number.isInteger(p.avgChars) && p.avgChars > 0)
  assert.ok(p.fillerRate > 0, '语气词习惯要被数出来')
})

test('too few messages yields no register rather than a guess', (t) => {
  const env = fixture(t)
  env.say('在吗'); env.say('嗯'); env.say('好')
  assert.equal(env.store.styleProfile(UID, SCOPE), null)
})

test('context carries the register and the verbatim style sample together', (t) => {
  const env = fixture(t); seed(env)
  const source = env.store.styleProfile(UID, SCOPE) && env.store.db
    .prepare("SELECT id FROM messages WHERE scope=? AND text='今天上班被骂了。'").get(SCOPE)

  env.store.learn({ source: source.id, scope: SCOPE, uid: UID, quote: '今天上班被骂了。', kind: 'style', text: '先接情绪再问细节，别急着讲道理' })

  const context = env.store.context(SCOPE, [UID], '')
  assert.match(context, /speakingRegister/)
  assert.match(context, /"sample":"今天上班被骂了。"/, 'style 条目必须带上原话，形容词单独给不出语域')
  assert.match(context, /只借节奏，不借措辞/)
})