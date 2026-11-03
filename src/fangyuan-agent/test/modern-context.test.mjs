import test from 'node:test'
import assert from 'node:assert/strict'
import { modernContext } from '../modules/conversation/modern-context.mjs'
import { conversationReviewPrompt } from '../modules/conversation/index.mjs'

test('sugar guidance retains literal, affectionate and sarcastic meanings without declaring intent', () => {
  for (const input of ['给你买了糖', '这对CP又发糖了', '又装深沉了 🍬']) {
    const context = modernContext(input)
    assert.match(context, /甜食|字面/)
    assert.match(context, /嗑糖/)
    assert.match(context, /谐音/)
    assert.match(context, /不能看到糖就判定骂人/)
    assert.match(context, /证据不足时保留歧义/)
  }
  assert.equal(modernContext('今天吃饭了吗'), '')
})

test('review sees current and quoted contextual slang; no private lessons are exported', () => {
  assert.match(conversationReviewPrompt({userText:'🍬',draft:'糖很甜'}), /唐.*谐音/)
  assert.match(conversationReviewPrompt({userText:'这是什么意思',draft:'不知道',recent:[{text:'纳内'}]}), /纳尼/)
  assert.doesNotMatch(modernContext('🍬'), /impression|affinity|observedLessons/)
})
