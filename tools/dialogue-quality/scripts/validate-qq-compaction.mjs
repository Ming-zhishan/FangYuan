/** Offline validation of Windows QQ preset overrides; no model, QQ or profile writes. */
export function validateQqCompaction(patch, {contextWindow=32768,replyTokens=8192}={}) {
  for (const id of ['aurabot-private','aurabot-private-long']) {
    const preset = patch.find(p => p.id === 'preset-'+id)
    if (preset?.config?.id !== id || !preset.name) throw Error('Incomplete preset override: '+id)
    const plugins = preset.config.plugins
    if (!plugins?.find(p=>p.id==='persona')?.config?.complete || !plugins.find(p=>p.id==='tool-fs')) throw Error('Inherited persona/tools missing')
    const policy = plugins.find(p=>p.id==='compaction')?.config?.find(p=>p.id==='compaction-basic')?.config
    if (!policy || policy.maxTokens > replyTokens || policy.maxTokens < 4096) throw Error('Inappropriate summary output allowance')
    if (!(contextWindow-replyTokens-policy.headroomTokens > policy.retainTokens)) throw Error('No positive context budget')
  }
  return {ok:true,presets:2,modelCalls:0,qqSends:0}
}
