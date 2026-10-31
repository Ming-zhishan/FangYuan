import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import profile from '../modules/profile/index.mjs'
import { SocialStore } from '../modules/memory/store.mjs'
import { removeTestDirectory } from '../test/temp.mjs'

const root = process.env.AURABOT_SOURCE_ROOT
if (!root) throw new Error('Set AURABOT_SOURCE_ROOT to the verified Aurabot source')
const native = await import(pathToFileURL(join(root, 'src/modules/profile/index.js')))
const access = await import(pathToFileURL(join(root, 'src/chat/access.js')))
const { normalize } = await import(pathToFileURL(join(root, 'src/core/config.js')))
const A = '10000001', B = '10000003', chat = { kind: 'private', chatId: 'private:' + A, userId: A }
function harness(t) {
  const dir = mkdtempSync(join(tmpdir(), 'fangyuan-profile-')); t.after(() => removeTestDirectory(dir))
  const store = new SocialStore(join(dir, 'memory.json')), calls = [], prompts = [], builders = [], disposers = []
  let cfg = normalize({ enabled: true, dryRun: false, botQQ: '20000002', ownerQQ: A }), reply = '{"action":"none"}', callError = false, duringThink = () => {}
  const api = {
    lib: (key) => key === 'modules/profile/index.js' ? native : key === 'chat/access.js' ? access : assert.fail(key),
    config: () => cfg, use: () => ({ store }), dsh: {}, onDispose: (fn) => disposers.push(fn),
    dataDir: (...parts) => join(dir, ...parts),
    rule() {}, every() {}, route() {}, tool: (fn) => builders.push(fn), log: { warn() {} },
    core: { hub: { chatOfSession: () => chat.chatId, turnSendersAllOwner: () => true, async runSystemTurn(_id, _name, prompt, options) { prompts.push({ prompt, options }); duringThink(); return reply } },
      onebot: { async call(action, params, options) { calls.push({ action, params, options }); if (callError) throw new Error('timeout'); return null } } },
  }
  const service = profile.setup(api)
  t.after(() => disposers.forEach((fn) => fn()))
  return { store, calls, prompts, service, cfg: () => cfg, set: (patch) => { cfg = normalize({ ...cfg, ...patch }) },
    reply: (text) => { reply = text }, fail: () => { callError = true }, duringThink: (fn) => { duringThink = fn },
    tools: (who = chat) => Object.fromEntries(builders.flatMap((fn) => fn({ chat: who, sessionId: 's1' })).map((tool) => [tool.name, tool])),
  }
}
test('actual native profile permissions remain effective regardless of relationship', async (t) => {
  const h = harness(t)
  assert.ok(h.tools().qq_set_signature)
  assert.equal(h.tools({ ...chat, userId: B }).qq_set_signature, undefined)
  const tool = h.tools().qq_set_signature
  h.set({ profilePerms: { qqSignature: 'off' } })
  assert.equal((await tool.execute({ text: '有交情也不能越权' })).ok, false)
  assert.equal(h.calls.length, 0)
})
test('native success with null data is a valid gateway acknowledgement, repeated same write is blocked', async (t) => {
  const h = harness(t), tool = h.tools().qq_set_signature
  const r = await tool.execute({ text: '路还长。' })
  assert.equal(r.ok, true); assert.match(r.message, /网关.*回执/)
  assert.equal(h.calls[0].options.retries, 0)
  assert.equal((await tool.execute({ text: '路还长。' })).ok, false)
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.read().profileActions.at(-1).status, 'acknowledged')
})
test('unknown native writes persist and block changed parameters instead of blindly retrying', async (t) => {
  const h = harness(t); h.fail()
  assert.equal((await h.tools().qq_set_signature.execute({ text: '第一次' })).ok, false)
  assert.equal((await h.tools().qq_set_signature.execute({ text: '换个参数再试' })).ok, false)
  assert.equal(h.calls.length, 1)
  assert.equal(new SocialStore(h.store.file).read().profileActions.at(-1).status, 'unknown')
})
test('autonomous profile changes require their own grant and can decline without reading private chats', async (t) => {
  const h = harness(t)
  h.store.observe({ chatId: chat.chatId, userId: A, messageId: 'secret', text: '记住：私事金丝雀' })
  await h.service.tick(); assert.equal(h.prompts.length, 0)
  h.set({ ext: { profile: { autonomousSignature: true } } })
  await h.service.tick()
  assert.equal(h.prompts.length, 1); assert.equal(h.calls.length, 0)
  assert.doesNotMatch(h.prompts[0].prompt, /金丝雀/)
  assert.equal(h.prompts[0].options.noTools, true)
})
test('autonomous signature ticks respect the decision interval instead of immediately repeating', async (t) => {
  const h = harness(t)
  h.set({ ext: { profile: { autonomousSignature: true } } }); h.reply('{"action":"signature","text":"一步一步走下去。"}')
  await h.service.tick(); await h.service.tick()
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].action, 'set_self_longnick')
  assert.equal(h.store.read().profileActions.at(-1).status, 'acknowledged')
})

test('an acknowledged requested avatar becomes available for later autonomous choices', async (t) => {
  const h = harness(t)
  assert.equal(h.service.publicAvatars().length, 0)
  const result = await h.tools().qq_set_avatar.execute({ image: 'https://example.com/chosen.png' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(h.service.publicAvatars().length, 1)
  assert.equal(h.service.publicAvatars()[0].title, '已使用的公开头像')
})
test('permission changes during autonomous thought prevent an operation', async (t) => {
  const h = harness(t)
  h.set({ ext: { profile: { autonomousSignature: true } } }); h.reply('{"action":"signature","text":"不该执行"}')
  h.duringThink(() => h.set({ profilePerms: { qqSignature: 'off' } }))
  await h.service.tick(); assert.equal(h.calls.length, 0)
})
test('dry-run autonomous writes do not reach the gateway', async (t) => {
  const h = harness(t)
  h.set({ dryRun: true, ext: { profile: { autonomousSignature: true } } }); h.reply('{"action":"signature","text":"只是草稿"}')
  await h.service.tick(); assert.equal(h.calls.length, 0)
  assert.equal(h.store.read().profileActions.at(-1).status, 'simulated')
})
test('autonomous avatars select only a configured public asset, never a model supplied address', async (t) => {
  const h = harness(t)
  h.set({ ext: { profile: { autonomousAvatar: true, publicAvatars: [{ id: 'approved', title: '公开素材', url: 'https://example.com/approved.png' }] } } })
  h.reply('{"action":"avatar","assetId":"unknown","url":"https://example.com/injected.png"}')
  await h.service.tick(); assert.equal(h.calls.length, 0)
})
test('a granted autonomous avatar uses the approved asset and a gateway acknowledgement', async (t) => {
  const h = harness(t)
  h.set({ ext: { profile: { autonomousAvatar: true, publicAvatars: [{ id: 'approved', title: '公开素材', url: 'https://example.com/approved.png' }] } } })
  h.reply('{"action":"avatar","assetId":"approved","url":"https://example.com/ignored.png"}')
  await h.service.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].action, 'set_qq_avatar')
  assert.equal(h.calls[0].params.file, 'https://example.com/approved.png')
  assert.equal(h.store.read().profileActions.at(-1).status, 'acknowledged')
})

test('autonomous nickname grant is an actual available action', async (t) => {
  const h = harness(t)
  h.set({ ext: { profile: { autonomousNickname: true } } }); h.reply('{"action":"nickname","text":"古月方源"}')
  await h.service.tick()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].action, 'set_qq_profile'); assert.equal(h.calls[0].params.nickname, '古月方源')
})

test('open profile permissions expose real nickname signature avatar tools to friends and groups', async (t) => {
  const h = harness(t); h.set({ profilePerms: { qqNickname: 'all', qqSignature: 'all', qqAvatar: 'all' } })
  for (const who of [{ ...chat, userId: B }, { kind: 'group', chatId: 'group:20000004', groupId: '20000004', userId: B }]) {
    const tools = h.tools(who)
    for (const name of ['qq_set_nickname', 'qq_set_signature', 'qq_set_avatar']) assert.ok(tools[name])
  }
  assert.equal((await h.tools({ ...chat, userId: B }).qq_set_nickname.execute({ name: '方源' })).ok, true)
})
