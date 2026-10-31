import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { conversationReviewPrompt } from '../modules/conversation/index.mjs'
import { applyReviewDecision } from '../modules/conversation/decision.mjs'

const examples = readFileSync(new URL('../modules/conversation/voice-examples.txt', import.meta.url), 'utf8')

test('review prompt carries a positive register standard, not only prohibitions', () => {
  const prompt = conversationReviewPrompt({ userText: '在吗', draft: '在。', scene: 'group', recent: [] })
  assert.match(prompt, /语域参照/)
  assert.match(prompt, /接住点/)
  assert.match(prompt, /只学结构，不照抄/)
  assert.match(prompt, /不把安静的普通回应硬改成俏皮话/)
})

test('register samples stay generic and cannot leak a real conversation', () => {
  assert.doesNotMatch(examples, /\d{5,12}/, '样例里不应出现QQ号或长数字')
  assert.doesNotMatch(examples, /https?:\/\//, '样例里不应出现链接')
  assert.match(examples, /不是台词库/)
})

test('review output contract is unchanged by the register samples', () => {
  const prompt = conversationReviewPrompt({ userText: '在吗', draft: '在。', scene: 'group', recent: [] })
  assert.match(prompt, /只输出JSON/)
  assert.match(prompt, /"change":true或false/)
})

test('splitting is opt-in and collapses back to one message when unverified', () => {
  const draft = '又改？第几版了。\n你那边有人顶着吗。'
  const off = conversationReviewPrompt({ userText: '项目又改需求', draft, scene: 'private', recent: [] })
  assert.match(off, /宿主不会把换行的消息切成多条/)
  assert.match(off, /并回一句/)
  assert.doesNotMatch(off, /换行就是分条发送/)

  const on = conversationReviewPrompt({ userText: '项目又改需求', draft, scene: 'private', recent: [], splitReplies: true })
  assert.match(on, /换行就是分条发送/)
  assert.match(on, /不要把几行并回一句/)
})

test('punctuation habit holds whether or not splitting is on', () => {
  for (const splitReplies of [false, true]) {
    const prompt = conversationReviewPrompt({ userText: '在吗', draft: '在。', scene: 'group', recent: [], splitReplies })
    assert.match(prompt, /句末句号可以去掉/)
    assert.match(prompt, /问号必须保留/)
  }
})

test('the decision layer never collapses a multi-line draft on its own', () => {
  const draft = '又改？第几版了。\n你那边有人顶着吗。'
  assert.equal(applyReviewDecision(draft, { change: false }, { direct: true }).text, draft)
  assert.equal(applyReviewDecision('单行', { change: true, text: draft }, { direct: true }).text, draft)
})