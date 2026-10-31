import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {stageAll} from './stage.mjs'
import {buildReviewQueue,writeReviewQueue,evaluateReview} from './review.mjs'

const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
const json=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')
const jsonl=(file,rows)=>fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n')+'\n')
const now='2026-11-01T00:00:00Z'
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'fy-media-review-'))
  t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:3,retryDelay:100}))
  const source=path.join(base,'research')
  const trend=path.join(source,'meme_pipeline_lab','trendradar_research','output_live')
  const audioDir=path.join(source,'research_audio_private')
  for(const folder of [trend,audioDir,path.join(source,'asr_drafts'),path.join(source,'asr_crosscheck')])
    fs.mkdirSync(folder,{recursive:true})
  json(path.join(base,'.fangyuan-media-staging-root.json'),{
    purpose:'isolated-fangyuan-media-staging',allowNewChildren:true})
  json(path.join(trend,'current_snapshot_summary.json'),{
    crawl_count:1,raw_items:25,platforms:{bilibili:{count:25}},
    keyword_matches:[{title:'测试母版素材',platform_id:'bilibili',url:'https://example.org/original',rank:5}]
  })
  const db=new DatabaseSync(path.join(source,'meme_pipeline_lab','research.sqlite3'))
  db.exec('CREATE TABLE wiki(id TEXT); CREATE TABLE topics(id TEXT); CREATE TABLE templates(name TEXT,stage TEXT,rights_status TEXT)')
  db.close()
  const bytes=Buffer.from('RIFF'+'.'.repeat(1200))
  const relative='research_audio_private/FY-V050.wav'
  fs.writeFileSync(path.join(source,relative),bytes)
  jsonl(path.join(source,'sources.jsonl'),[{id:'FY-V050',title:'测试来源',url:'https://example.org/voice'}])
  jsonl(path.join(source,'research_audio_manifest.jsonl'),[{
    id:'FY-V050',relative_path:relative,sha256:sha(bytes),bytes:bytes.length
  }])
  json(path.join(source,'素材索引_生产隔离版.json'),{
    video_source_count:0,research_audio_sources:0,items:[]})
  json(path.join(source,'全项目_自主总验收_最新.json'),{counts:{sources:0,audio_files:0}})
  const draft=path.join(source,'asr_drafts','FY-V050_auto.json')
  const cross=path.join(source,'asr_crosscheck','FY-V050_small.json')
  json(draft,{
    source_id:'FY-V050',audio_sha256:sha(bytes),status:'ASR_DRAFT_UNVERIFIED',
    segments:[{start_s:0,end_s:0.5,asr_text:'甲'},{start_s:0.5,end_s:0.8,asr_text:'乙'}]
  })
  json(cross,{
    source_id:'FY-V050',status:'TWO_ASR_MODELS_UNVERIFIED',chinese_similarity:0.73,
    segments:[{start_s:0,end_s:1,asr_text:'另一种识别'}]
  })
  const stage1=path.join(base,'stage-1')
  stageAll({mediaRoot:source,outputDir:stage1})
  return {base,source,stage1,draft,cross,sourceFile:path.join(source,'sources.jsonl')}
}
test('turn stage-1 into two review tickets but never approve',t=>{
  const f=fixture(t),result=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  assert.deepEqual(result.count,{memes:1,voices:1,highPriorityVoices:1,mediumPriorityVoices:0,normalPriorityVoices:0})
  assert.equal(result.productionReady,false)
  assert.equal(result.queue.every(x=>!x.productionReady&&!x.qqReady),true)
  assert.equal(result.reviewTemplates.every(x=>x.decision==='needs_review'),true)
})
test('prioritises conflicting ASR and preserves exact file hash',t=>{
  const f=fixture(t),result=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  const voice=result.queue.find(x=>x.kind==='voice')
  assert.equal(voice.asr.crossModelSimilarity,0.73)
  assert.deepEqual(voice.riskFlags,['low_asr_agreement_needs_listening','asr_segment_counts_differ'])
  assert.equal(voice.asr.audioShaMatched,true)
  assert.match(voice.sha256,/^[0-9a-f]{64}$/)
})
test('modest ASR mismatch is medium priority, not high',t=>{
  const f=fixture(t)
  const draft=JSON.parse(fs.readFileSync(f.draft,'utf8'))
  const cross=JSON.parse(fs.readFileSync(f.cross,'utf8'))
  draft.segments=Array.from({length:27},(_,i)=>({start_s:i,end_s:i+1,asr_text:'test'}))
  cross.segments=Array.from({length:28},(_,i)=>({start_s:i,end_s:i+1,asr_text:'test'}))
  cross.chinese_similarity=0.7414
  json(f.draft,draft)
  json(f.cross,cross)
  const q=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  assert.equal(q.queue.find(x=>x.kind==='voice').reviewPriority,'medium')
  assert.equal(q.count.mediumPriorityVoices,1)
  assert.equal(q.count.highPriorityVoices,0)
})
test('strong matching synthetic ASR is normal priority but still NOT approved',t=>{
  const f=fixture(t)
  const cross=JSON.parse(fs.readFileSync(f.cross,'utf8'))
  cross.segments=Array.from({length:2},(_,i)=>({start_s:i,end_s:i+1,asr_text:'test'}))
  cross.chinese_similarity=0.92
  json(f.cross,cross)
  const q=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  const v=q.queue.find(x=>x.kind==='voice')
  assert.equal(v.reviewPriority,'normal')
  assert.equal(v.qqReady,false)
})
test('meme lead is not original image proof',t=>{
  const f=fixture(t),result=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  const item=result.queue.find(x=>x.kind==='meme')
  assert.equal(item.stage,'needs_source_original_and_rights')
  assert.ok(item.missing.includes('actual_media_sha256'))
  assert.equal(item.productionReady,false)
})
test('writes queue and blank decisions to a task-owned new directory',t=>{
  const f=fixture(t),output=path.join(f.base,'stage-2')
  const result=writeReviewQueue({mediaRoot:f.source,stagingDir:f.stage1,outputDir:output})
  assert.equal(result.productionReady,false)
  assert.equal(result.approved,0)
  assert.equal(fs.existsSync(path.join(output,'review_queue.json')),true)
  const template=JSON.parse(fs.readFileSync(path.join(output,'review_decisions_TEMPLATE.json'),'utf8'))
  assert.equal(template.reviews.length,2)
  assert.equal(template.reviews.every(x=>x.decision==='needs_review'&&!x.reviewer),true)
})
test('refuses reuse of another task output directory',t=>{
  const f=fixture(t),out=path.join(f.base,'stage-1')
  assert.throws(()=>writeReviewQueue({mediaRoot:f.source,stagingDir:f.stage1,outputDir:out}),/Never overwrite/)
})
test('refuses a missing task ownership marker',t=>{
  const f=fixture(t)
  fs.unlinkSync(path.join(f.base,'.fangyuan-media-staging-root.json'))
  assert.throws(()=>writeReviewQueue({mediaRoot:f.source,stagingDir:f.stage1,outputDir:path.join(f.base,'new')}),/ownership marker/)
})
test('rejects stale original manifest rather than silently reviewing wrong source',t=>{
  const f=fixture(t)
  fs.appendFileSync(f.sourceFile,JSON.stringify({id:'FY-V051',title:'new concurrent writer'})+'\n')
  assert.throws(()=>buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}),/Stage-1 source changed/)
})
test('rejects ASR source identity mismatch',t=>{
  const f=fixture(t)
  const report=JSON.parse(fs.readFileSync(f.cross,'utf8'))
  report.source_id='FY-OTHER'
  json(f.cross,report)
  assert.throws(()=>buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}),/ASR source identity mismatch/)
})
test('rejects ASR content against different original audio',t=>{
  const f=fixture(t)
  const report=JSON.parse(fs.readFileSync(f.draft,'utf8'))
  report.audio_sha256='0'.repeat(64)
  json(f.draft,report)
  assert.throws(()=>buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}),/ASR points to wrong recording/)
})
test('pending review remains pending even with evidence-shaped text',t=>{
  const f=fixture(t),result=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1})
  const voice=result.queue.find(x=>x.kind==='voice')
  const decision={kind:'voice',id:voice.id,decision:'needs_review',reviewer:'someone',reviewedAt:now}
  const evaluation=evaluateReview(voice,decision)
  assert.equal(evaluation.editorialState,'pending')
  assert.equal(evaluation.qqReady,false)
})
test('partial meme editing approval is rejected, all releases remain disabled',t=>{
  const f=fixture(t),ticket=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}).queue.find(x=>x.kind==='meme')
  const incomplete={kind:'meme',id:ticket.id,decision:'approve_for_editing',reviewer:'',reviewedAt:now,
    evidence:{originalMediaSha256:'',originalSourceUrl:ticket.sourceUrl}}
  const result=evaluateReview(ticket,incomplete)
  assert.equal(result.editorialState,'incomplete_evidence')
  assert.ok(result.missing.includes('rightsPermissionReference'))
  assert.equal(result.productionReady,false)
})
test('full mock editorial review can only SUBMIT evidence, never publish',t=>{
  const f=fixture(t),ticket=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}).queue.find(x=>x.kind==='meme')
  const decision={kind:'meme',id:ticket.id,decision:'approve_for_editing',reviewer:'Example Human',reviewedAt:now,
    evidence:{originalMediaSha256:'a'.repeat(64),originalSourceUrl:ticket.sourceUrl,
      originContextReference:'source clip evidence 123',visualComparisonReference:'local visual QA reviewed 456',
      rightsPermissionReference:'license record 789',memeInterpretation:'source visual structure preserved'}}
  const result=evaluateReview(ticket,decision)
  assert.equal(result.editorialState,'evidence_submitted_for_separate_review')
  assert.equal(result.productionReady,false)
  assert.equal(result.qqReady,false)
})
test('full mock voice review never enables QQ',t=>{
  const f=fixture(t),ticket=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}).queue.find(x=>x.kind==='voice')
  const decision={kind:'voice',id:ticket.id,decision:'approve_for_editing',reviewer:'Example Human',reviewedAt:now,
    evidence:{audioSha256:ticket.sha256,
      sourceAttributionReference:'source provenance approved',speakerVerificationReference:'speaker QA document',
      transcriptVerificationReference:'ASR human validation',listeningReviewReference:'recorded quality QA',
      rightsPermissionReference:'license scope audit',scopeOfUse:'permitted editing research only'}}
  const result=evaluateReview(ticket,decision)
  assert.equal(result.editorialState,'evidence_submitted_for_separate_review')
  assert.equal(result.qqReady,false)
})
test('rejected mock keeps rejected media disabled and requires a reason',t=>{
  const f=fixture(t),ticket=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}).queue[0]
  const reject={kind:ticket.kind,id:ticket.id,decision:'reject',reviewer:'Human Reviewer',reviewedAt:now,
    evidence:{notes:'Not a genuine original meme image'}}
  const res=evaluateReview(ticket,reject)
  assert.equal(res.editorialState,'rejected')
  assert.equal(res.productionReady,false)
  reject.evidence.notes=''
  assert.equal(evaluateReview(ticket,reject).editorialState,'incomplete_rejection')
})
test('decision cannot use another ticket ID',t=>{
  const f=fixture(t),ticket=buildReviewQueue({mediaRoot:f.source,stagingDir:f.stage1}).queue[0]
  assert.throws(()=>evaluateReview(ticket,{kind:'meme',id:'other',decision:'needs_review'}),/identity mismatch/)
})
