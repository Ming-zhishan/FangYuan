import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import net from 'node:net';
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')),'..');
const map={...JSON.parse(fs.readFileSync(path.join(root,'config/project-paths.json'),'utf8')),...JSON.parse(fs.readFileSync(path.join(root,'config/project-paths.local.json'),'utf8'))};
const status={at:new Date().toISOString(),projectRoot:root,rootHasGit:fs.existsSync(path.join(root,'.git')),
 checks:[],ports:{},success:true,notes:[]};
function check(name,pass,detail=''){
 status.checks.push({name,pass:!!pass,...(detail?{detail}:{} )});
 if(!pass)status.success=false;
}
for(const [key,rel] of Object.entries(map.canonical)){
 const p=path.join(root,rel),exists=fs.existsSync(p);
 check('canonical_'+key,exists);
 if(!exists)continue;
 const back=map.physicalBacking[key];
 if(back){
  const isLink=fs.lstatSync(p).isSymbolicLink();
  const target=path.normalize(fs.realpathSync(p));
  check('junction_'+key,isLink&&target.toLowerCase()===path.normalize(fs.realpathSync(back)).toLowerCase());
 }
}
const old=map.backwardsCompatibility.oldMediaPath,modern=path.join(root,map.canonical.mediaResearch);
check('old_media_path_still_works',fs.existsSync(old)&&fs.lstatSync(old).isSymbolicLink()&&path.normalize(fs.realpathSync(old)).toLowerCase()===path.normalize(fs.realpathSync(modern)).toLowerCase());
for(const probe of ['meme_pipeline_lab/research.sqlite3','交付清单_最终版.md'])
 check('media_'+probe,fs.existsSync(path.join(modern,probe))&&fs.existsSync(path.join(old,probe)));
const qq=path.join(root,map.canonical.qqRuntime),dsh=path.join(root,map.canonical.dshProduction);
for(const [name,file] of [
 ['qq_supervisor',path.join(qq,'setup/supervise.ps1')],
 ['active_runtime_config',path.join(qq,'private/active-runtime.json')],
 ['napcat_binary',path.join(qq,'napcat/NapCatWinBootMain.exe')],
 ['local_ollama',path.join(qq,'ollama/ollama.exe')],
 ['aurabot_modules',path.join(dsh,'aurabot/modules/stickers/index.mjs')],
 ['aurabot_stickers',path.join(dsh,'aurabot/stickers/index.json')],
 ['learning_database',path.join(dsh,'aurabot/modules-data/learning/learning.sqlite3')]]
)check(name,fs.existsSync(file));
if(fs.existsSync(path.join(dsh,'aurabot/stickers/index.json'))){
 try{const j=JSON.parse(fs.readFileSync(path.join(dsh,'aurabot/stickers/index.json'),'utf8'));status.existingStickerCount=j.items?.length||0;
  check('stickers_library_min32',status.existingStickerCount>=32);}catch(e){check('stickers_library_parse',false,e.message)}
}
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
check('agent_source_copy',sha(path.join(root,'src/fangyuan-agent/README.md'))===sha(map.backwardsCompatibility.oldAgentSource+'/README.md'));
async function tcp(port){return new Promise(resolve=>{const c=net.connect({host:'127.0.0.1',port});const timeout=setTimeout(()=>{c.destroy();resolve(false)},600);
 c.on('connect',()=>{clearTimeout(timeout);c.destroy();resolve(true)});c.on('error',()=>{clearTimeout(timeout);resolve(false)})})}
for(const port of [3001,11434,38491])status.ports[port]=await tcp(port);
status.runtimeConnected=Object.values(status.ports).every(Boolean);
status.fileLayoutPass=status.success;
status.verdict=status.fileLayoutPass?(status.runtimeConnected?'LAYOUT_AND_RUNTIME_OK':'LAYOUT_OK_RUNTIME_OFFLINE'):'LAYOUT_FAILED';
status.notes.push('Port probes are read-only TCP connects; they do not send QQ messages or request paid models.');
status.notes.push('Live QQ and DSH directories were moved physically to E:/FangYuan/services; original C paths are backward-compatibility junctions.');
fs.writeFileSync(path.join(root,'operations/migration/unified_layout_last_verification.json'),JSON.stringify(status,null,2));
console.log(JSON.stringify({success:status.success,passes:status.checks.filter(x=>x.pass).length,failures:status.checks.filter(x=>!x.pass),
 ports:status.ports,runtimeConnected:status.runtimeConnected,verdict:status.verdict,stickers:status.existingStickerCount,rootGitInitialized:status.rootHasGit},null,2));
if(!status.success)process.exitCode=2;
