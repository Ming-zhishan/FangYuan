import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')),'..');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const map=[
 {label:'agent',source:'src/fangyuan-agent',live:'operations/legacy-tools/fangyuan-dsh'},
 {label:'aurabot',source:'src/aurabot-modules',live:'runtime/dsh-live/aurabot/modules'},
 {label:'qq-bootstrap',source:'src/qq-bootstrap',live:'runtime/qq-stack/setup'}
];
const out={at:new Date().toISOString(),readOnly:true,comparisons:[]};
function walk(p,dir='',acc=[]){
 for(const e of fs.readdirSync(path.join(p,dir),{withFileTypes:true})){
  if(e.name==='.git'||['node_modules','__pycache__','.venv','backups','logs','modules-data','.aurabot-cache'].includes(e.name))continue;
  const rel=path.join(dir,e.name);
  if(e.isDirectory())walk(p,rel,acc);else if(e.isFile())acc.push(rel);
 }return acc;
}
for(const x of map){
 const s=path.join(root,x.source),t=path.join(root,x.live);
 const missing=[],modified=[],additional=[];
 const names=walk(s);
 for(const name of names){
  const a=path.join(s,name),b=path.join(t,name);
  if(!fs.existsSync(b))missing.push(name);else if(sha(a)!==sha(b))modified.push(name);
 }
 const srcs=new Set(names.map(x=>x.toLowerCase()));
 for(const name of walk(t))if(!srcs.has(name.toLowerCase())&&!name.endsWith('README.md'))additional.push(name);
 out.comparisons.push({label:x.label,sourceFiles:names.length,missingInLive:missing,modifiedInLive:modified,extraLiveFiles:additional.slice(0,30),
  note:'Snapshot-to-live differences are informational; NEVER automatically overwrite production.'});
}
fs.writeFileSync(path.join(root,'operations/migration/source_drift_latest.json'),JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
