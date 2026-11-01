/** Offline 37-item QQ OneBot voice encoding audit; never sends messages. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'
function digest(b){return crypto.createHash('sha256').update(b).digest('hex')}
function json(p){return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))}
export async function checkVoicePack(indexFile,adapterFile){
 const pack=json(indexFile)
 const adapter=await import(pathToFileURL(fs.realpathSync(adapterFile)).href)
 if(pack.qqReady!==false||pack.productionReady!==false)throw Error('Unexpected release state')
 const result=[]
 for(const sample of pack.entries){
  const file=fs.realpathSync(sample.file)
  const before=fs.readFileSync(file)
  if(digest(before)!==sample.sha256)throw Error('Voice source hash mismatch '+sample.id)
  if(adapter.readyForVoiceAsset(sample)!==false)throw Error('Unreviewed media got release permission')
  const part=adapter.recordSegment(path.dirname(file),path.basename(file))
  if(part.segment.type!=='record'||part.mimetype!=='audio/wav'||part.bytes!==before.length)
   throw Error('OneBot envelope invalid')
  const msg=part.segment.data.file
  if(!msg.startsWith('base64://'))throw Error('Not a OneBot base64 record')
  if(digest(Buffer.from(msg.slice(9),'base64'))!==sample.sha256)
   throw Error('OneBot base64 failed round-trip')
  result.push({id:sample.id,bytes:before.length,sha256:sample.sha256,encoded:true,
    actualQqDeliveryChecked:false,rightsGateClosed:true})
 }
 return {pass:true,samplesChecked:result.length,publishable:0,
   actualQqMessagesSent:0,productionUpdated:false,details:result}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args={}
 for(let i=2;i<process.argv.length;i+=2){
  if(!['--index','--adapter','--report'].includes(process.argv[i]))throw Error('Usage --index PATH --adapter PATH --report PATH')
  args[process.argv[i]]=process.argv[i+1]
 }
 const out=path.resolve(args['--report'])
 if(fs.existsSync(out))throw Error('Never overwrite offline audit')
 const r=await checkVoicePack(args['--index'],args['--adapter'])
 fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'})
 console.log(JSON.stringify({pass:r.pass,samplesChecked:r.samplesChecked,actualQqMessagesSent:0}))
}
