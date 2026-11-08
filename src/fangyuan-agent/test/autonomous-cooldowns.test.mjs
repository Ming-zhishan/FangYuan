import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { canAutonomouslyConsiderDiary } from '../modules/diary/diary-policy.mjs'
import { canAutonomouslyChangeSignature } from '../modules/profile/signature-policy.mjs'
import diary from '../modules/diary/index.mjs'
import profile from '../modules/profile/index.mjs'

const day = 24 * 60 * 60 * 1000, now = Date.UTC(2026, 10, 3, 12)
test('autonomous diary respects the fourteen-day boundary for considered, attempted and unknown outcomes', () => {
  for (const status of ['considered', 'attempted', 'sent', 'unknown']) {
    assert.equal(canAutonomouslyConsiderDiary([{ status, at: now - 13 * day }], now), false)
    assert.equal(canAutonomouslyConsiderDiary([{ status, at: now - 14 * day }], now), true)
  }
})
test('explicit publication requests do not consume the autonomous diary cooldown', () => {
  assert.equal(canAutonomouslyConsiderDiary([{ mode: 'request', status: 'sent', at: now }], now), true)
  assert.equal(canAutonomouslyConsiderDiary([{ mode: 'autonomous', status: 'sent', at: now }], now), false)
})
test('invalid diary intervals retain the default and supported overrides remain bounded', () => {
  const rows = [{ status: 'sent', at: now - 2 * day }]
  for (const gap of [undefined, 0, -1, 'invalid', Infinity]) assert.equal(canAutonomouslyConsiderDiary(rows, now, gap), false)
  assert.equal(canAutonomouslyConsiderDiary(rows, now, 1), true)
  assert.equal(canAutonomouslyConsiderDiary(null, now), true)
})
test('autonomous signature changes respect thirty days including unknown attempts', () => {
  for (const status of ['attempted', 'acknowledged', 'unknown']) {
    const row = { action: 'set_self_longnick', status, at: now - 29 * day }
    assert.equal(canAutonomouslyChangeSignature([row], now), false)
    assert.equal(canAutonomouslyChangeSignature([{ ...row, at: now - 30 * day }], now), true)
  }
})
test('signature cooldown does not block unrelated nickname or avatar records', () => {
  for (const action of ['set_qq_profile', 'set_qq_avatar']) assert.equal(canAutonomouslyChangeSignature([{ action, status: 'acknowledged', at: now }], now), true)
})
test('invalid signature intervals retain the default and shorter overrides have a one-day floor', () => {
  const row = { action: 'set_self_longnick', status: 'acknowledged', at: now - 2 * day }
  for (const gap of [undefined, 0, -1, 'invalid', Infinity]) assert.equal(canAutonomouslyChangeSignature([row], now, gap), false)
  assert.equal(canAutonomouslyChangeSignature([row], now, 1), true)
  assert.equal(canAutonomouslyChangeSignature([{ ...row, at: now - day / 2 }], now, 1), false)
})
function harness(t, nickname = false) {
  t.mock.method(Date, 'now', () => now)
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-cooldown-test-'))
  t.after(() => {
    const target = resolve(dir)
    assert.equal(dirname(target), resolve(tmpdir()))
    assert.ok(basename(target).startsWith('fangyuan-cooldown-test-'))
    rmSync(target, { recursive: true, force: true })
  })
  const data = { publications: [{ mode: 'autonomous', status: 'sent', at: now - day }], profileActions: [{ action: 'set_self_longnick', status: 'acknowledged', at: now - 10 * day }] }
  const calls = []
  const cfg = { enabled: true, dryRun: true, ownerQQ: '100001', diary: { enabled: true, timesPerDay: 2 }, profilePerms: {}, ext: { fangyuan: { publicActions: true }, profile: { autonomousSignature: true, autonomousNickname: nickname } } }
  const api = {
    config: () => cfg, dataDir: name => join(dir, name), use: id => id === 'memory' ? { store: { read: () => data, mutate: fn => fn(data) } } : null,
    core: { hub: { turnSendersAllOwner: () => true, runSystemTurn: async (...args) => { calls.push(args); return nickname ? '{"action":"none"}' : '{"accept":false,"reason":"合成拒绝"}' } }, onebot: { call: () => assert.fail('no gateway calls permitted') } },
    lib: key => key === 'modules/profile/index.js' ? { default: { setup() {} } } : { profilePermits: () => ({ ok: true }) },
    onebot: () => assert.fail('no publications permitted'), tool() {}, rule() {}, context() {}, every() {}, route() {}, log: { warn() {} }
  }
  return { api, calls }
}
test('actual diary entry blocks autonomous generation but still considers a permitted explicit request', async t => {
  const { api, calls } = harness(t), service = diary.setup(api)
  const blocked = await service.writeDiary()
  assert.equal(blocked.sent, false)
  assert.equal(calls.length, 0)
  await service.writeDiary({ topic: '合成提议' }, { sessionId: 'synthetic', chat: { kind: 'private', chatId: 'private:100001', userId: '100001' } })
  assert.equal(calls.length, 1)
})
test('actual profile scheduler does not generate a signature during the month cooldown', async t => {
  const { api, calls } = harness(t), service = profile.setup(api)
  await service.tick()
  assert.equal(calls.length, 0)
})
test('actual profile scheduler can still consider nickname changes while the signature is cooling down', async t => {
  const { api, calls } = harness(t, true), service = profile.setup(api)
  await service.tick()
  assert.equal(calls.length, 1)
  assert.match(calls[0][2], /本次可选动作\["none","nickname"\]/)
})
