import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { LearningStore } from '../modules/learning/store.mjs'
import { LearningWorker } from '../modules/learning/worker.mjs'

function fixture(t, answer) {
  const dir = mkdtempSync(join(tmpdir(), 'fy-review-')), store = new LearningStore(join(dir, 'learning.db'))
  const path = join(dir, 'book.db'), original = new DatabaseSync(path)
  original.exec('CREATE TABLE chunks(id TEXT,passage TEXT,source_label TEXT,sequence INTEGER,volume INTEGER,number_text TEXT,title TEXT,part INTEGER)')
  for (const row of [['a','前因在此。共同短句。','原文甲'],['b','后果在此。共同短句。','原文乙']]) original.prepare('INSERT INTO chunks(id,passage,source_label) VALUES(?,?,?)').run(...row)
  original.close()
  store.enqueue({id:'old',kind:'book',payload:{}})
  for (const [id, source, quote] of [['na','a','前因在此。'],['nb','b','后果在此。']]) store.db.prepare('INSERT INTO book_claims VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'old',source,'人物','因果','后果','叙述','阶段',quote,quote)
  let calls=0
  const worker = new LearningWorker(store,{ask:async (...args)=>{calls++;return answer(...args)}},{settings:()=>({originalDbPath:path}),permitted:()=>true})
  t.after(()=>{worker.close();store.close();rmSync(dir,{recursive:true,force:true})})
  return {store,worker,originalPath:path,calls:()=>calls}
}
const claim=(source,quote)=>({source,quote,subject:'人物',relation:'因果',object:'结果',perspective:'叙述',stage:'阶段',text:'有依据的理解'})

test('cached review salvages valid evidence and retries only the invalid source without paying for the cached call',async t=>{
  const f=fixture(t,()=>JSON.stringify({claims:[claim('b','后果在此。')],continuity:'补足乙'}))
  f.store.enqueue({id:'r',kind:'review',payload:{noteIds:['na','nb'],cachedOutputId:'cached'}})
  f.store.db.prepare('INSERT INTO model_outputs VALUES(?,?,?,?)').run('cached',JSON.stringify({claims:[claim('a','前因在此。'),claim('b','根本不存在。')],continuity:'甲已核对'}),null,Date.now())
  let job=f.store.nextJob(['review']);await f.worker.execute(job)
  job=f.store.db.prepare('SELECT * FROM jobs WHERE id=?').get('r')
  assert.equal(f.calls(),0);assert.equal(job.status,'pending');assert.deepEqual(JSON.parse(job.payload).noteIds,['nb'])
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM book_claims WHERE job='r'").get().n,1)
  await f.worker.execute(job)
  assert.equal(f.calls(),1);assert.equal(f.store.db.prepare("SELECT status FROM jobs WHERE id='r'").get().status,'done')
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM book_claims WHERE job='r'").get().n,2)
})

test('review repairs only uniquely located exact source quotes; ambiguous misattribution stays quarantined',async t=>{
  const f=fixture(t,()=>JSON.stringify({claims:[claim('wrong','后果在此。'),claim('wrong','共同短句。')],continuity:'保留疑点'}))
  const r=await f.worker.review({id:'r',payload:JSON.stringify({noteIds:['na','nb']})})
  assert.equal(r.claims.length,1);assert.equal(r.claims[0].source,'b');assert.equal(r.sourceCorrections.length,1)
  assert.equal(r.unverified.length,1);assert.deepEqual(r.pendingNoteIds,['na','nb'])
})

test('corrected Gu-life preserves old rows for audit but does not reinject superseded fiction',async t=>{
  const f=fixture(t,(_system,text)=>{
    const input=JSON.parse(text);assert.equal(input.previous.length,0);assert.equal(input.anchors[0].source,'a')
    return JSON.stringify({text:'暂且收起手中的炼蛊清单，看看宝黄天的委托。'})
  })
  f.store.db.prepare('INSERT INTO life VALUES(?,?,?,?,?)').run('old','2026-10-31','旧的无据补白合光蛊',null,1)
  f.store.set('lifeRevisions',{excludedIds:['old'],reason:'重新锚定正典'})
  f.store.set('guWorldAnchors',[{source:'a',quote:'前因在此。',fact:'原著锚点',stage:'当前阶段'}])
  f.store.enqueue({id:'life:correction',kind:'life',day:'2026-10-31',payload:{revision:'grounded-v1'}})
  const job=f.store.nextJob(['life']);await f.worker.execute(job)
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM life').get().n,2)
  const ctx=f.store.context('private:100001',[],'你最近怎么样')
  assert.match(ctx,/宝黄天/);assert.doesNotMatch(ctx,/合光蛊/)
  assert.equal(f.store.lifeStates().length,1)
})

test('a timed-out review continues in smaller portions, preserving all notes and cross-portion continuity',async t=>{
  let attempts=0
  const f=fixture(t,(_system,text)=>{
    if(++attempts===1)throw new Error('background_primary_unavailable:school_TimeoutError')
    const input=JSON.parse(text);assert.equal(input.notes.length,1)
    const n=input.notes[0];if(n.source==='b')assert.equal(input.previousContinuity,'甲的因果已核对')
    return JSON.stringify({claims:[claim(n.source,n.quote)],continuity:n.source==='a'?'甲的因果已核对':'乙的后果已衔接'})
  })
  f.store.enqueue({id:'r',kind:'review',payload:{noteIds:['na','nb']}})
  await assert.rejects(f.worker.execute(f.store.nextJob(['review'])),/TimeoutError/)
  let job=f.store.db.prepare("SELECT * FROM jobs WHERE id='r'").get();assert.equal(JSON.parse(job.payload).reviewNoteLimit,1)
  await f.worker.execute(job);job=f.store.db.prepare("SELECT * FROM jobs WHERE id='r'").get()
  assert.equal(job.status,'pending');assert.deepEqual(JSON.parse(job.payload).noteIds,['nb'])
  await f.worker.execute(job);assert.equal(f.store.db.prepare("SELECT status FROM jobs WHERE id='r'").get().status,'done')
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM book_claims WHERE job='r'").get().n,2)
})

test('timed-out book batches retain unread text and continue causally across smaller portions',async t=>{
  let attempts=0
  const f=fixture(t,(_system,text)=>{
    if(++attempts===1)throw new Error('background_primary_unavailable:school_TimeoutError')
    const input=JSON.parse(text);assert.equal(input.parts.length,1)
    const p=input.parts[0];if(p.sequence===2)assert.equal(input.previousContinuity,'第一章的线索')
    return JSON.stringify({claims:[],chapterChecks:[{sequence:p.sequence,source:p.id,quote:p.sequence===1?'前因在此。':'后果在此。',chain:'有起因、选择和结果的研读'}],continuity:p.sequence===1?'第一章的线索':'第二章接上后果'})
  })
  const original=new DatabaseSync(f.originalPath)
  original.prepare('UPDATE chunks SET passage=?,sequence=1,volume=1,number_text=?,title=?,part=1 WHERE id=?').run('前因在此。'+'文'.repeat(40000),'一','章一','a')
  original.prepare('UPDATE chunks SET passage=?,sequence=2,volume=1,number_text=?,title=?,part=1 WHERE id=?').run('后果在此。'+'文'.repeat(40000),'二','章二','b');original.close()
  f.store.enqueue({id:'book',kind:'book',payload:{ids:['a','b']}})
  for(const [id,seq] of [['a',1],['b',2]])f.store.db.prepare('INSERT INTO book_sources VALUES(?,?,?,?,NULL)').run(id,seq,1,1)
  await assert.rejects(f.worker.execute(f.store.db.prepare("SELECT * FROM jobs WHERE id='book'").get()),/TimeoutError/)
  let job=f.store.db.prepare("SELECT * FROM jobs WHERE id='book'").get();await f.worker.execute(job)
  job=f.store.db.prepare("SELECT * FROM jobs WHERE id='book'").get();assert.equal(job.status,'pending');assert.deepEqual(JSON.parse(job.payload).pendingIds,['b'])
  assert.equal(f.store.db.prepare('SELECT count(readJob) n FROM book_sources').get().n,1)
  await f.worker.execute(job);assert.equal(f.store.db.prepare("SELECT status FROM jobs WHERE id='book'").get().status,'done')
  assert.equal(f.store.db.prepare('SELECT count(readJob) n FROM book_sources').get().n,2)
})
