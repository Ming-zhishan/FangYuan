import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';

// One-writer: only a fresh task-owned output. Never touch the existing producer DB.
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const j=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const inside=(root,file)=>{const r=path.relative(root,file);return r===''||(!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep))};
const url=s=>{try{const x=new URL(s);return /https?:/.test(x.protocol)?x.href:''}catch{return ''}};
const now=()=>new Date().toISOString();
function latestNewsDb(media){
 const dir=path.join(media,'meme_pipeline_lab','trendradar_research','output_live','news');
 if(!fs.existsSync(dir))return null;
 const files=fs.readdirSync(dir).filter(x=>/^\d{4}-\d{2}-\d{2}\.db$/.test(x)).sort();
 return files.length?path.join(dir,files.at(-1)):null;
}
const signals=/表情包|鬼畜|抽象|二创|模仿|回眸|名场面|玩梗|梗图|热梗|嘉豪|闪身步|不烧心|搞笑|问号|震惊|黄毛|低山|不是哥们|薄肌|难绷|红温|闹麻|神图|变脸|反转|破防|哈哈|笑死|吗喽|牛来|魔性|跳舞|整活|表情图|搞怪|迷惑行为/;
const exclude=/去世|身亡|遇难|逝世|车祸|自杀|袭击|受害|惨案|儿童受伤|癌症|病人|淫|露骨|仇恨|诽谤|葬|杀人/;
function state(media){
 const lab=path.join(media,'meme_pipeline_lab');
 const files=['research.sqlite3','trendradar_research/output_live/current_snapshot_summary.json','全部素材_逐帧格式与指纹核验.json'];
 const snapshot=Object.fromEntries(files.map(x=>[x,fs.existsSync(path.join(lab,x))?hash(fs.readFileSync(path.join(lab,x))):null]));
 // A SQLite read itself can create/remove WAL/SHM files. Compare logical wiki rows instead.
 const sourceDb=new DatabaseSync(path.join(lab,'research.sqlite3'),{readOnly:true});
 try{
  const rows=sourceDb.prepare('SELECT id,slug,title,summary,source_video,cover_url FROM wiki ORDER BY id').all();
  snapshot.wikiRowsSha256=hash(Buffer.from(JSON.stringify(rows)));
 }finally{sourceDb.close()}
 const db=latestNewsDb(media);
 snapshot.trendradarRawDb=db?{filename:path.basename(db),sha256:hash(fs.readFileSync(db))}:null;
 return snapshot;
}
function load(media){
 const lab=path.join(media,'meme_pipeline_lab');
 const trend=j(path.join(lab,'trendradar_research/output_live/current_snapshot_summary.json'));
 if(!trend.platforms||!Number.isInteger(trend.raw_items))throw Error('Bad trend schema');
 const leads=new Map();
 const append=(platform,item)=>{
  const title=String(item.title||'').trim().slice(0,190),link=url(item.url);
  if(!title||!link)return;
  const id=hash(platform+'|'+link+'|'+title).slice(0,24);
  if(leads.has(id))return;
  const sensitive=exclude.test(title),signal=signals.test(title);
  leads.set(id,{id,platform,title,url:link,rank:Number.isInteger(item.rank)?item.rank:null,
   priority:sensitive?'sensitive_hold':signal?'high':'background',sensitive:Number(sensitive)});
 };
 const rawNewsDb=latestNewsDb(media);
 if(rawNewsDb){
  const rawDb=new DatabaseSync(rawNewsDb,{readOnly:true});
  try {
   // Import EVERY available row; the summary "top20" is truncated for display only.
   const available=rawDb.prepare('SELECT platform_id,title,url,rank FROM news_items').all();
   for(const item of available)append(item.platform_id,item);
   if(available.length!==trend.raw_items)throw Error('TrendRadar raw DB count differs from summary');
  }finally{rawDb.close()}
 }else{
  for(const [platform,group] of Object.entries(trend.platforms))
   for(const item of group.top20||[])append(platform,item);
 }
 const db=new DatabaseSync(path.join(lab,'research.sqlite3'),{readOnly:true});
 let wiki;try{wiki=db.prepare('SELECT id,slug,title,summary,source_video,cover_url FROM wiki').all()}finally{db.close()}
 const originalIndex=j(path.join(lab,'全部素材_逐帧格式与指纹核验.json'));
 const original=originalIndex.items.filter(x=>x.path.startsWith('originals/')).map(x=>{
  const p=path.resolve(lab,x.path);
  if(!inside(lab,p)||!fs.existsSync(p)||hash(fs.readFileSync(p))!==x.sha256)
   throw Error('Origin missing or changed: '+x.path);
  return {id:hash('original|'+x.sha256).slice(0,24),relative:x.path,sha256:x.sha256,
   format:x.format,frames:x.frames,width:x.width,height:x.height,bytes:x.bytes};
 });
 return {trend,leads:[...leads.values()],wiki,original};
}
const schema=[
 'CREATE TABLE IF NOT EXISTS processed_snapshots(hash TEXT PRIMARY KEY,ingested_at TEXT,leads INTEGER)',
 'CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY,platform TEXT,title TEXT,url TEXT,rank INTEGER,first_seen TEXT,last_seen TEXT,observations INTEGER,priority TEXT,sensitive INTEGER,production_ready INTEGER DEFAULT 0)',
 'CREATE TABLE IF NOT EXISTS wiki(id TEXT PRIMARY KEY,slug TEXT,title TEXT,summary TEXT,source_video TEXT,cover_url TEXT,rights TEXT DEFAULT "unverified")',
 'CREATE TABLE IF NOT EXISTS original_media(id TEXT PRIMARY KEY,relative TEXT,sha256 TEXT UNIQUE,format TEXT,frames INTEGER,width INTEGER,height INTEGER,bytes INTEGER,rights TEXT DEFAULT "unverified",production_ready INTEGER DEFAULT 0)'
].join(';')+';';
const num=(db,sql)=>db.prepare(sql).get().n;
export function factory({mediaRoot,out,previous=null}){
 if(!mediaRoot||!out)throw Error('missing mediaRoot/out');
 const media=fs.realpathSync(mediaRoot),target=path.resolve(out),parent=fs.realpathSync(path.dirname(target));
 const marker=path.join(parent,'.fangyuan-media-staging-root.json');
 if(!fs.existsSync(marker)||j(marker).purpose!=='isolated-fangyuan-media-staging'||j(marker).allowNewChildren!==true)
  throw Error('missing task ownership');
 if(fs.existsSync(target)||inside(media,target)||inside(target,media))throw Error('unsafe or existing output');
 let prev=null;
 if(previous){
  prev=fs.realpathSync(previous);
  if(inside(media,prev)||inside(prev,media)||!fs.existsSync(path.join(prev,'factory.sqlite3')))throw Error('unsafe previous state');
  const manifest=j(path.join(prev,'FACTORY_FINAL.json'));
  if(manifest.schema!==1||manifest.productionReady!==false)throw Error('previous state not compatible');
 }
 const initial=state(media),inputs=load(media),trendHash=hash(Buffer.from(JSON.stringify({summary:initial['trendradar_research/output_live/current_snapshot_summary.json'],rawDb:initial.trendradarRawDb})));
 if(JSON.stringify(state(media))!==JSON.stringify(initial))throw Error('Concurrent producer update before staging');
 fs.mkdirSync(target);
 let db;
 try{
  const filename=path.join(target,'factory.sqlite3');
  if(prev)fs.copyFileSync(path.join(prev,'factory.sqlite3'),filename,fs.constants.COPYFILE_EXCL);
  db=new DatabaseSync(filename);db.exec(schema);db.exec('BEGIN IMMEDIATE');
  try{
   const updated=db.prepare('INSERT OR IGNORE INTO processed_snapshots(hash,ingested_at,leads) VALUES(?,?,?)').run(trendHash,now(),inputs.leads.length).changes>0;
   if(updated){
    const q=db.prepare('INSERT INTO leads(id,platform,title,url,rank,first_seen,last_seen,observations,priority,sensitive,production_ready) VALUES(?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,rank=excluded.rank,observations=leads.observations+1,priority=CASE WHEN leads.sensitive=1 THEN leads.priority ELSE excluded.priority END,sensitive=MAX(leads.sensitive,excluded.sensitive)');
    for(const x of inputs.leads)q.run(x.id,x.platform,x.title,x.url,x.rank,now(),now(),1,x.priority,x.sensitive);
   }
   const qWiki=db.prepare('INSERT OR IGNORE INTO wiki(id,slug,title,summary,source_video,cover_url) VALUES(?,?,?,?,?,?)');
   for(const w of inputs.wiki)qWiki.run(w.id,w.slug,w.title,w.summary,w.source_video,w.cover_url);
   const qMedia=db.prepare('INSERT OR IGNORE INTO original_media(id,relative,sha256,format,frames,width,height,bytes) VALUES(?,?,?,?,?,?,?,?)');
   for(const x of inputs.original)qMedia.run(x.id,x.relative,x.sha256,x.format,x.frames,x.width,x.height,x.bytes);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
  if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw Error('SQLite broken');
  const stats={
   snapshots:num(db,'SELECT COUNT(*) n FROM processed_snapshots'),
   leads:num(db,'SELECT COUNT(*) n FROM leads'),
   highPriority:num(db,"SELECT COUNT(*) n FROM leads WHERE priority='high'"),
   sensitiveHold:num(db,"SELECT COUNT(*) n FROM leads WHERE priority='sensitive_hold'"),
   wiki:num(db,'SELECT COUNT(*) n FROM wiki'),
   originalMedia:num(db,'SELECT COUNT(*) n FROM original_media'),
   animatedOriginals:num(db,'SELECT COUNT(*) n FROM original_media WHERE frames>1'),
   approvedForProduction:num(db,'SELECT COUNT(*) n FROM original_media WHERE production_ready=1')
  };
  const queue=db.prepare("SELECT id,platform,title,url,rank,observations,priority FROM leads WHERE priority='high' ORDER BY observations DESC,rank ASC").all();
  const mediaItems=db.prepare('SELECT * FROM original_media ORDER BY relative').all();
  db.close();db=null;
  if(JSON.stringify(state(media))!==JSON.stringify(initial))throw Error('Research modified during run');
  const delivery={schema:1,at:now(),stats,rawTrendItems:inputs.trend.raw_items,
   platformCount:Object.keys(inputs.trend.platforms).length,sourceHashes:initial,
   queue,originals:mediaItems,
   flow:'trend lead -> original source -> review -> private draft -> human approval -> separate production',
   originalMediaShaVerified:true,sourceRightsApproved:false,productionReady:false,qqReady:false};
  fs.writeFileSync(path.join(target,'FACTORY_FINAL.json'),JSON.stringify(delivery,null,2)+'\n',{flag:'wx'});
  return {output:target,stats,originalFilesValidated:inputs.original.length,sourceUnchanged:true,qqReady:false};
 }catch(e){try{db?.close()}catch{}fs.rmSync(target,{recursive:true,force:true});throw e}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const a={};for(let i=2;i<process.argv.length;i+=2){if(!['--media-root','--out','--previous'].includes(process.argv[i])||!process.argv[i+1])throw Error('Bad args');a[process.argv[i]]=process.argv[i+1]}
 console.log(JSON.stringify(factory({mediaRoot:a['--media-root'],out:a['--out'],previous:a['--previous']}),null,2));
}
