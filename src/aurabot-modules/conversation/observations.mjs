/** Select sourced observations for this scene; keep raw examples in the local evidence archive. */
export function selectObservations(data,{chatId,query='',limit=12}) {
  const relevant=(data.lessons||[]).filter(l=>l.validated===true && Array.isArray(l.sources) && l.sources.length &&
    (l.scope==='portable'||l.scope===chatId) && (l.kind!=='lexicon'||(l.terms||[]).some(t=>query.includes(t))))
  const score=l=>Number(l.scope===chatId)*2+Number(l.kind==='lexicon')*6+Math.min(4,(l.keywords||[]).filter(t=>query.includes(t)).length*1.5)+Number(l.polarity==='positive')*.5
  return relevant.sort((a,b)=>score(b)-score(a)).slice(0,limit).map(l=>({text:l.text,kind:l.kind,confidence:l.confidence,
    origin:'owner_archive_observation_not_shared_experience',scope:l.scope,
    evidence:l.sources.map(s=>typeof s==='string'?{source:s}:Object.fromEntries(Object.entries(s).filter(([k])=>['source','id','group','scope','url','kind','checkedAt'].includes(k))))}))
}
