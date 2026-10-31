import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { pokeIdentity, evaluatePoke, registerPokeAttempt } from './policy.mjs'

function loadState(file) {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return state?.version === 1 && Array.isArray(state.attempts) ? state : { corrupt: true }
  } catch (error) {
    return error.code === 'ENOENT' ? { version: 1, attempts: [] } : { corrupt: true }
  }
}
function storeState(file, state) {
  const staged = file + '.pending-' + randomUUID()
  try {
    writeFileSync(staged, JSON.stringify(state), { encoding: 'utf8', flag: 'wx' })
    renameSync(staged, file)
  } catch (error) {
    try { unlinkSync(staged) } catch {}
    throw error
  }
}

export default {
  id: 'poke-interaction',
  name: '方源·戳一戳轻互动（待审核）',
  api: 1, version: '0.1.0', tab: 'group',
  description: '真实 poke 事件触发的低频简短回复。默认关闭；群名单独许可；无需模型或外部素材。',
  defaults: { enabled: false, liveSend: false },
  settings: [
    { key: 'enabled', label: '允许考虑戳一戳互动（默认关闭）', type: 'switch' },
    { key: 'liveSend', label: '已完成实机验收后允许真实发送（默认关闭）', type: 'switch' }
  ],
  setup(api) {
    api.on('poke', async raw => {
      const cfg = api.config(), choice = api.settings?.() || {}
      // No hook takeover or output unless BOTH flags have been explicitly enabled.
      if (cfg.enabled !== true || choice.enabled !== true || choice.liveSend !== true) return false
      const allowGroups = Array.isArray(cfg.allow?.groups) ? cfg.allow.groups : []
      const identity = pokeIdentity(raw, { botQQ: cfg.botQQ, allowGroups })
      if (!identity.ok) return false
      const chatId = identity.chatId
      if (api.core?.mutes?.muted?.(chatId)) return true
      let recent = [], isFamiliar = false
      try {
        const learning = api.use('learning')
        if (!learning?.permitted?.(chatId) || typeof learning.store?.conversationFrame !== 'function') return true
        recent = learning.store.conversationFrame(chatId, 6) || []
        const relation = learning.publicRelationship?.(identity.sender)
        isFamiliar = ['friend', 'special'].includes(relation?.kind) && Number(relation?.affinity || 0) >= 0
      } catch {
        return true // Any uncertainty about context or permission means silence.
      }
      const file = api.dataDir('poke-gate.json')
      const now = Date.now(), state = loadState(file)
      const verdict = evaluatePoke({ raw, botQQ: cfg.botQQ, allowGroups, state, recent,
        isFamiliar, enabled: choice.enabled, liveSend: choice.liveSend, now })
      if (!verdict.ok) return true
      try {
        // Persistence precedes the send, so uncertain or repeated events never trigger re-sends.
        storeState(file, registerPokeAttempt(state, verdict, now))
      } catch {
        api.log?.warn?.('戳一戳节流状态不可写，本轮保持沉默')
        return true
      }
      try {
        // Reuses Aurabot's native text sending; no model/voice/sticker API is invoked.
        await api.sendText(chatId, verdict.text)
      } catch {
        api.log?.warn?.('戳一戳发送结果未知，不自动重试')
      }
      return true
    })
    return { gate: 'explicit_opt_in_group_only', noModelCalls: true }
  }
}
