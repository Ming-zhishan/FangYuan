import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { SocialStore, validScope } from '../modules/memory/store.mjs'
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24)
export function importLegacy(store, snapshot) {
  if (snapshot.format !== 'fangyuan-legacy-social-v1' || !Array.isArray(snapshot.interactions) || !Array.isArray(snapshot.facts)) throw new Error('Not a supported read-only snapshot')
  return store.mutate((state) => {
    const result = { importedEvents: 0, importedFacts: 0, skippedEvents: 0, factReviewNeeded: 0 }
    for (const row of snapshot.interactions) {
      const scope = String(row.scope || ''), uid = String(row.uid || ''), mid = String(row.mid || '')
      if (!validScope(scope) || !/^\d{5,12}$/.test(uid) || !mid || typeof row.text !== 'string' || !Number.isFinite(row.created_at) || (scope.startsWith('private:') && scope !== `private:${uid}`)) { result.skippedEvents++; continue }
      const id = digest(`${scope}|${mid}`)
      if (state.events.some((e) => e.id === id)) continue
      const oldFacts = snapshot.facts.filter((f) => f.scope === scope && String(f.uid) === uid && String(f.source_mid) === mid)
      state.events.push({ id, scope, uid, mid, text: row.text.slice(0, 3000), at: row.created_at * 1000, origin: 'legacy_social', obsoleteSelfReport: oldFacts.length > 0 && !oldFacts.some((f) => f.active),
        ...(row.answer ? { oldAnswer: { text: String(row.answer).slice(0, 1200), status: 'historical_generated_answer_not_verified_fact_or_delivery' } } : {}) })
      result.importedEvents++
    }
    for (const row of snapshot.facts) {
      if (!row.active) continue // Old rejected records are not resurrected by reparsing raw dialogue.
      const event = state.events.find((e) => e.scope === row.scope && e.uid === String(row.uid) && e.mid === String(row.source_mid))
      if (!event || typeof row.content !== 'string' || !row.content || !event.text.includes(row.content)) { result.factReviewNeeded++; continue }
      const key = digest(`legacy-fact|${row.scope}|${row.id}`)
      if (state.facts.some((f) => f.id === key)) continue
      const kind = String(row.slot).split(':')[0], slot = ['like', 'dislike'].includes(kind) ? `preference:${row.content}` : row.slot
      state.facts.push({ id: key, uid: event.uid, scope: event.scope, kind, text: row.content,
        quote: event.text, event: event.id, authority: 'legacy_self_report_not_objective_truth', active: true, at: row.created_at * 1000, slot })
      result.importedFacts++
    }
    state.imports ||= []; state.imports.push({ at: Date.now(), ...result })
    return result
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const snapshot = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  console.log(JSON.stringify(importLegacy(new SocialStore(process.argv[3]), snapshot)))
}
