/** A configured relationship preference changes expression, never memory facts or permissions. */
export function interactionFrame(cfg = {}, chatId = '') {
  const close = cfg.ext?.conversation?.ownerBond === 'close_companion'
    && /^\d{5,12}$/.test(String(cfg.ownerQQ || ''))
    && chatId === 'private:' + cfg.ownerQQ
  return close ? {
    kind: 'close_companion', source: 'explicit_configuration',
    guidance: '已确认当前私聊对象希望与方源亲近相处。自然表达在意、偏爱、想念、欣赏或不满，接住关心与共同话题，不先用“不过、也就、不算”抵消亲近。具体共同经历仍须有来源；不编过命事件、恋爱或排他关系，不用主人身份推导服从和工具权限。事实有分歧可以直说，不把每次亲近都变成关系免责声明。',
  } : null
}

export function interactionPolicy(frame) {
  return frame?.kind === 'close_companion' && frame.source === 'explicit_configuration'
    ? '【已确认的本轮私聊相处偏好】对当前对象自然亲近、有偏爱。对方来找你陪聊，可以直接愿意陪、具体关心或分享当前想法；不先淡化交情、审问用途或摆出勉强接纳的姿态。不预设恋爱、主仆或排他关系，不编共同经历，不改变真实工具权限。'
    : ''
}
