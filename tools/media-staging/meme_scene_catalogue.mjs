/**
 * Build a private scene-tag catalogue for genuine meme reference media.
 * No image editing, QQ send, user chat access, or production selector replacement.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'

const scenes={
 'bear_turn_reference.gif':{name:'熊大回眸',tags:['回眸','抽象','震惊','熟人互损'],edit:'original_only',notes:'动物主体；保留熊大原版回头动作'},
 'cat_smoke_reference.gif':{name:'猫咪气到冒烟',tags:['无语','红温','抽象','生气'],edit:'original_only',notes:'非人主体；保留冒烟与变脸帧'},
 'classic_question_person_reference.jpg':{name:'经典真人问号',tags:['震惊','问号','不是哥们','无语'],edit:'human_local_only',notes:'可尝试局部人像替换；须保留原眼神、帽子和问号分布'},
 'classic_reverse_person_reference.gif':{name:'真人真香反转',tags:['反讽','抽象','憋笑','打脸','真香'],edit:'defer_animation',notes:'52帧表情反转；先验证原作者及许可'},
 'cow_truck_reference.gif':{name:'一车牛来',tags:['抽象','牛来','熟人互损','憋笑'],edit:'original_only',notes:'玩偶主体；保留原版动作'},
 'jiahao_reference.jpg':{name:'嘉豪校园',tags:['抽象','熟人互损','嘉豪','夸赞'],edit:'human_local_only',notes:'保留雨后校园、兜帽口罩、镜头视角和前景手势'},
 'shan_shen_bu_reference.gif':{name:'闪身步',tags:['跑路','闪人','撤了','抽象'],edit:'defer_animation',notes:'101帧动作；不能单纯换成御剑轻功'},
 'wild_dog_milk_reference.jpg':{name:'野生狗奶',tags:['抽象','憋笑','野生狗奶'],edit:'original_only',notes:'包装和文字是笑点，原版保存'},
 'external_not-bro-shark.png':{name:'不是兄弟·蓝鲨鱼',tags:['震惊','不是哥们','电脑','无语'],edit:'original_only',notes:'卡通非人主体，原图参照；传播权未核验'},
 'external_not-bro-tom.jpg':{name:'不是哥们·汤姆',tags:['震惊','不是哥们','抽象','离谱'],edit:'original_only',notes:'动画版权角色仅私下研究，暂不发布'},
 'external_elegant-penguin.jpg':{name:'高雅人士企鹅',tags:['反讽','高雅人士','优雅','抽象','大聪明'],edit:'original_only',notes:'3Dalia/Shutterstock 商用素材风险，暂不发布'}
};
const md5=b=>crypto.createHash('md5').update(b).digest('hex')
const sha=b=>crypto.createHash('sha256').update(b).digest('hex')
function owner(dir){
 const marker=path.join(dir,'.fangyuan-media-staging-root.json')
 const v=JSON.parse(fs.readFileSync(marker,'utf8').replace(/^\uFEFF/,''))
 if(v.purpose!=='isolated-fangyuan-media-staging'||v.allowNewChildren!==true)throw Error('Untrusted output owner')
}
export async function makeCatalogue({shadowRoot,outputDir,selectorPath}){
 const src=fs.realpathSync(path.join(shadowRoot,'meme_pipeline_lab','originals'))
 const index=JSON.parse(fs.readFileSync(path.join(shadowRoot,'meme_pipeline_lab','全部素材_逐帧格式与指纹核验.json'),'utf8'))
 const target=path.resolve(outputDir)
 if(fs.existsSync(target))throw Error('Output exists; refuses overwrite')
 owner(path.dirname(target))
 const inputs=index.items.filter(x=>x.path.startsWith('originals/'))
 const entries=[]
 for(const x of inputs){
  const file=path.join(src,path.basename(x.path))
  const base=path.basename(file),spec=scenes[base]
  if(!spec)throw Error('Unrecognized original; requires editorial review: '+base)
  if(!fs.existsSync(file))throw Error('Original missing: '+base)
  const bytes=fs.readFileSync(file)
  if(sha(bytes)!==x.sha256)throw Error('Original SHA failed: '+base)
  entries.push({
   id:sha(bytes).slice(0,24),name:spec.name,file,md5:md5(bytes),sha256:x.sha256,
   tags:spec.tags,editPolicy:spec.edit,notes:spec.notes,
   originalFrames:x.frames,format:x.format,
   originalMediaConfirmed:true,
   rightsVerified:false,productionReady:false,qqReady:false
  })
 }
 if(entries.length!==11)throw Error('Unexpected source size')
 const selector=await import(pathToFileURL(fs.realpathSync(selectorPath)).href)
 if(typeof selector.proposeSticker!=='function')throw Error('Selector interface unavailable')
 const dialogues=[
  {text:'不是哥们你这也行',type:'surprise',expectOne:true},
  {text:'哈哈哈这下真的笑死了',type:'humour',expectOne:true},
  {text:'我先撤了，明天再聊',type:'leaving',expectOne:true},
  {text:'太抽象了，这都能发生',type:'abstract',expectOne:true},
  {text:'我家人现在医院抢救',type:'emergency',expectOne:false},
  {text:'我在看蛊真人原著',type:'irrelevant',expectOne:false}
 ]
 const samples=dialogues.map(({text,type,expectOne})=>{
  const result=selector.proposeSticker({text,items:entries,scope:'private',explicit:false,
     lastSentAt:null,lastAssetIds:[],candidatePool:'existing'})
  return {type,input:text,chosen:result.selected?.name??null,reason:result.reason,
    expectationMet:Boolean(result.selected)===expectOne,qqSent:false}
 })
 if(samples.some(x=>!x.expectationMet))throw Error('Existing selector did not pass scene compatibility; inspect catalogue tags')
 const manifest={schema:1,sourceRoot:shadowRoot,entries,
   tests:samples,approvedEntries:0,productionReady:false,qqReady:false,
   warning:'Tags and source hashes are for isolated development, not publication rights or content acceptance.'}
 fs.mkdirSync(target)
 try{
  fs.writeFileSync(path.join(target,'SEMANTIC_STAGING_FINAL.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'})
  fs.writeFileSync(path.join(target,'README.md'),'Private scene-tag proposals for eleven real reference originals. No QQ sending, media edits or rights approvals. All reference assets remain in isolated shadow source.\n',{flag:'wx'})
 }catch(e){fs.rmSync(target,{recursive:true,force:true});throw e}
 return {files:entries.length,tests:samples.length,matched:samples.filter(x=>x.expectationMet).length,
   approved:0,qqSent:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const a={}
 for(let i=2;i<process.argv.length;i+=2){if(!['--shadow','--out','--selector'].includes(process.argv[i])||!process.argv[i+1])throw Error('Arguments incomplete');a[process.argv[i]]=process.argv[i+1]}
 console.log(JSON.stringify(await makeCatalogue({shadowRoot:a['--shadow'],outputDir:a['--out'],selectorPath:a['--selector']}),null,2))
}
