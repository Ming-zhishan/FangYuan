/**
 * Read-only FangYuan media staging. No network, model calls, QQ or production writes.
 * All generated candidates stay disabled; nothing here is a deployment script.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'

const hash=x=>crypto.createHash('sha256').update(x).digest('hex')
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'))
const jsonl=f=>fs.readFileSync(f,'utf8').split(/\r?\n/).flatMap((line,i)=>{
  if(!line.trim())return []
  try{return [JSON.parse(line)]}catch{throw Error('Bad JSONL '+path.basename(f)+' line '+(i+1))}
})
const inside=(root,p)=>{const r=path.relative(root,p);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep))}
function idsUnique(rows,label){
  const seen=new Set()
  for(const x of rows){if(typeof x.id!=='string'||!x.id||seen.has(x.id))throw Error('Duplicate/missing '+label+' ID');seen.add(x.id)}
}
function fingerprints(root){
  const files=['sources.jsonl','research_audio_manifest.jsonl','素材索引_生产隔离版.json','全项目_自主总验收_最新.json',
    'meme_pipeline_lab/research.sqlite3','meme_pipeline_lab/research.sqlite3-wal',
    'meme_pipeline_lab/trendradar_research/output_live/current_snapshot_summary.json']
  return Object.fromEntries(files.map(rel=>[rel,fs.existsSync(path.join(root,rel))?hash(fs.readFileSync(path.join(root,rel))):null]))
}
export function stageMeme(root){
  const lab=path.join(root,'meme_pipeline_lab')
  const trend=json(path.join(lab,'trendradar_research/output_live/current_snapshot_summary.json'))
  if(!Array.isArray(trend.keyword_matches)||!trend.platforms||!Number.isInteger(trend.raw_items))
    throw Error('Invalid TrendRadar snapshot')
  const db=new DatabaseSync(path.join(lab,'research.sqlite3'),{readOnly:true})
  let database
  try{
    if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('SQLite integrity failed')
    const n=q=>db.prepare(q).get().n
    database={wiki:n('SELECT count(*) n FROM wiki'),topics:n('SELECT count(*) n FROM topics'),
      templates:n('SELECT count(*) n FROM templates'),approved:n("SELECT count(*) n FROM templates WHERE stage='approved'"),
      pendingTemplates:db.prepare('SELECT name,stage,rights_status FROM templates ORDER BY name').all()}
  }finally{db.close()}
  const ids=new Set(),leads=[]
  for(const item of trend.keyword_matches){
    if(!item?.title||!item?.platform_id||!item?.url)continue
    let u
    try{u=new URL(item.url);if(!['https:','http:'].includes(u.protocol))continue}catch{continue}
    const id=hash(item.platform_id+'|'+u.href+'|'+String(item.title).trim()).slice(0,24)
    if(ids.has(id))continue
    ids.add(id)
    leads.push({id,title:String(item.title).slice(0,180),platform:String(item.platform_id).slice(0,60),
      url:u.href,rank:Number.isInteger(item.rank)?item.rank:null,
      status:'lead_only',originalImageVerified:false,visualApproved:false,rights:'unverified',
      readyForProduction:false})
  }
  return {version:1,kind:'meme_lead_staging',liveSourceDatabaseModified:false,
    snapshot:{rawItems:trend.raw_items,platforms:Object.keys(trend.platforms).length,crawls:trend.crawl_count,
      keywordMatches:trend.keyword_matches.length},database,leads,
    handoff:'Each lead needs real original picture/GIF, provenance, licence and editorial approval before any import',
    readyForProduction:false}
}
export function stageVoice(root){
  const sources=jsonl(path.join(root,'sources.jsonl'))
  const audio=jsonl(path.join(root,'research_audio_manifest.jsonl'))
  const old=json(path.join(root,'素材索引_生产隔离版.json'))
  const qa=json(path.join(root,'全项目_自主总验收_最新.json'))
  idsUnique(sources,'source');idsUnique(audio,'audio')
  const sourceIds=new Set(sources.map(x=>x.id)),rootReal=fs.realpathSync(root)
  if(!Array.isArray(old.items)||old.items.some(x=>x.enabled||x.ready_for_qq))
    throw Error('Old voice isolation index has enabled content or unexpected schema')
  const verified=[]
  for(const a of audio){
    if(!sourceIds.has(a.id))throw Error('Orphan research audio: '+a.id)
    if(typeof a.relative_path!=='string'||!a.relative_path||path.isAbsolute(a.relative_path)||a.relative_path.includes('\0'))
      throw Error('Unsafe audio relative path: '+a.id)
    const requested=path.resolve(rootReal,a.relative_path)
    if(!inside(rootReal,requested)||requested===rootReal)throw Error('Audio path escapes source')
    const real=fs.realpathSync(requested)
    if(!inside(rootReal,real))throw Error('Audio symlink escapes source')
    const bytes=fs.readFileSync(real)
    if(hash(bytes)!==a.sha256||bytes.length!==a.bytes)throw Error('Audio checksum/length failed: '+a.id)
    verified.push({id:a.id,sha256:a.sha256,bytes:bytes.length,format:path.extname(real).toLowerCase(),
      asrPairPresent:fs.existsSync(path.join(root,'asr_drafts',a.id+'_auto.json'))&&fs.existsSync(path.join(root,'asr_crosscheck',a.id+'_small.json')),
      speakerReview:'pending',assetRights:'needs_per_asset_review',enabled:false,readyForQQ:false})
  }
  const prevSource=Number(old.video_source_count),prevAudio=Number(old.research_audio_sources)
  if(!Number.isInteger(prevSource)||!Number.isInteger(prevAudio)||prevSource<0||prevAudio<0)
    throw Error('Bad previous catalogue counts')
  return {version:1,kind:'voice_inventory_reconciliation',liveSourceManifestsModified:false,
    current:{sources:sources.length,audio:audio.length,hashPassed:verified.length},
    prior:{qaSources:qa.counts?.sources,qaAudio:qa.counts?.audio_files,catalogSources:prevSource,
      catalogAudio:prevAudio,catalogEntries:old.items.length},
    delta:{sources:sources.length-prevSource,audio:audio.length-prevAudio,
      possibleNewSourceIds:sources.slice(prevSource).map(x=>x.id),
      possibleNewAudioIds:audio.slice(prevAudio).map(x=>x.id),
      caveat:'IDs inferred from append-only order; validate actual previous manifest before release'},
    audioCandidates:verified,
    handoff:'Recheck attribution, ASR, scope of rights, voice quality and OneBot delivery independently; all candidates remain disabled',
    readyForProduction:false}
}
export function stageAll({mediaRoot,outputDir}){
  if(typeof mediaRoot!=='string'||!mediaRoot||typeof outputDir!=='string'||!outputDir)
    throw Error('Usage: --media-root PATH --out NEW_DIRECTORY')
  const source=fs.realpathSync(mediaRoot),target=path.resolve(outputDir),
        parent=fs.realpathSync(path.dirname(target))
  if(path.normalize(target)!==path.normalize(path.join(parent,path.basename(target))))
    throw Error('Output parent is not canonical')
  // Sibling outputs under a shared parent are safe. Only actual tree overlap is forbidden.
  if(inside(source,target)||inside(target,source))
    throw Error('Output/source overlap forbidden')
  if(fs.existsSync(target))throw Error('Output already exists: never overwrite')
  // Output must be in a task-owned directory explicitly marked for media staging.
  // A generic --out pointing into production, another worktree or user documents is rejected.
  const marker=path.join(parent,'.fangyuan-media-staging-root.json')
  if(!fs.existsSync(marker))throw Error('Output parent lacks the media staging ownership marker')
  const owner=json(marker)
  if(owner?.purpose!=='isolated-fangyuan-media-staging' || owner?.allowNewChildren!==true)
    throw Error('Invalid media staging ownership marker')
  const before=fingerprints(source)
  const meme=stageMeme(source),voice=stageVoice(source)
  if(JSON.stringify(fingerprints(source))!==JSON.stringify(before))
    throw Error('Concurrent source change detected; no output written')
  fs.mkdirSync(target)
  try{
    const files={
      'manifest.json':{schema:1,status:'review_only',generatedAt:new Date().toISOString(),
        sourceChecksums:before,qqMessages:0,paidModelCalls:0,productionModified:false,productionEligible:false},
      'meme_leads.json':meme,'voice_review.json':voice
    }
    for(const [name,value] of Object.entries(files))
      fs.writeFileSync(path.join(target,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'})
    fs.writeFileSync(path.join(target,'README.md'),
      '# Offline media staging, not a production release\n\nAll assets disabled. Do not copy candidate manifests to a live Bot.\n',
      {flag:'wx'})
  }catch(err){fs.rmSync(target,{recursive:true,force:true});throw err}
  return {directory:target,memeLeads:meme.leads.length,voiceAudio:voice.audioCandidates.length,
    newSourceCount:voice.delta.sources,newAudioCount:voice.delta.audio,productionEligible:false}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args={}
  for(let i=2;i<process.argv.length;i+=2){
    if(!['--media-root','--out'].includes(process.argv[i])||!process.argv[i+1]||Object.hasOwn(args,process.argv[i]))
      throw Error('Expected --media-root PATH --out NEW_DIRECTORY')
    args[process.argv[i]]=process.argv[i+1]
  }
  console.log(JSON.stringify(stageAll({mediaRoot:args['--media-root'],outputDir:args['--out']}),null,2))
}
