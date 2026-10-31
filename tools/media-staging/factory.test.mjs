import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {factory} from './factory.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const j=(p,o)=>fs.writeFileSync(p,JSON.stringify(o,null,2));
function setup(t){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'fy-media-factory-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true,maxRetries:3,retryDelay:80}));
 const media=path.join(home,'media'),lab=path.join(media,'meme_pipeline_lab');
 const trend=path.join(lab,'trendradar_research','output_live'),originals=path.join(lab,'originals');
 fs.mkdirSync(trend,{recursive:true});fs.mkdirSync(originals);
 j(path.join(home,'.fangyuan-media-staging-root.json'),{purpose:'isolated-fangyuan-media-staging',allowNewChildren:true});
 j(path.join(trend,'current_snapshot_summary.json'),{raw_items:3,
  platforms:{douyin:{top20:[{rank:1,title:'好笑的抽象表情包',url:'https://example.org/1'},{rank:2,title:'某人去世',url:'https://example.org/2'}]},
   bilibili:{top20:[{rank:1,title:'宏观新闻播报',url:'https://example.org/3'}]}}});
 const db=new DatabaseSync(path.join(lab,'research.sqlite3'));
 db.exec('CREATE TABLE wiki(id TEXT,slug TEXT,title TEXT,summary TEXT,source_video TEXT,cover_url TEXT)');
 db.prepare('INSERT INTO wiki VALUES(?,?,?,?,?,?)').run('w1','a','梗条目','来源','BVtest','https://example.org/video');
 db.close();
 const mediaBytes=Buffer.from('GIF89a');
 fs.writeFileSync(path.join(originals,'meme.gif'),mediaBytes);
 j(path.join(lab,'全部素材_逐帧格式与指纹核验.json'),{items:[{path:'originals/meme.gif',sha256:sha(mediaBytes),format:'GIF',frames:2,width:20,height:20,bytes:mediaBytes.length}]});
 return {home,media,lab};
}
test('all platform leads merged and sensitive separated without production flags',t=>{
 const p=setup(t),res=factory({mediaRoot:p.media,out:path.join(p.home,'outA')});
 assert.equal(res.stats.leads,3);
 assert.equal(res.stats.highPriority,1);
 assert.equal(res.stats.sensitiveHold,1);
 assert.equal(res.stats.wiki,1);
 assert.equal(res.stats.originalMedia,1);
 assert.equal(res.stats.approvedForProduction,0);
 assert.equal(res.qqReady,false);
});
test('incremental rerun of same snapshot deduplicates without increasing observations',t=>{
 const p=setup(t),a=path.join(p.home,'outA'),b=path.join(p.home,'outB');
 factory({mediaRoot:p.media,out:a});
 const res=factory({mediaRoot:p.media,out:b,previous:a});
 assert.equal(res.stats.leads,3);
 assert.equal(res.stats.snapshots,1);
 const db=new DatabaseSync(path.join(b,'factory.sqlite3'),{readOnly:true});
 assert.deepEqual(db.prepare('SELECT DISTINCT observations n FROM leads').all().map(x=>x.n),[1]);db.close();
});
test('new trend snapshot preserves older leads, increments recurring observations',t=>{
 const p=setup(t),a=path.join(p.home,'outA'),b=path.join(p.home,'outB');
 factory({mediaRoot:p.media,out:a});
 const file=path.join(p.lab,'trendradar_research','output_live','current_snapshot_summary.json');
 const x=JSON.parse(fs.readFileSync(file,'utf8'));
 x.platforms.douyin.top20.push({rank:3,title:'另一个新的梗图',url:'https://example.org/new'});
 x.raw_items=4;j(file,x);
 const res=factory({mediaRoot:p.media,out:b,previous:a});
 assert.equal(res.stats.snapshots,2);
 assert.equal(res.stats.leads,4);
 assert.equal(res.stats.highPriority,2);
 const db=new DatabaseSync(path.join(b,'factory.sqlite3'),{readOnly:true});
 assert.equal(db.prepare("SELECT observations FROM leads WHERE title='好笑的抽象表情包'").get().observations,2);db.close();
});
test('never overwrite another output or write to source tree',t=>{
 const p=setup(t),a=path.join(p.home,'outA');
 fs.mkdirSync(a);fs.writeFileSync(path.join(a,'owned-by-other.txt'),'keep');
 assert.throws(()=>factory({mediaRoot:p.media,out:a}),/unsafe or existing/);
 assert.equal(fs.readFileSync(path.join(a,'owned-by-other.txt'),'utf8'),'keep');
 assert.throws(()=>factory({mediaRoot:p.media,out:path.join(p.media,'new')}),/unsafe or existing|missing task ownership/);
});
test('reject corrupted original media with zero output',t=>{
 const p=setup(t);fs.appendFileSync(path.join(p.lab,'originals','meme.gif'),'broken');
 assert.throws(()=>factory({mediaRoot:p.media,out:path.join(p.home,'outBad')}),/Origin missing or changed/);
 assert.equal(fs.existsSync(path.join(p.home,'outBad')),false);
});
test('requires task ownership marker even when path exists',t=>{
 const p=setup(t);fs.rmSync(path.join(p.home,'.fangyuan-media-staging-root.json'));
 assert.throws(()=>factory({mediaRoot:p.media,out:path.join(p.home,'outNoOwner')}),/missing task ownership/);
});
test('rejects incompatible previous output instead of mutating it',t=>{
 const p=setup(t),previous=path.join(p.home,'old');
 fs.mkdirSync(previous);
 fs.writeFileSync(path.join(previous,'factory.sqlite3'),'not a DB');
 j(path.join(previous,'FACTORY_FINAL.json'),{schema:1,productionReady:true});
 assert.throws(()=>factory({mediaRoot:p.media,out:path.join(p.home,'outNext'),previous}),/previous state not compatible/);
});

test('raw TrendRadar SQLite imports all 30 source rows, not only dashboard top 20',t=>{
 const p=setup(t);
 const dir=path.join(p.lab,'trendradar_research','output_live','news');
 fs.mkdirSync(dir,{recursive:true});
 const db=new DatabaseSync(path.join(dir,'2026-11-01.db'));
 db.exec('CREATE TABLE news_items(id INTEGER PRIMARY KEY,platform_id TEXT,title TEXT,url TEXT,rank INTEGER)');
 const q=db.prepare('INSERT INTO news_items(platform_id,title,url,rank) VALUES(?,?,?,?)');
 for(let i=0;i<30;i++)q.run('douyin','research headline '+i,'https://example.org/raw/'+i,i+1);
 db.close();
 const summary=path.join(p.lab,'trendradar_research','output_live','current_snapshot_summary.json');
 const obj=JSON.parse(fs.readFileSync(summary,'utf8'));
 obj.raw_items=30;
 fs.writeFileSync(summary,JSON.stringify(obj));
 const result=factory({mediaRoot:p.media,out:path.join(p.home,'all30')});
 assert.equal(result.stats.leads,30);
 assert.equal(result.stats.snapshots,1);
 assert.equal(result.qqReady,false);
});
