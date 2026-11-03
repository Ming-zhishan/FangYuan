import test from 'node:test'
import assert from 'node:assert/strict'
import {adaptiveGroupPrompt,responseStylePolicy} from '../modules/conversation/response-style.mjs'
import {conversationReviewPrompt} from '../modules/conversation/index.mjs'
const old='把这一段当成整体来回：一般说一两句就好，回给最需要回的那个人或者整个话题，不要一条一条地挨个回。'
const tail='要 @ 某个人（对方会收到提醒），写 <at:QQ号>，QQ 号就是上面名字后面括号里的数字。'
test('only host-owned group length advice is replaced; user quotes, references and image are intact',()=>{
  const user=`【群聊 合成】刚才新说的（1 条）\n[1] 甲(100001)：我想讨论你这句“${old}”\n\n`
  const image={type:'image',data:'synthetic-only'}
  const input=[{type:'text',text:user+old+'\n大多数时候直接说就行。\n'+tail},image]
  const output=adaptiveGroupPrompt(input,{chat:{kind:'group'}})
  assert.ok(output[0].text.startsWith(user));assert.equal(output[1],image)
  assert.equal(output[0].text.split(old).length,2,'the user quotation remains unchanged')
  assert.ok(output[0].text.includes(responseStylePolicy));assert.ok(output[0].text.endsWith(tail))
  assert.equal(adaptiveGroupPrompt(input,{chat:{kind:'private'}}),input)
  const steering=[{type:'text',text:old}];assert.equal(adaptiveGroupPrompt(steering,{chat:{kind:'group'}}),steering)
})
test('review allows substantive expansion and short responses without numeric length quotas',()=>{
  const prompt=conversationReviewPrompt({userText:'前面几个问题都想听清楚',draft:'行'})
  assert.ok(prompt.includes(responseStylePolicy))
  assert.match(responseStylePolicy,/不为凑短而漏答/);assert.match(responseStylePolicy,/不.*刻意加长/)
})
