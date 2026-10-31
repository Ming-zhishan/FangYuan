/**
 * FangYuan offline media review queue and conservative evidence gates.
 * Only reads the published stage-1 candidate snapshot and research material.
 * NEVER exports deployable media assets, QQ-ready manifests, or bot configuration.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'

const sha=x=>crypto.createHash('sha256').update(x).digest('hex')
const json=f=>JSON.parse(fs.readFileSync(f,'utf8'))
const lines=f=>fs.readFileSync(f,'utf8').split(/\r?\n/).flatMap((s,i)=>{
  if(!s.trim())return []
  try{return [JSON.parse(s)]}catch{throw Error('Invalid JSONL in '+path.basename(f)+' line '+(i+1))}
})
const inside=(root,p)=>{
  const relative=path.relative(root,p)
  return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep))
}
const isHttp=u=>{
  if(typeof u!=='string')return false
  try{return ['https:','http:'].includes(new URL(u).protocol)}catch{return false}
}
const nonblank=x=>typeof x==='string'&&x.trim().length>=6&&!/^(pending|unknown|todo|tbd|none|待核|待定)$/i.test(x.trim())

function checkStaleSource(mediaRoot,stageManifest){
  if(!stageManifest?.sourceChecksums || stageManifest.status!=='review_only')
    throw Error('Stage-1 source manifest is missing or is not review-only')
  const root=fs.realpathSync(mediaRoot)
  for(const [rel,digest] of Object.entries(stageManifest.sourceChecksums)){
    if(path.isAbsolute(rel))throw Error('Unsafe source manifest path')
    const file=path.resolve(root,rel)
    if(!inside(root,file))throw Error('Stage-1 source manifest escapes research root')
    if(fs.existsSync(file)){
      const actual=fs.realpathSync(file)
      if(!inside(root,actual))throw Error('Stage-1 source symlink escapes root')
    }
    const next=fs.existsSync(file)?sha(fs.readFileSync(file)):null
    if(next!==digest)throw Error('Stage-1 source changed; rerun stage-1 in a separate owned output directory: '+rel)
  }
}
function templateFor(ticket){
  if(ticket.kind==='meme')return {
    kind:'meme',id:ticket.id,decision:'needs_review',reviewer:'',reviewedAt:'',
    evidence:{originalMediaSha256:'',originalSourceUrl:ticket.sourceUrl,originContextReference:'',
      visualComparisonReference:'',rightsPermissionReference:'',memeInterpretation:'',notes:''}
  }
  return {
    kind:'voice',id:ticket.id,decision:'needs_review',reviewer:'',reviewedAt:'',
    evidence:{audioSha256:ticket.sha256,sourceAttributionReference:'',
      speakerVerificationReference:'',transcriptVerificationReference:'',
      listeningReviewReference:'',rightsPermissionReference:'',scopeOfUse:'',notes:''}
  }
}
export function evaluateReview(ticket,decision){
  if(!ticket||!['meme','voice'].includes(ticket.kind))throw Error('Unknown review ticket')
  if(!decision||decision.kind!==ticket.kind||decision.id!==ticket.id)throw Error('Decision identity mismatch')
  if(!['needs_review','reject','approve_for_editing'].includes(decision.decision))
    throw Error('Invalid editorial decision')
  const pending=[]
  if(decision.decision==='needs_review')
    return {id:ticket.id,editorialState:'pending',missing:['human_verification'],productionReady:false,qqReady:false}
  if(!nonblank(decision.reviewer))pending.push('reviewer')
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(String(decision.reviewedAt||'')) ||
    !Number.isFinite(Date.parse(decision.reviewedAt)))pending.push('valid_reviewedAt')
  const proof=decision.evidence||{}
  if(decision.decision==='reject'){
    if(!nonblank(proof.notes))pending.push('rejection_reason')
    return {id:ticket.id,editorialState:pending.length?'incomplete_rejection':'rejected',
      missing:pending,productionReady:false,qqReady:false}
  }
  const fields=ticket.kind==='meme'
    ? ['originContextReference','visualComparisonReference','rightsPermissionReference','memeInterpretation']
    : ['sourceAttributionReference','speakerVerificationReference','transcriptVerificationReference',
       'listeningReviewReference','rightsPermissionReference','scopeOfUse']
  for(const field of fields)if(!nonblank(proof[field]))pending.push(field)
  if(ticket.kind==='meme') {
    if(!isHttp(proof.originalSourceUrl) || proof.originalSourceUrl!==ticket.sourceUrl)
      pending.push('originalSourceUrl_match')
    if(!/^[0-9a-f]{64}$/i.test(proof.originalMediaSha256||''))
      pending.push('originalMediaSha256')
  }else if(proof.audioSha256!==ticket.sha256)
    pending.push('audioSha256_must_match_verified_source')
  // This is a self-reported editorial evidence package, NOT technical or legal permission to publish.
  return {id:ticket.id,
    editorialState:pending.length?'incomplete_evidence':'evidence_submitted_for_separate_review',
    missing:pending,productionReady:false,qqReady:false}
}
export function buildReviewQueue({mediaRoot,stagingDir}){
  const source=fs.realpathSync(mediaRoot)
  const staged=fs.realpathSync(stagingDir)
  if(inside(source,staged)||inside(staged,source))throw Error('Staging and research roots overlap')
  const manifest=json(path.join(staged,'manifest.json'))
  const meme=json(path.join(staged,'meme_leads.json'))
  const voice=json(path.join(staged,'voice_review.json'))
  if(meme.kind!=='meme_lead_staging'||voice.kind!=='voice_inventory_reconciliation')
    throw Error('Unsupported stage-1 format')
  if(meme.readyForProduction!==false||voice.readyForProduction!==false)
    throw Error('Stage-1 output unexpectedly production-ready')
  checkStaleSource(source,manifest)
  const candidates=lines(path.join(source,'sources.jsonl'))
  const sourceById=new Map(candidates.map(x=>[x.id,x]))
  if(sourceById.size!==candidates.length)throw Error('Duplicate research source ID')
  const reviewerQueue=[]
  for(const lead of meme.leads){
    if(lead.readyForProduction!==false || !/^[a-f0-9]{24}$/i.test(lead.id) || !isHttp(lead.url))
      throw Error('Invalid or enabled meme lead')
    reviewerQueue.push({
      kind:'meme',id:lead.id,topic:lead.title,platform:lead.platform,sourceUrl:lead.url,
      rank:lead.rank,stage:'needs_source_original_and_rights',
      missing:['source_original','actual_media_sha256','context','visual_fidelity','rights','human_review'],
      productionReady:false,qqReady:false
    })
  }
  for(const item of voice.audioCandidates){
    if(item.readyForQQ!==false || !/^[0-9a-f]{64}$/i.test(item.sha256))
      throw Error('Invalid or enabled voice item')
    const sourceRecord=sourceById.get(item.id)
    if(!sourceRecord)throw Error('Orphan research voice source '+item.id)
    const autoFile=path.join(source,'asr_drafts',item.id+'_auto.json')
    const crossFile=path.join(source,'asr_crosscheck',item.id+'_small.json')
    if(!fs.existsSync(autoFile)||!fs.existsSync(crossFile))
      throw Error('Missing ASR pair '+item.id)
    const auto=json(autoFile),cross=json(crossFile)
    if(auto.source_id!==item.id||cross.source_id!==item.id)
      throw Error('ASR source identity mismatch '+item.id)
    if(auto.audio_sha256!==item.sha256)
      throw Error('ASR points to wrong recording '+item.id)
    const similarity=Number(cross.chinese_similarity)
    const validSimilarity=Number.isFinite(similarity)&&similarity>=0&&similarity<=1
    const baseSegments=Array.isArray(auto.segments)?auto.segments.length:null
    const secondSegments=Array.isArray(cross.segments)?cross.segments.length:null
    const riskFlags=[]
    if(!validSimilarity)riskFlags.push('no_numeric_asr_agreement')
    else if(similarity<0.85)riskFlags.push('low_asr_agreement_needs_listening')
    if(baseSegments!==secondSegments)riskFlags.push('asr_segment_counts_differ')
    if(auto.status!=='ASR_DRAFT_UNVERIFIED'||cross.status!=='TWO_ASR_MODELS_UNVERIFIED')
      riskFlags.push('unexpected_asr_status_requires_manual_review')
    const segmentRatio=baseSegments!=null&&secondSegments!=null
      ? Math.max(baseSegments,secondSegments)/Math.max(1,Math.min(baseSegments,secondSegments)) : null
    // Triage heuristic, NOT a transcription quality pass/fail or speaker identification.
    const priority=!validSimilarity||similarity<0.50||(segmentRatio!=null&&segmentRatio>=1.50)
      ||riskFlags.includes('unexpected_asr_status_requires_manual_review')?'high'
      :riskFlags.length?'medium':'normal'
    const mediaUrl=sourceRecord.url
    reviewerQueue.push({
      kind:'voice',id:item.id,sourceTitle:sourceRecord.title||null,
      sourceUrl:isHttp(mediaUrl)?mediaUrl:null,
      sha256:item.sha256,bytes:item.bytes,format:item.format,
      asr:{firstStatus:auto.status,secondStatus:cross.status,
        firstSegmentCount:baseSegments,secondSegmentCount:secondSegments,
        crossModelSimilarity:validSimilarity?similarity:null,
        audioShaMatched:true,previewTextIncluded:false},
      reviewPriority:priority,riskFlags,
      stage:'needs_transcript_speaker_audio_rights_review',
      missing:['transcript','speaker','audio_listening','permission_scope','human_review'],
      productionReady:false,qqReady:false
    })
  }
  const seen=new Set()
  for(const ticket of reviewerQueue){
    const key=ticket.kind+':'+ticket.id
    if(seen.has(key))throw Error('Duplicate review ticket '+key)
    seen.add(key)
  }
  checkStaleSource(source,manifest)
  return {schema:1,sourceStage1Fingerprint:sha(fs.readFileSync(path.join(staged,'manifest.json'))),
    status:'editorial_queue_needs_manual_review',generatedAt:new Date().toISOString(),
    count:{memes:reviewerQueue.filter(x=>x.kind==='meme').length,
      voices:reviewerQueue.filter(x=>x.kind==='voice').length,
      highPriorityVoices:reviewerQueue.filter(x=>x.kind==='voice'&&x.reviewPriority==='high').length,
      mediumPriorityVoices:reviewerQueue.filter(x=>x.kind==='voice'&&x.reviewPriority==='medium').length,
      normalPriorityVoices:reviewerQueue.filter(x=>x.kind==='voice'&&x.reviewPriority==='normal').length},
    queue:reviewerQueue,reviewTemplates:reviewerQueue.map(templateFor),
    contract:'Editorial approval is not an automatic production or QQ-send permission.',
    productionReady:false,qqReady:false}
}
export function writeReviewQueue({mediaRoot,stagingDir,outputDir}){
  if(!mediaRoot||!stagingDir||!outputDir)throw Error('Usage: --media-root PATH --stage-1 DIR --out NEW_DIR')
  const parent=fs.realpathSync(path.dirname(path.resolve(outputDir)))
  const target=path.resolve(outputDir), source=fs.realpathSync(mediaRoot)
  if(inside(source,target)||inside(target,source))throw Error('Output/source overlap forbidden')
  if(!fs.existsSync(path.join(parent,'.fangyuan-media-staging-root.json')))
    throw Error('Missing media staging ownership marker')
  const owner=json(path.join(parent,'.fangyuan-media-staging-root.json'))
  if(owner.purpose!=='isolated-fangyuan-media-staging'||owner.allowNewChildren!==true)
    throw Error('Invalid media staging ownership marker')
  if(fs.existsSync(target))throw Error('Never overwrite an existing task output')
  const data=buildReviewQueue({mediaRoot,stagingDir})
  fs.mkdirSync(target)
  try{
    for(const [file,obj] of [['review_queue.json',{schema:data.schema,sourceStage1Fingerprint:data.sourceStage1Fingerprint,
       status:data.status,generatedAt:data.generatedAt,count:data.count,queue:data.queue,
       contract:data.contract,productionReady:false,qqReady:false}],
      ['review_decisions_TEMPLATE.json',{schema:1,sourceStage1Fingerprint:data.sourceStage1Fingerprint,
       warning:'Fill only with genuine, independently evidenced reviews. No release flags.',
       reviews:data.reviewTemplates}]]){
      fs.writeFileSync(path.join(target,file),JSON.stringify(obj,null,2)+'\n',{flag:'wx'})
    }
    fs.writeFileSync(path.join(target,'README.md'),
      '# Private, offline editorial queue\n\nNo review was approved. The TEMPLATE is blank. '+
      'No photo/voice may be published or sent solely because an evidence package was submitted.\n',
      {flag:'wx'})
  }catch(e){fs.rmSync(target,{recursive:true,force:true});throw e}
  return {output:target,memes:data.count.memes,voices:data.count.voices,
    highPriorityVoices:data.count.highPriorityVoices,approved:0,productionReady:false}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const args={}
  for(let i=2;i<process.argv.length;i+=2){
    if(!['--media-root','--stage-1','--out'].includes(process.argv[i])||
      !process.argv[i+1]||Object.hasOwn(args,process.argv[i]))throw Error('Bad argument')
    args[process.argv[i]]=process.argv[i+1]
  }
  console.log(JSON.stringify(writeReviewQueue({
    mediaRoot:args['--media-root'],stagingDir:args['--stage-1'],outputDir:args['--out']
  }),null,2))
}
