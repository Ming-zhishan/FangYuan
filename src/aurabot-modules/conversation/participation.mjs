/** Attention is guaranteed for an actual @; pacing only governs unsolicited participation. */
export function adjustParticipation(decision, { mentioned = false, lastDeliveredAt = 0, now = Date.now(), ordinaryCooldownSec = 60, ordinaryTurnsLastHour = 0, maxOrdinaryPerHour = 8 } = {}) {
  if (mentioned) return { reply: true, mode: 'must', reason: '真实@优先，合并本段后回应' }
  if (decision.mode === 'must') return decision
  if (ordinaryTurnsLastHour >= maxOrdinaryPerHour) return { reply: false, mode: 'none', reason: '这段时间主动参与已足够；被@仍回应' }
  if (lastDeliveredAt && now - lastDeliveredAt < ordinaryCooldownSec * 1000) return { reply: false, mode: 'none', reason: '刚参与过，给其他群友留出交流空间；被@仍回应' }
  return decision
}
