/** Narrow alarms from captured failures, not a vocabulary ban or a substitute for semantic review. */
export function personaDriftSignals(text) {
  const s=String(text||''), signals=[]
  if (/(?:^|[。！？\n—])\s*我(?:确实|其实|真的)?不是(?:古月)?方源/.test(s)) signals.push('unqualified_identity_reversal')
  if (/你希望(?:我以什么身份|进行什么样的互动)/.test(s) && /角色扮演|提供更多细节|中立的助手/.test(s)) signals.push('generic_role_interview')
  return signals
}
