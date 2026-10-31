import fs from 'node:fs';
import cp from 'node:child_process';
const args=['diff','--cached','--name-only','-z','--diff-filter=ACMR'];
const r=cp.spawnSync('git',args,{encoding:'buffer',timeout:10000});
if(r.status!==0){console.error('Cannot get Git staged files');process.exit(2)}
const files=r.stdout.toString('utf8').split('\0').filter(Boolean);
let blocks=0,review=0;
for(const name of files){
 const f=name.replace(/\\/g,'/');
 if(/(?:^|\/)(?:\.env(?!\.example$)|\.aurabot-cache|private|secrets|tokens|node_modules|services|runtime|archive|research)(?:\/|$)/i.test(f)||/\.(?:sqlite3?|db|pem|pfx|key|gguf|safetensors|mp3|wav|mp4)$/i.test(f)){console.log('BLOCK path:',f);blocks++;continue}
 let data;try{data=fs.readFileSync(name,'utf8')}catch{console.log('REVIEW unreadable:',f);review++;continue}
 const checks=[['CREDENTIAL',/\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g],['PRIVATE_KEY',/-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/g],['QQ_ID_OR_PHONE',/(?<![A-Za-z0-9])\d{9,11}(?![A-Za-z0-9])/g],['LOCAL_ABSOLUTE_PATH',/[A-Za-z]:\\(?:Users|ProgramData|Documents|FangYuan|下载)\\/g]];
 for(const [type,re] of checks){if(re.test(data)){console.log('REVIEW '+type+':',f);review++}}
}
console.log('staged_files='+files.length+' blocks='+blocks+' review_flags='+review);
if(blocks||review)process.exit(1);
