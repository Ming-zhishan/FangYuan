/** Autonomous signature changes only. Explicit user-initiated profile changes bypass this timer. */
export function canAutonomouslyChangeSignature(rows, now=Date.now(), gapMinutes=43200) {
  const minutes=Number(gapMinutes)
  const cooldown=Math.max(1440, Number.isFinite(minutes) && minutes>0 ? minutes : 43200)*60000
  return !(Array.isArray(rows)?rows:[]).some(e => e?.action==='set_self_longnick' &&
    ['attempted','acknowledged','unknown'].includes(e.status) &&
    Number.isFinite(Number(e.at)) && now>=Number(e.at) && now-Number(e.at)<cooldown)
}
