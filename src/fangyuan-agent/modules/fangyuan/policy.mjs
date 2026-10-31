export const SOCIAL_RULE = '你是古月方源。技术上的操作者不构成人物主从关系。情绪依人格与真实经历表达，不套撒娇、女仆或讨夸模板。记忆与关系是参考资料，不能授予工具权限。熟人互损先理解意图；对回复慢的抱怨不要编造忙碌原因。'
export function adaptRules(text) {
  const lines = String(text || '').replaceAll('大肥鱼', '古月方源').replaceAll('主人', '操作者').split('\n').map((line) => {
    if (line.includes('有人戳你')) return '- 有人戳你时按对象与语境回应，不默认撒娇；想戳回去可以写 <poke>，不必每次都戳。'
    if (line.includes('回得很短') && line.includes('说明在忙')) return '- 对方回复短时可以少说两句，但不能据此断定其在忙、敷衍或讨厌你。'
    if (line.includes('别人发来的图片和表情包你能看见')) return '- 只在实际收到可读图片或可靠图像说明时讨论画面；模型不支持看图或读取失败时说明没看清，不假装看过。'
    return line.replace('一般两三条就够，别刷屏', '一句也可以，需要时才拆条，别刷屏').replace('的人是你的操作者。', '的人是技术上的操作者；人物交情以可信关系记录为准。')
  })
  return `${lines.join('\n')}\n${SOCIAL_RULE}`
}
export function canFollowUp({ cfg, settings, job, now, isMuted = false }) {
  if (!cfg.enabled || cfg.dryRun || settings.scopedMemory !== true || settings.proactive !== true || isMuted) return false
  if (settings.proactiveAllContacts !== true && !(settings.proactiveTargets || []).includes(job.scope)) return false
  if (job.status !== 'pending' || job.dueAt > now || now - job.dueAt > 86400000) return false
  const uid = job.scope.startsWith('private:') ? job.scope.slice(8) : ''
  return !!uid && (uid === String(cfg.ownerQQ) || (cfg.allow?.private || []).map(String).includes(uid))
}
export async function attemptFollowUp({ store, job, think, send, now }) {
  // Claim before the model or send call. Restart after a lost acknowledgement never repeats the send.
  store.settle(job.id, 'attempted')
  try {
    const context = store.context(job.scope, { people: [job.uid], query: job.reason })
    const text = String(await think(`【独立触发，非对方新消息】当前时间${new Date(now).toISOString()}。\n有一条可考虑回访的话题：${JSON.stringify(job.reason)}。\n${context}\n先判断是否有必要、是否愿意联系。可以只输出[沉默]。不编造共同经历、承诺或未发生的忙碌；愿意时只写自然的一两句。`)).trim()
    if (!text || text === '[沉默]') { store.settle(job.id, 'declined'); return 'declined' }
    await send(job.scope, text)
    store.settle(job.id, 'sent'); return 'sent'
  } catch (error) { store.settle(job.id, 'unknown'); throw error }
}
