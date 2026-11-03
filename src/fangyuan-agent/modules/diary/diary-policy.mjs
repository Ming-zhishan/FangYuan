/** Restrict autonomous public QQ posts. A direct, explicitly approved request remains separate. */
export function canAutonomouslyConsiderDiary(rows, now=Date.now(), gapDays=14) {
  const days=Number(gapDays)
  const ms=Math.max(1,Number.isFinite(days) && days>0 ? days : 14)*86400000
  return !(Array.isArray(rows)?rows:[]).some(entry =>
    entry && entry.mode !== 'request' &&
    ['considered','attempted','sent','unknown'].includes(entry.status) &&
    Number.isFinite(Number(entry.at)) && now>=Number(entry.at) && now-Number(entry.at)<ms)
}
