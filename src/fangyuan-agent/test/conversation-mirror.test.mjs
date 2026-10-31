import test from 'node:test'
import assert from 'node:assert/strict'
import { currentBatch as baselineBatch } from '../modules/conversation/current-batch.mjs'
import { mustRespond as baselineMust } from '../modules/conversation/decision.mjs'
import { currentBatch as aurabotBatch } from '../../aurabot-modules/conversation/current-batch.mjs'
import { mustRespond as aurabotMust } from '../../aurabot-modules/conversation/decision.mjs'

test('both installable conversation copies agree on ambiguous and exact speaker decisions', () => {
  const cases = [
    { rows: [{id:'old',role:'user',uid:'111111',text:'在',direct:true},{id:'now',role:'user',uid:'222222',text:'你在吗',direct:false}], text:'你在吗' },
    { rows: [{id:'a',role:'user',uid:'111111',text:'难绷',direct:true},{id:'b',role:'user',uid:'222222',text:'难绷',direct:false}], text:'难绷' },
    { rows: [{id:'a',role:'user',uid:'111111',text:'不是哥们',direct:true},{id:'b',role:'user',uid:'222222',text:'你又乱搞',direct:false}], text:'不是哥们\n你又乱搞' }
  ]
  for (const {rows,text} of cases) {
    assert.deepEqual(aurabotBatch(rows,text),baselineBatch(rows,text))
    assert.equal(aurabotMust('group:333333',rows,text),baselineMust('group:333333',rows,text))
  }
})
