import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = process.env.AURABOT_SOURCE_ROOT
if (!root) throw new Error('Set AURABOT_SOURCE_ROOT to the verified upstream source, not a running instance')
const B = '20000002', A = '10000001', OTHER = '10000003', G = '20000004'
const { createFakeDsh } = await import(pathToFileURL(join(root, 'test/helpers/fake-dsh.js')))
const { startMockOneBot } = await import(pathToFileURL(join(root, 'test/helpers/mock-onebot.js')))
const until = async (fn) => { const stop = Date.now() + 10000; while (Date.now() < stop) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)) } throw new Error('Expected actual upstream pipeline condition was not reached') }

test('actual Aurabot loads all Fang Yuan modules and passes scoped messages through the real hub', async () => {
  const base = resolve('../../tools/dialogue-quality/private/upstream-runtime-tests'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'actual-aurabot-'))
  process.env.AURABOT_DATA_DIR = dir; process.env.DSH_HOME = join(dir, 'home'); process.env.AURABOT_WORKSPACE = join(dir, 'workspace')
  const gateway = await startMockOneBot({ selfId: B })
  cpSync(resolve('modules'), join(dir, 'modules'), { recursive: true })
  mkdirSync(join(dir, 'personas'), { recursive: true })
  writeFileSync(join(dir, 'personas/gu-yue-fang-yuan.md'), '---\nname: 古月方源\n---\n你是古月方源，九转炼道尊者。')
  const patch = JSON.parse(readFileSync(resolve('config.patch.json'), 'utf8'))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...patch, enabled: true, dryRun: false, setupDone: true, botQQ: B, ownerQQ: A,
    allow: { private: [A, OTHER], groups: [G] }, gateway: 'onebot',
    group: { ...patch.group, interjectChance: 0 }, merge: { waitSec: 0.1, maxSec: 1, groupWaitSec: 0.1, groupMaxSec: 1 },
    snowluma: { autoStart: false, autoAttach: false, httpUrl: gateway.httpUrl, wsUrl: gateway.wsUrl, httpToken: gateway.token, wsToken: gateway.token },
    voice: { enabled: false, autoChance: 0 }, stickers: { enabled: false, collect: false, autoChance: 0 },
    modules: { ...patch.modules, stickers: { enabled: true, useBuiltin: false }, contacts: { enabled: true, useBuiltin: true } },
    ext: { fangyuan: { ...patch.ext.fangyuan, specialFriendQQ: '' }, learning: { enabled: true, modelEnabled: false }, stickers: { requestsFromAll: true } },
  }))
  const fake = createFakeDsh({ brain: async ({ ctxText, text }) => text.includes('你是发送前的交流复核') ? '{"change":true,"text":"自然接话复核通过","reason":"语义复核"}' : text.includes('群聊隐私检查') ? (ctxText.includes('金丝雀') ? 'LEAK' : '群聊隔离正确') : '已接住这句' })
  const previousFetch=globalThis.fetch, previousToken=process.env.FY_PRODUCTION_TOKEN, reviewRequests=[]
  process.env.FY_PRODUCTION_TOKEN='integration-only-not-a-real-credential'
  globalThis.fetch=async (url, options)=>{
    if (String(url)==='http://127.0.0.1:11435/health') return Response.json({provider:'tongji',model:'DeepSeek-V4.1-Flash',cash_allowed:false})
    if (String(url)==='http://127.0.0.1:11435/v1/chat/completions') {
      const request=JSON.parse(options.body);reviewRequests.push(request)
      return Response.json({model:'DeepSeek-V4.1-Flash',choices:[{message:{content:'{"change":true,"text":"自然接话复核通过","reason":"语义复核"}'}}],usage:{prompt_tokens:10,completion_tokens:10}})
    }
    return previousFetch(url,options)
  }
  let host
  try {
    const { apply } = await import(pathToFileURL(join(root, 'src/host.js')))
    host = apply(fake.ctx); await host.ready
    const status = (await fake.call('/modules')).json().list
    for (const id of ['fangyuan', 'memory', 'mood', 'speakup', 'diary', 'profile', 'lore', 'live-guard', 'learning']) {
      const mod = status.find((m) => m.id === id)
      assert.equal(mod.running, 'user', JSON.stringify(mod))
      assert.ok(!mod.error, JSON.stringify(mod))
    }
    await fake.call('/onebot/reconnect'); await until(() => gateway.connected() > 0)
    gateway.push({ message_type: 'private', sub_type: 'friend', user_id: Number(A), message_id: 101, sender: { user_id: Number(A), nickname: '同名用户' }, message: [{ type: 'text', data: { text: '记住：私事金丝雀' } }] })
    await until(() => fake.turns.length >= 1)
    assert.match(fake.turns[0].ctxText, /金丝雀/)
    const privateAgent = [...fake.agents.values()].find((a) => a.preset === 'aurabot-private')
    assert.ok(privateAgent.tools.has('remember')); assert.ok(privateAgent.tools.has('fy_update_relationship'))
    gateway.push({ message_type: 'group', group_id: Number(G), user_id: Number(A), message_id: 102, sender: { user_id: Number(A), nickname: '同名用户' }, message: [{ type: 'at', data: { qq: B } }, { type: 'text', data: { text: '群聊隐私检查' } }] })
    await until(() => fake.turns.length >= 2)
    assert.equal(fake.turns[1].reply, '群聊隔离正确')
    assert.doesNotMatch(fake.turns[1].ctxText, /金丝雀/)
    const rules = fake.variables.get('aurabot_rules_private')()
    assert.doesNotMatch(rules, /大肥鱼|主人|说明在忙/)
    assert.match(rules, /古月方源/)
    assert.equal((await fake.call('/profiles')).json().ok, true)
    const archive = (await fake.call('/ext/learning/state')).json()
    assert.equal(archive.enabled, true)
    assert.ok(archive.messages >= 2, JSON.stringify(archive))
    assert.ok(archive.items >= 1, JSON.stringify(archive))
    assert.ok(privateAgent.tools.has('fy_note_term')); assert.ok(privateAgent.tools.has('fy_adjust_affinity'))
    assert.ok(gateway.calls.some((c) => c.action === 'send_private_msg'))
    const legacyMode = join(dir, 'legacy-mode.json'); writeFileSync(legacyMode, '{"mode":"disabled"}')
    const originalCall = host.onebot.call
    host.onebot.call = async function (action, ...args) { return action === 'get_friend_list' ? [{ user_id: A }, { user_id: OTHER }] : originalCall.call(this, action, ...args) }
    const current = host.getConfig()
    host.setConfig({ ...current, ext: { ...current.ext, liveGuard: { enforce: true, temporaryPrivate: true, ownerGroupOutbound: true, legacyModePath: legacyMode } } })
    assert.equal((await fake.call('/ext/live-guard/refresh')).json().ok, true)
    const temporary = '10000009'
    assert.equal(host.getConfig().allow.private.includes(temporary), false)
    gateway.push({ message_type: 'private', sub_type: 'group', group_id: Number(G), user_id: Number(temporary), message_id: 103, sender: { user_id: Number(temporary), nickname: '临时来访者' }, message: [{ type: 'text', data: { text: '临时窗口正常聊天' } }] })
    await until(() => fake.turns.length >= 3)
    assert.equal(host.getConfig().allow.private.includes(temporary), true)
    assert.doesNotMatch(fake.turns[2].ctxText, /金丝雀/)
    await until(() => gateway.calls.some((c) => c.action === 'send_private_msg' && String(c.params.user_id) === temporary))
    const learningDb = new DatabaseSync(join(dir, 'modules-data/learning/learning.sqlite3'), { readOnly: true })
    try {
      assert.equal(learningDb.prepare('SELECT value FROM affinity WHERE uid=?').get(A).value, 10)
      assert.equal(learningDb.prepare('SELECT value FROM affinity WHERE uid=?').get(temporary).value, 0)
    } finally { learningDb.close() }
    const freshGroup = '20000005', latest = host.getConfig()
    host.setConfig({ ...latest, allow: { ...latest.allow, groups: [...latest.allow.groups, freshGroup] } })
    gateway.push({ message_type: 'group', group_id: Number(freshGroup), user_id: Number(A), message_id: 104, sender: { user_id: Number(A), nickname: '单独艾特者' }, message: [{ type: 'at', data: { qq: B } }, { type: 'text', data: { text: ' ' } }] })
    await until(() => fake.turns.length >= 4)
    await until(() => gateway.calls.some((c) => c.action === 'send_group_msg' && String(c.params.group_id) === freshGroup))
    const plainGroup = '20000006', plainCfg = host.getConfig()
    host.setConfig({ ...plainCfg, ownerLevel: 'social', group: { ...plainCfg.group, interjectChance: 1, minRecentMessages: 1, cooldownSec: 20, quietHours: [0, 0] }, allow: { ...plainCfg.allow, groups: [...plainCfg.allow.groups, plainGroup] } })
    gateway.push({ message_type: 'group', group_id: Number(plainGroup), user_id: Number(OTHER), message_id: 105, sender: { user_id: Number(OTHER), nickname: '普通群友' }, message: [{ type: 'text', data: { text: 'cs来' } }] })
    await until(() => fake.turns.length >= 5)
    await until(() => gateway.calls.some((c) => c.action === 'send_group_msg' && String(c.params.group_id) === plainGroup))
    gateway.push({ message_type: 'private', user_id: Number(A), message_id: 106, sender: { user_id: Number(A), nickname: '操作者' }, message: [{ type: 'text', data: { text: '核对目前群聊工具' } }] })
    await until(() => fake.turns.length >= 6)
    const socialOwner = [...fake.agents.values()].find((a) => a.preset === 'aurabot-social' && a.tools.has('fy_group_directory'))
    assert.ok(socialOwner); assert.ok(socialOwner.tools.has('fy_send_group_message')); assert.ok(socialOwner.tools.has('fy_capabilities'))
    assert.equal(socialOwner.tools.has('qq_send_message'), false)
    const opened = host.getConfig()
    host.setConfig({ ...opened, diary: { ...opened.diary, enabled: true }, profilePerms: { ...opened.profilePerms, qqNickname: 'all', qqSignature: 'all', qqAvatar: 'all', qqFriendRequest: 'all' }, ext: { ...opened.ext, fangyuan: { ...opened.ext.fangyuan, publicActions: true, publicRequestsFromAll: true } } })
    gateway.push({ message_type: 'private', user_id: Number(temporary), message_id: 107, sender: { user_id: Number(temporary), nickname: '临时来访者' }, message: [{ type: 'text', data: { text: '看看开放后的资料和说说能力' } }] })
    await until(() => fake.turns.length >= 7)
    const openTools = ['qq_set_nickname', 'qq_set_signature', 'qq_set_avatar', 'qq_send_qzone', 'qq_handle_friend_request', 'qq_save_sticker', 'fy_update_impression']
    const temporaryAgent = [...fake.agents.values()].find((a) => a.preset === 'aurabot-social' && openTools.every((name) => a.tools.has(name)))
    assert.ok(temporaryAgent, 'admitted temporary private chat receives real social tools')
    gateway.push({ message_type: 'group', group_id: Number(freshGroup), user_id: Number(OTHER), message_id: 108, sender: { user_id: Number(OTHER), nickname: '普通群友' }, message: [{ type: 'at', data: { qq: B } }, { type: 'text', data: { text: '看看群里的资料和说说能力' } }] })
    await until(() => fake.turns.length >= 8)
    assert.match(fake.turns.at(-1).ctxText, /"qzone":\{"tool":"qq_send_qzone","enabled":true/)
    assert.doesNotMatch(fake.turns.at(-1).ctxText, /金丝雀/)
    const reviewed = host.getConfig()
    host.setConfig({ ...reviewed, modules: { ...reviewed.modules, conversation: { enabled: true, useBuiltin: false } }, ext: { ...reviewed.ext, conversation: { reviewEnabled: true } } })
    await until(async () => (await fake.call('/modules')).json().list.some((m) => m.id === 'conversation' && m.running === 'user'))
    gateway.push({ message_type: 'private', user_id: Number(OTHER), message_id: 109, sender: { user_id: Number(OTHER), nickname: '普通好友' }, message: [{ type: 'text', data: { text: '你好，检查交流复核' } }] })
    await until(() => gateway.calls.some((c) => c.action === 'send_private_msg' && JSON.stringify(c.params).includes('自然接话复核通过')))
    assert.equal(reviewRequests.at(-1).messages[0].role,'system')
    assert.match(reviewRequests.at(-1).messages[0].content,/本轮实际生效的人格依据/)
    assert.equal(reviewRequests.at(-1).fy_background,false,'reply review uses the foreground capacity')
    assert.equal(reviewRequests.at(-1).fy_primary_only,true,'review cannot silently switch model')
    const paced = host.getConfig()
    host.setConfig({ ...paced, group: { ...paced.group, burstMax: 1 }, merge: { ...paced.merge, groupWaitSec: 0.4, groupMaxSec: 1.2 }, ext: { ...paced.ext, conversation: { reviewEnabled: true, pacingEnabled: true, ordinaryCooldownSec: 60 } } })
    const beforeGroupSend = gateway.calls.filter(c => c.action === 'send_group_msg' && String(c.params.group_id) === freshGroup).length
    for (const [mid, uid, text] of [[110, A, '多人艾特甲问候'], [111, OTHER, '多人艾特乙问近况']]) gateway.push({ message_type: 'group', group_id: Number(freshGroup), user_id: Number(uid), message_id: mid, sender: { user_id: Number(uid), nickname: uid === A ? '甲' : '乙' }, message: [{ type: 'at', data: { qq: B } }, { type: 'text', data: { text } }] })
    await until(() => gateway.calls.filter(c => c.action === 'send_group_msg' && String(c.params.group_id) === freshGroup).length > beforeGroupSend)
    const joint = fake.turns.filter(t => t.userText.includes('【群聊') && t.userText.includes('多人艾特甲问候') && t.userText.includes('多人艾特乙问近况'))
    assert.equal(joint.length, 1, 'two different people @ in one burst are processed together despite the native burst brake')
    assert.equal(gateway.calls.filter(c => c.action === 'send_group_msg' && String(c.params.group_id) === freshGroup).length, beforeGroupSend + 1)

    // Real hub prompt hooks see the full merge before its 600-character lastText cache.
    const firstQuestion = '首问必须保留：' + '甲'.repeat(650)
    const secondQuestion = '末问也必须保留'
    const beforeReviews = reviewRequests.length
    for (const [mid, text] of [[112, firstQuestion], [113, secondQuestion]]) gateway.push({ message_type: 'private', user_id: Number(A), message_id: mid, sender: { user_id: Number(A), nickname: '操作者' }, message: [{ type: 'text', data: { text } }] })
    await until(() => reviewRequests.slice(beforeReviews).some(r => r.messages[0].content.includes(secondQuestion)))
    const mergedReview = reviewRequests.slice(beforeReviews).find(r => r.messages[0].content.includes(secondQuestion)).messages[0].content
    assert.ok(mergedReview.includes(firstQuestion + '\\n' + secondQuestion), 'real host review retains both complete questions, despite the truncated host cache')
  } finally {
    // The upstream one-shot watchdog can fire after fake-host disposal.
    if (host) host.setConfig({ ...host.getConfig(), enabled: false })
    fake.dispose(); await gateway.close()
    globalThis.fetch=previousFetch
    if(previousToken==null) delete process.env.FY_PRODUCTION_TOKEN;else process.env.FY_PRODUCTION_TOKEN=previousToken
  }
})
