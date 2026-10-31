import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import guard from '../modules/live-guard/index.mjs'
import fangyuan from '../modules/fangyuan/index.mjs'
import { SocialStore } from '../modules/memory/store.mjs'
import { removeTestDirectory } from './temp.mjs'
const A = '10000001', B = '10000003', BOT = '20000002'
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-live-'));t.after(() => removeTestDirectory(dir))
  const file = join(dir, 'mode.json');writeFileSync(file, '{"mode":"disabled"}')
  const cfg = { enabled: true, dryRun: false, ownerQQ: A, botQQ: BOT, allow: { private: [], groups: ['20000004'] }, ext: { liveGuard: { enforce: true, legacyModePath: file, ownerOutbound: true } } }
  const store = new SocialStore(join(dir, 'social.json')), listeners = [], builders = [], sends = []
  let rows = [{ user_id: A }, { user_id: B }], account = BOT, receipt = { message_id: 'ack-1' }, groups = [{ group_id: '20000004', group_name: '测试群' }]
  const service = guard.setup({ config: () => cfg, setConfig: (patch) => { if (patch.allow) Object.assign(cfg.allow, patch.allow); if (patch.ext?.liveGuard) Object.assign(cfg.ext.liveGuard, patch.ext.liveGuard) },
    on: (event, fn) => listeners.push({ event, fn }), every() {}, later() {}, route() {}, log: { warn() {} },
    tool: (fn) => builders.push(fn), defineTool: (x) => x, use: () => ({ store }),
    core: { onebot: { call: async (action) => action === 'get_login_info' ? { user_id: account } : action === 'get_group_list' ? groups : rows }, hub: { turnSendersAllOwner: () => true } },
    sendSegments: async (target, message) => { sends.push({ target, message }); return receipt },
  })
  return { cfg, store, service, listeners, sends, file, rows: (x) => { rows = x }, account: (x) => { account = x }, receipt: (x) => { receipt = x }, tools: (who = { kind: 'private', chatId: 'private:' + A, userId: A }) => builders.flatMap((f) => f({ chat: who, sessionId: 'test' })) }
}
test('live guard admits only verified friends and stops if the old channel is reopened', async (t) => {
  const h = setup(t);await h.service.refresh()
  assert.equal(h.service.ready(), true);assert.equal(h.service.permitted('private:' + B), true)
  assert.equal(h.service.permitted('private:19999999'), false)
  writeFileSync(h.file, '{"mode":"both"}');assert.equal(h.service.ready(), false)
})
test('account mismatch and revoked friendship stop admission without granting by affinity', async (t) => {
  const h = setup(t);await h.service.refresh();h.rows([{ user_id: A }]);await h.service.refresh()
  assert.equal(h.service.permitted('private:' + B), false)
  h.account('29999999');await h.service.refresh();assert.equal(h.service.ready(), false)
})
test('PowerShell UTF8 BOM in the legacy mode file does not stop valid startup', async (t) => {
  const h = setup(t);writeFileSync(h.file, '\uFEFF{"mode":"disabled"}');await h.service.refresh()
  assert.equal(h.service.ready(), true)
})

test('a genuine temporary inbound is admitted before the hub allow check without granting cold outbound access', async (t) => {
  const h = setup(t); h.cfg.ext.liveGuard.temporaryPrivate = true; await h.service.refresh()
  const stranger = '10000009', event = h.listeners.find((r) => r.event === 'onebot')?.fn
  assert.equal(typeof event, 'function')
  assert.equal(h.service.permitted('private:' + stranger), false)
  event({ post_type: 'message', message_type: 'private', sub_type: 'group', self_id: BOT, user_id: stranger, message_id: 'temp-real' })
  assert.equal(h.cfg.allow.private.includes(stranger), true)
  assert.equal(h.service.permitted('private:' + stranger), true)
  await h.service.refresh(); assert.equal(h.cfg.allow.private.includes(stranger), true)
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: 'owner1', text: '给他发消息' })
  assert.equal((await h.tools().find((x) => x.name === 'fy_send_private_message').execute({ userId: stranger, text: '不能主动骚扰临时联系人' })).sent, false)
  event({ post_type: 'message', message_type: 'private', self_id: '29999999', user_id: '10000008' })
  assert.equal(h.cfg.allow.private.includes('10000008'), false)
})
test('revoking directed-send permission invalidates an already built tool', async (t) => {
  const h = setup(t);await h.service.refresh()
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: '1', text: '给10000003发一句你好' })
  const tool = h.tools().find((x) => x.name === 'fy_send_private_message')
  h.cfg.ext.liveGuard.ownerOutbound = false
  assert.equal((await tool.execute({ userId: B, text: '你好' })).sent, false)
  assert.equal(h.sends.length, 0)
})
test('directed private sends require actual receipt and deduplicate the same source and target', async (t) => {
  const h = setup(t);await h.service.refresh()
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: '1', text: '给10000003发一句你好' })
  const tool = h.tools().find((x) => x.name === 'fy_send_private_message')
  assert.equal((await tool.execute({ userId: B, text: '你好' })).sent, true)
  assert.equal((await tool.execute({ userId: B, text: '换个参数试试' })).sent, false)
  assert.equal(h.sends.length, 1)
})
test('lost directed-send receipt becomes durable unknown and never repeats', async (t) => {
  const h = setup(t);await h.service.refresh();h.receipt({})
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: '1', text: '给10000003发一句你好' })
  const tool = h.tools().find((x) => x.name === 'fy_send_private_message')
  assert.equal((await tool.execute({ userId: B, text: '你好' })).unknown, true)
  await tool.execute({ userId: B, text: '你好' });assert.equal(h.sends.length, 1)
  assert.equal(h.store.read().directMessages[0].status, 'unknown')
})

test('social-level owner can inspect real group membership and send only to a verified enabled group with a receipt', async (t) => {
  const h = setup(t); h.cfg.ownerLevel = 'social'; h.cfg.ext.liveGuard.ownerGroupOutbound = true; await h.service.refresh()
  const tools = h.tools(), caps = await tools.find((x) => x.name === 'fy_capabilities').execute()
  assert.equal(caps.capabilities.directedGroupMessage.enabled, true)
  assert.equal(caps.capabilities.qzone.enabled, false)
  const groups = await tools.find((x) => x.name === 'fy_group_directory').execute()
  assert.equal(groups.groups[0].groupId, '20000004'); assert.equal(groups.groups[0].enabled, true)
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: 'g1', text: '去测试群说你好' })
  const send = tools.find((x) => x.name === 'fy_send_group_message')
  assert.equal((await send.execute({ groupId: '20000004', text: '你好' })).sent, true)
  assert.equal(h.sends[0].target, 'group:20000004')
  assert.equal((await send.execute({ groupId: '20000004', text: '换文字也不能重复' })).sent, false)
  assert.equal((await send.execute({ groupId: '29999999', text: '未授权群' })).sent, false)
  assert.equal(h.sends.length, 1)
})

test('unknown group delivery is persisted and never retried even after changed wording', async (t) => {
  const h = setup(t); h.cfg.ext.liveGuard.ownerGroupOutbound = true; await h.service.refresh(); h.receipt({})
  h.store.observe({ chatId: 'private:' + A, userId: A, messageId: 'g2', text: '去测试群打招呼' })
  const send = h.tools().find((x) => x.name === 'fy_send_group_message')
  assert.equal((await send.execute({ groupId: '20000004', text: '你好' })).unknown, true)
  await send.execute({ groupId: '20000004', text: '再试一次' })
  assert.equal(h.sends.length, 1); assert.equal(h.store.read().directMessages[0].status, 'unknown')
})
test('open social capabilities tell admitted non-owners the same truth as the tool permissions', async (t) => {
  const h = setup(t); await h.service.refresh()
  h.cfg.profilePerms = { qqNickname: 'all', qqSignature: 'all', qqAvatar: 'all', qqFriendRequest: 'all' }
  h.cfg.ext.fangyuan = { publicActions: true, publicRequestsFromAll: true }
  h.cfg.diary = { enabled: true }
  const { capabilities: caps } = await h.tools({ kind: 'private', chatId: 'private:' + B, userId: B }).find((x) => x.name === 'fy_capabilities').execute()
  assert.equal(caps.qzone.enabled, true)
  assert.equal(caps.qzone.tool, 'qq_send_qzone')
  assert.ok(Object.values(caps.profileWriteEnabled).every(Boolean))
  assert.equal(caps.directedGroupMessage.enabled, false)
})

test('captured false add and third-party-send statements are corrected without pretending execution', () => {
  const listeners = [], cfg = { ownerQQ: A, ext: { liveGuard: { enforce: true } } }
  const events = [{ scope: 'private:' + A, text: '你去加这个好友', id: 'source1' }, { scope: 'private:' + A, text: '去和他聊天', id: 'source2' }]
  fangyuan.setup({ on: (event, fn) => listeners.push({ event, fn }), rule() {}, route() {}, config: () => cfg, use: () => ({ store: { read: () => ({ events, directMessages: [] }) } }) })
  const reply = listeners.find((x) => x.event === 'reply').fn
  assert.match(reply('加了，等通过。', { chatId: 'private:' + A, userText: '你去加这个好友' }), /没有实际/)
  assert.match(reply('嗯，等他回。', { chatId: 'private:' + A, userText: '去和他聊天' }), /还没确认/)
  assert.equal(reply('可以这样说：你好。', { chatId: 'private:' + A, userText: '去和他聊天' }), '可以这样说：你好。')
})
