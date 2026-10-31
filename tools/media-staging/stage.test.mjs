import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {stageMeme,stageVoice,stageAll} from './stage.mjs'

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')
const json=(p,value)=>fs.writeFileSync(p,JSON.stringify(value,null,2))
const lines=(p,rows)=>fs.writeFileSync(p,rows.map(x=>JSON.stringify(x)).join('\n')+'\n')
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fy-media-stage-test-'))
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:4,retryDelay:120}))
 json(path.join(root,'.fangyuan-media-staging-root.json'),{purpose:'isolated-fangyuan-media-staging',allowNewChildren:true})
 const media=path.join(root,'research')
 const meme=path.join(media,'meme_pipeline_lab')
 const trend=path.join(meme,'trendradar_research','output_live')
 const draft=path.join(media,'asr_drafts')
 const cross=path.join(media,'asr_crosscheck')
 const audio=path.join(media,'research_audio_private')
 for(const dir of [trend,draft,cross,audio])fs.mkdirSync(dir,{recursive:true})
 const imageSnapshot={
  crawl_count:1,raw_items:200,
  platforms:{bilibili:{name:'B站',count:20},weibo:{name:'微博',count:30}},
  keyword_matches:[
   {title:'有趣的原图梗',platform_id:'bilibili',rank:8,url:'https://example.org/meme/1'},
   {title:'有趣的原图梗',platform_id:'bilibili',rank:8,url:'https://example.org/meme/1'},
   {title:'bad link',platform_id:'weibo',rank:2,url:'file:///private/bad'}
  ]
 }
 json(path.join(trend,'current_snapshot_summary.json'),imageSnapshot)
 const db=new DatabaseSync(path.join(meme,'research.sqlite3'))
 db.exec('CREATE TABLE wiki(id TEXT); CREATE TABLE topics(id TEXT); CREATE TABLE templates(name TEXT,stage TEXT,rights_status TEXT)')
 db.exec("INSERT INTO wiki VALUES('wiki1'); INSERT INTO templates VALUES('test meme','awaiting_visual','unverified')")
 db.close()
 const audioBytes=Buffer.from('RIFF'+'.'.repeat(1100))
 const file=path.join(audio,'FY-V002.wav')
 fs.writeFileSync(file,audioBytes)
 const src=[{id:'FY-V001',title:'archive sample',url:'https://example.org/archive'},{id:'FY-V002',title:'new sample',url:'https://example.org/new'}]
 lines(path.join(media,'sources.jsonl'),src)
 lines(path.join(media,'research_audio_manifest.jsonl'),[{id:'FY-V002',relative_path:'research_audio_private/FY-V002.wav',sha256:sha(audioBytes),bytes:audioBytes.length}])
 json(path.join(media,'素材索引_生产隔离版.json'),{video_source_count:1,research_audio_sources:0,items:[{enabled:false,ready_for_qq:false}]})
 json(path.join(media,'全项目_自主总验收_最新.json'),{counts:{sources:1,audio_files:0}})
 return {root,media,meme,audioFile:file,sourcePath:path.join(media,'sources.jsonl'),manifestPath:path.join(media,'research_audio_manifest.jsonl')}
}
test('TrendRadar metadata stays lead-only, no production candidates',t=>{
 const f=fixture(t),out=stageMeme(f.media)
 assert.equal(out.leads.length,1)
 assert.equal(out.leads[0].readyForProduction,false)
 assert.equal(out.leads[0].originalImageVerified,false)
 assert.equal(out.database.wiki,1)
 assert.equal(out.database.approved,0)
 assert.equal(out.snapshot.rawItems,200)
})
test('voice reconciliation reads all files and reports count deltas without enabling assets',t=>{
 const f=fixture(t),v=stageVoice(f.media)
 assert.deepEqual(v.delta,{sources:1,audio:1,possibleNewSourceIds:['FY-V002'],possibleNewAudioIds:['FY-V002'],
   caveat:'IDs inferred from append-only order; validate actual previous manifest before release'})
 assert.equal(v.audioCandidates[0].readyForQQ,false)
 assert.equal(v.current.hashPassed,1)
})
test('staging outputs isolated artifacts without mutating input files',t=>{
 const f=fixture(t),beforeSrc=sha(fs.readFileSync(f.sourcePath)),beforeAudio=sha(fs.readFileSync(f.audioFile))
 const target=path.join(f.root,'release-candidates')
 const res=stageAll({mediaRoot:f.media,outputDir:target})
 assert.equal(res.productionEligible,false)
 assert.equal(res.voiceAudio,1)
 assert.equal(res.memeLeads,1)
 assert.equal(sha(fs.readFileSync(f.sourcePath)),beforeSrc)
 assert.equal(sha(fs.readFileSync(f.audioFile)),beforeAudio)
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8')).productionModified,false)
 assert.equal(JSON.parse(fs.readFileSync(path.join(target,'voice_review.json'),'utf8')).audioCandidates[0].readyForQQ,false)
})
test('refuses overwriting an existing output (other collaborator safety)',t=>{
 const f=fixture(t),out=path.join(f.root,'existing')
 fs.mkdirSync(out)
 fs.writeFileSync(path.join(out,'other.txt'),'keep')
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:out}),/already exists/)
 assert.equal(fs.readFileSync(path.join(out,'other.txt'),'utf8'),'keep')
})
test('refuses writing staging output into the source tree',t=>{
 const f=fixture(t)
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:path.join(f.media,'test-output')}),/overlap/)
 assert.equal(fs.existsSync(path.join(f.media,'test-output')),false)
})
test('refuses staging into ancestor of source tree',t=>{
 const f=fixture(t)
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:f.root}),/overlap|already exists/)
})
test('refuses corrupt audio without producing output',t=>{
 const f=fixture(t)
 fs.appendFileSync(f.audioFile,'corruption')
 const out=path.join(f.root,'not-created')
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:out}),/checksum/)
 assert.equal(fs.existsSync(out),false)
})
test('refuses missing audio without producing output',t=>{
 const f=fixture(t)
 fs.unlinkSync(f.audioFile)
 const out=path.join(f.root,'not-created')
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:out}),/ENOENT/)
 assert.equal(fs.existsSync(out),false)
})
test('refuses source ID duplication',t=>{
 const f=fixture(t)
 fs.appendFileSync(f.sourcePath,JSON.stringify({id:'FY-V001'})+'\n')
 assert.throws(()=>stageVoice(f.media),/Duplicate/)
})
test('refuses path escape in research audio manifest',t=>{
 const f=fixture(t)
 const rows=[{id:'FY-V002',relative_path:'../outside.wav',sha256:'00',bytes:4}]
 lines(f.manifestPath,rows)
 assert.throws(()=>stageVoice(f.media),/escapes source/)
})
test('refuses enabled old index assets',t=>{
 const f=fixture(t)
 json(path.join(f.media,'素材索引_生产隔离版.json'),{video_source_count:1,research_audio_sources:0,items:[{enabled:true}]})
 assert.throws(()=>stageVoice(f.media),/enabled content/)
})
test('refuses invalid TrendRadar schema',t=>{
 const f=fixture(t)
 json(path.join(f.meme,'trendradar_research','output_live','current_snapshot_summary.json'),{raw_items:200})
 assert.throws(()=>stageMeme(f.media),/Invalid TrendRadar/)
})
test('refuses unspecified output directory',t=>{
 const f=fixture(t)
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:''}),/Usage/)
})
test('refuses output in a directory not owned by this media task',t=>{
 const f=fixture(t)
 fs.unlinkSync(path.join(f.root,'.fangyuan-media-staging-root.json'))
 const out=path.join(f.root,'unsafe-output')
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:out}),/ownership marker/)
 assert.equal(fs.existsSync(out),false)
})
test('refuses bogus ownership marker',t=>{
 const f=fixture(t)
 json(path.join(f.root,'.fangyuan-media-staging-root.json'),{purpose:'someone-else',allowNewChildren:true})
 assert.throws(()=>stageAll({mediaRoot:f.media,outputDir:path.join(f.root,'bad-output')}),/Invalid media staging ownership marker/)
})
