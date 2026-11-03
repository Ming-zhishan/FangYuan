/** Deterministic preview-only sticker selector.
 * No external model, QQ, timers or persistent access. Produces a proposal, never sends.
 */
const MODES={
 '憋笑':[/笑死|绷不住|憋笑|想笑|蚌埠住|哈哈哈|哈哈哈哈|笑喷|太好笑/],
 '震惊':[/不是哥们|我嘞个|这也行|真的假的|震惊|离谱|逆天|我靠|卧槽|发生甚么事了/],
 '无语':[/无语|沉默|难评|这都能|服了|尴尬|怎么敢|没眼看/],
 '熟人互损':[/你也配|你急了|乐子人|菜成|坑我|你又来|嘴硬|憋装|自信点|别吹/],
 '抽象':[/抽象|鬼图|入典|啥玩意|笑不活|牛的|真有你的|整活|整挺好|怪起来/],
 '跑路':[/溜了|先走|跑路|下线|下了|拜拜|撤了|回见|溜溜球|闪人/],
 '倒霉':[/倒霉|太衰|非酋|没抽到|破防|抽卡|寄了|不顺|好惨/],
 '招呼':[/早安|早上好|晚上好|晚安|来了|好久不见|上线了/],
 '送别':[/再见|睡了|走了|晚安|拜拜|明天见|下了/],
 '不服':[/不服|来打我|来碰|你敢|这不对|怎么不服|凭什么/],
 '婉拒':[/不了|不行|不愿意|拒绝|别叫我|不想|别找我/],
 '夸赞':[/厉害|牛逼|牛啊|太强了|帅爆|好活|不错嘛/],
 '讨价还价':[/v我50|V我50|转账|红包|请客|买单|价钱|多少钱/],
 '想念':[/想你|想死你|好久不见|好久没见|在哪里/],
 '自嘲':[/我怎么|我真是|我又|自嘲|丢人|小丑竟是我/],
 '反讽':[/真是好|好一个|原来如此|啊对对对|你说得对|大聪明/]
};
const WEAK=new Set(['蛊真人','玩笑','虚构恶搞','现代','表情','大爱仙尊','蛊界','熟人玩笑','身份玩笑','安利','看书','目标','执念']);
const serious=/(?:考试出分|抑郁|自杀|身亡|医院抢救|亲人去世|身份证|密码|验证码|急诊|火灾|被诈骗|刑事案件|银行账号|身体剧痛|求救)/;
function allMatches(text,regexes){return regexes.some(re=>re.test(text))}
export function inferIntents(text){
 const s=String(text||'').slice(-2000);
 return Object.keys(MODES).filter(key=>allMatches(s,MODES[key]));
}
export function proposeSticker({text='',lastUserText='',items=[],scope='group',now=Date.now(),lastSentAt=null,
 lastAssetIds=[],explicit=false,candidatePool='existing',cooldownMs=9*60_000}={}){
 const words=String(text||'').slice(0,2000);
 const user=String(lastUserText||'').slice(0,1200);
 if(!explicit&&(serious.test(user)||serious.test(words)))return {selected:null,reason:'sensitive_or_serious'};
 if(!explicit&&lastSentAt!=null&&now-lastSentAt<cooldownMs)return {selected:null,reason:'cooldown'};
 const intents=inferIntents(words+' '+user);
 // The existing library contains many generic "蛊真人" tags. These alone do not justify stickers.
 const candidates=[];
 for(const item of items){
  if(!item?.md5||!item.file)continue;
  const tags=[item.name,...(item.tags||[])].map(x=>String(x||'').trim()).filter(Boolean);
  const found=[...new Set(intents.filter(intent=>tags.some(tag=>tag===intent||tag.includes(intent)&&tag.length<=8)))];
  const explicitName=explicit&&tags.some(tag=>tag!==''&&((words+' '+user).includes(tag))&&!WEAK.has(tag));
  const concreteMatches=tags.filter(tag=>!WEAK.has(tag)&&tag.length>=2&&tag.length<=12&&((words+' '+user).includes(tag)));
  if(!found.length&&!explicitName&&!concreteMatches.length)continue;
  const penalty=lastAssetIds.slice(-6).includes(item.md5)?8:0;
  const score=found.length*4+(explicitName?7:0)+Math.min(3,concreteMatches.length)*2-penalty;
  if(score<4)continue;
  candidates.push({itemId:item.md5,name:item.name,score,intents:found,asset:item});
 }
 candidates.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'zh'));
 if(!candidates.length)return {selected:null,reason:'no_confident_semantic_match',intents};
 const first=candidates[0];
 return {selected:{md5:first.itemId,name:first.name,file:first.asset.file},reason:'semantic_match',
  score:first.score,intents:first.intents,candidatesConsidered:candidates.length,
  caveat:'proposal only, no QQ sending, no automatic content import'};
}
export function addSceneFeedback(db,{scene,assetId,outcome,at=Date.now(),evidence=''}){
 if(!['useful','ignored','awkward','repeat','unknown'].includes(outcome))throw new Error('invalid_feedback');
 if(!/^[a-f0-9]{32}$/i.test(assetId))throw new Error('invalid_asset');
 if(typeof scene!=='string'||scene.length>120)throw new Error('invalid_scene');
 db.exec("CREATE TABLE IF NOT EXISTS scene_feedback(id TEXT PRIMARY KEY,asset_id TEXT,scene TEXT,outcome TEXT,at INTEGER,evidence TEXT)");
 const id=[assetId,scene,at].join('|');
 const statement=db.prepare('INSERT OR IGNORE INTO scene_feedback VALUES(?,?,?,?,?,?)');
 statement.run(id,assetId,scene,outcome,at,String(evidence).slice(0,200));
 return {stored:true, note:'Feedback must come from observed use, not heuristic guesswork'};
}
