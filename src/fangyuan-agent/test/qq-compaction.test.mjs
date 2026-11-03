import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateQqCompaction} from '../../../tools/dialogue-quality/scripts/validate-qq-compaction.mjs'
const patch=JSON.parse(readFileSync(new URL('../../../tools/dialogue-quality/qq-compaction-patch.json',import.meta.url)))
test('private overrides retain preset identity and inherited tools with a viable small-window budget',()=>{
  assert.equal(validateQqCompaction(patch).ok,true)
  const incomplete=patch.map(p=>({id:p.id,config:{plugins:p.config.plugins}}))
  assert.throws(()=>validateQqCompaction(incomplete),/Incomplete preset/)
  const oversized=structuredClone(patch)
  oversized[0].config.plugins.find(p=>p.id==='compaction').config.find(p=>p.id==='compaction-basic').config.maxTokens=65536
  assert.throws(()=>validateQqCompaction(oversized),/allowance/)
})
