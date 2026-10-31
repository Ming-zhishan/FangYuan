import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheMatchesCurrentTurn as baselineMatch, cachedLoreForTurn as baselineRead } from '../modules/lore/index.mjs'
import { cacheMatchesCurrentTurn as aurabotMatch, cachedLoreForTurn as aurabotRead } from '../../aurabot-modules/lore/index.mjs'

test('old lore query does not carry forward just because a new sentence contains the same substring', () => {
  assert.equal(baselineMatch('想问春秋蝉的原理', '春秋蝉'), false)
  assert.equal(baselineMatch('春秋蝉', '春秋蝉'), true)
  assert.equal(baselineMatch('春秋蝉\n那一战怎么回事', '春秋蝉'), true)
  assert.equal(baselineMatch('这不是哥们蛊吧', '蛊'), false)
  assert.equal(baselineMatch('> 春秋蝉\n我问的是别的事情', '春秋蝉'), false)
  assert.equal(baselineMatch('```\n春秋蝉\n```\n我想聊生活', '春秋蝉'), false)
  assert.equal(baselineMatch('引用：春秋蝉\n今天的天气', '春秋蝉'), false)
})
test('cached original-evidence data is usable only for exact current turns inside the TTL', () => {
  const now=1000000, entry={query:'春秋蝉',items:[{id:'example',kind:'reviewed_anchor'}],at:now-10000}
  assert.equal(baselineRead(entry,'春秋蝉',now).length,1)
  assert.equal(baselineRead(entry,'别的春秋蝉问题',now).length,0)
  assert.equal(baselineRead(entry,'>春秋蝉\n说点别的',now).length,0)
  assert.equal(baselineRead(entry,'春秋蝉',now+120000).length,0)
  assert.equal(baselineRead({...entry,at:now+1},'春秋蝉',now).length,0)
  assert.deepEqual(baselineRead({...entry,items:null},'春秋蝉',now),[])
})
test('standalone Aurabot module and baseline cannot drift in citation cache behavior', () => {
  for(const [current, prior] of [['春秋蝉','春秋蝉'],['春秋蝉怎么使用','春秋蝉'],['> 春秋蝉\n你在吗','春秋蝉']]){
    assert.equal(aurabotMatch(current,prior),baselineMatch(current,prior))
  }
  assert.deepEqual(aurabotRead({query:'仙蛊',items:['x'],at:100},'仙蛊',101),
    baselineRead({query:'仙蛊',items:['x'],at:100},'仙蛊',101))
})
