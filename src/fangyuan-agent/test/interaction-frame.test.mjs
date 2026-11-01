import test from 'node:test'
import assert from 'node:assert/strict'
import { interactionFrame } from '../modules/conversation/interaction-frame.mjs'
import { turnInputs } from '../modules/conversation/turn-input.mjs'

test('a close owner preference is explicit and confined to the verified private route', () => {
  const cfg = { ownerQQ: '100001', ext: { conversation: { ownerBond: 'close_companion' } } }
  assert.equal(interactionFrame(cfg, 'private:100001').kind, 'close_companion')
  for (const scope of ['group:100001', 'private:100002', 'private:100001-spoof']) assert.equal(interactionFrame(cfg, scope), null)
  assert.equal(interactionFrame({ ownerQQ: '100001' }, 'private:100001'), null)
  assert.equal(interactionFrame({ ...cfg, ownerQQ: '' }, 'private:'), null)
  assert.deepEqual(cfg.ext.conversation, { ownerBond: 'close_companion' })
  const publicTrial = interactionFrame({ ...cfg, ext: { conversation: { affectTrial: true } } }, 'group:100002')
  assert.deepEqual(publicTrial, { kind: 'affect_trial', source: 'explicit_configuration' })
  assert.equal(Object.hasOwn(publicTrial, 'guidance'), false)
})

test('expired or consumed inputs cannot become another turn, and scopes never mix', () => {
  let now = 0
  const tracker = turnInputs({ clock: () => now, ttlMs: 100 })
  const capture = (scope, text, steer = false) => tracker.capture([], { chat: { chatId: scope }, queryText: text, steer })
  capture('private:100001', '第一问')
  capture('private:100002', '别人的话')
  capture('private:100001', '第二问', true)
  assert.equal(tracker.take('private:100001'), '第一问\n第二问')
  assert.equal(tracker.text('private:100001', '新话'), '新话')
  assert.equal(tracker.text('private:100002'), '别人的话')
  now = 101
  capture('private:100002', '迟来的插话', true)
  assert.equal(tracker.text('private:100002'), '迟来的插话')
})
