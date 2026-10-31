import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePoke, pokeIdentity, registerPokeAttempt } from '../../aurabot-modules/poke-interaction/policy.mjs'

const T = 1793500000000
const raw = (user = '111111', group = '333333', time = T) => ({
  post_type: 'notice', notice_type: 'notify', sub_type: 'poke',
  user_id: user, group_id: group, target_id: '999999', time: Math.floor(time / 1000)
})
const args = (extra = {}) => ({ raw: raw(), botQQ: '999999', allowGroups: ['333333'],
  state: { version: 1, attempts: [] }, enabled: true, liveSend: true, now: T, ...extra })

test('only genuine bot-targeted and allowlisted group poke events are eligible', () => {
  assert.equal(pokeIdentity(raw(), { botQQ:'999999',allowGroups:['333333'] }).ok, true)
  assert.equal(pokeIdentity({ ...raw(), sub_type:'shake' }, { botQQ:'999999',allowGroups:['333333'] }).ok, false)
  assert.equal(pokeIdentity({ ...raw(), target_id:'222222' }, { botQQ:'999999',allowGroups:['333333'] }).ok, false)
  assert.equal(pokeIdentity(raw('999999'), { botQQ:'999999',allowGroups:['333333'] }).ok, false)
  assert.equal(pokeIdentity(raw('111111','444444'), { botQQ:'999999',allowGroups:['333333'] }).ok, false)
  assert.equal(pokeIdentity(raw(), { botQQ:'999999',allowGroups:[] }).ok, false)
  assert.equal(pokeIdentity({ ...raw(), group_id:undefined }, { botQQ:'999999',allowGroups:['333333'] }).ok, false)
})
test('both opt-ins are required and state corruption fails closed', () => {
  assert.equal(evaluatePoke(args({enabled:false})).reason,'approval_required')
  assert.equal(evaluatePoke(args({liveSend:false})).reason,'approval_required')
  assert.equal(evaluatePoke(args({state:{corrupt:true}})).reason,'state_unreadable')
  assert.equal(evaluatePoke(args()).ok,true)
})
test('serious discussion suppresses jokes; unrelated quoted keywords cannot trigger a response', () => {
  assert.equal(evaluatePoke(args({recent:[{at:T-1000,text:'有人受伤，正在等急救'}]})).reason,'sensitive_conversation')
  assert.equal(evaluatePoke(args({recent:[{at:T-700000,text:'有人受伤，正在等急救'}]})).ok,true)
  assert.equal(evaluatePoke(args({raw:{post_type:'message',message:'戳一戳',user_id:'111111'}})).ok,false)
})
test('stale QQ gateway notices cannot be replayed as fresh pokes', () => {
  assert.equal(evaluatePoke(args({raw:raw('111111','333333',T-300000)})).reason,'stale_event')
  assert.equal(evaluatePoke(args({raw:raw('111111','333333',T+300000)})).reason,'stale_event')
})
test('one group and one member observe cooldowns and a strict hourly cap', () => {
  const first=evaluatePoke(args())
  assert.equal(first.ok,true)
  const state1=registerPokeAttempt({version:1,attempts:[]},first,T)
  assert.equal(evaluatePoke(args({state:state1,now:T+60000,raw:raw('222222','333333',T+60000)})).reason,'group_cooldown')
  assert.equal(evaluatePoke(args({state:state1,now:T+1000000,raw:raw('111111','333333',T+1000000)})).reason,'member_cooldown')
  const second=evaluatePoke(args({state:state1,now:T+1000000,raw:raw('222222','333333',T+1000000)}))
  assert.equal(second.ok,true)
  const state2=registerPokeAttempt(state1,second,T+1000000)
  assert.equal(evaluatePoke(args({state:state2,now:T+2000000,raw:raw('555555','333333',T+2000000)})).reason,'hourly_group_cap')
  assert.equal(evaluatePoke(args({state:state2,now:T+3700000,raw:raw('555555','333333',T+3700000)})).ok,true)
})
test('familiarity changes only optional short wording; no copied novel quotes or forced threats', () => {
  const ordinary=evaluatePoke(args()), friend=evaluatePoke(args({isFamiliar:true}))
  assert.equal(ordinary.kind,'neutral')
  assert.equal(friend.kind,'familiar')
  assert.notEqual(ordinary.text,friend.text)
  assert.ok(ordinary.text.length<=10 && friend.text.length<=10)
})
test('attempt state records before sending and prunes expired entries', () => {
  const decision=evaluatePoke(args())
  const state=registerPokeAttempt({attempts:[{chatId:'group:333333',sender:'000001',at:T-90000000}]},decision,T)
  assert.equal(state.attempts.length,1)
  assert.equal(state.attempts[0].status,'attempted')
  assert.throws(()=>registerPokeAttempt({}, {ok:false}),/Invalid/)
})
