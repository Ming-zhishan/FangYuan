import test from 'node:test'
import assert from 'node:assert/strict'
import { selectObservations } from '../modules/conversation/observations.mjs'
const lesson=(id,extra={})=>({id,text:id,scope:'portable',validated:true,kind:'strategy',sources:[{source:id,quote:'原始人物隐私或固定台词不应被转发',kind:'observed_archive'}],...extra})
test('relevant new positive experience reaches the prompt instead of being crowded out by old corrections',()=>{
 const old=Array.from({length:15},(_,i)=>lesson('old-'+i))
 const rows=selectObservations({lessons:[...old,lesson('shared-history',{polarity:'positive',keywords:['经历','记得']})]},{chatId:'private:100001',query:'你记得我们经历过什么吗',limit:3})
 assert.equal(rows[0].text,'shared-history');assert.equal(rows.length,3)
 assert.equal(rows[0].origin,'owner_archive_observation_not_shared_experience')
})
test('local meanings remain in their scene, irrelevant slang is not injected, and evidence is referenced without replaying raw people',()=>{
 const data={lessons:[lesson('other-private',{scope:'private:100002'}),lesson('slang',{kind:'lexicon',terms:['巨糖'],scope:'group:200001'}),lesson('portable',{polarity:'positive'})]}
 assert.deepEqual(selectObservations(data,{chatId:'private:100001',query:'你好'}).map(x=>x.text),['portable'])
 assert.equal(selectObservations(data,{chatId:'group:200001',query:'巨糖'} )[0].text,'slang')
 assert.doesNotMatch(JSON.stringify(selectObservations(data,{chatId:'private:100001',query:'你好'})),/原始人物隐私|固定台词/)
})
