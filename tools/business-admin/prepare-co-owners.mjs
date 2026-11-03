#!/usr/bin/env node
// Explicitly granted co-owners share the existing owner level. Prepare a separate fork only.
import {readFileSync,writeFileSync,existsSync,mkdirSync,cpSync,symlinkSync,realpathSync} from 'node:fs'
import {resolve,relative,isAbsolute,join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1]
if(!args.includes('--source')||!args.includes('--out'))throw Error('Provide --source verified-native-fork --out new-separate-directory')
const source=realpathSync(resolve(value('--source'))),out=resolve(value('--out'))
const contains=(a,b)=>{const x=relative(a,b);return !x||!x.startsWith('..')&&!isAbsolute(x)}
if(existsSync(out)||contains(source,out)||contains(out,source))throw Error('Output must be absent and separate')
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),changes=new Map()
function edit(file,before,after){
  let text=changes.get(file)??readFileSync(join(source,file),'utf8').replaceAll('\r\n','\n')
  if(text.split(before).length!==2)throw Error('Unsupported native anchor: '+file+' '+before.slice(0,60))
  changes.set(file,text.replace(before,after))
}
edit('src/chat/access.js',"export const LEVELS = ['full', 'social', 'chat']","import { isFullOwner } from './principal-policy.js'\nexport const LEVELS = ['full', 'social', 'chat']")
edit('src/chat/access.js',"if (msg.userId === owner) return { allowed: true, reason: '主人' }","if (isOwner(cfg, msg.userId)) return { allowed: true, reason: '所有者' }")
edit('src/chat/access.js',"chat.kind === 'private' && chat.userId === owner","chat.kind === 'private' && isOwner(cfg, chat.userId)")
edit('src/chat/access.js',"return String(userId || '') !== '' && String(userId) === String(cfg.ownerQQ || '')","return isFullOwner(cfg, String(userId || ''))")
edit('src/chat/access.js',"chat.kind === 'private' && String(chat.userId) === String(cfg.ownerQQ || '')","chat.kind === 'private' && isOwner(cfg, chat.userId)")
edit('src/core/modules.js',"import { defineTool } from '../tools/tools.js'","import { defineTool } from '../tools/tools.js'\nimport { isOwner } from '../chat/access.js'")
edit('src/core/modules.js',"isOwner: (userId) => String(userId) === String(getConfig().ownerQQ)","isOwner: (userId) => isOwner(getConfig(), userId)")
edit('src/chat/hub.js','    supportsBusinessAdministration: true,','    supportsBusinessAdministration: true,\n    supportsCoOwners: true,')
edit('src/chat/hub.js','    const offs = []',`    const offs = []
    if (level === 'full') offs.push(dsh.on('tools/pre-execute', (exec, next) => {
      const executing = sessionKey(exec.agent?.session?.id || '')
      if (executing !== sid) return next()
      if (chat.kind !== 'private' || levelFor(getConfig(), chat) !== 'full' || !isOwner(getConfig(), chat.userId) || !turnSendersAllOwner(sid)) {
        return { kind: 'deny', reason: '当前会话或实际操作者已无所有者电脑权限，停止执行' }
      }
      return next()
    }))`)
edit('src/chat/commands.js',"about: cfg.ownerQQ, importance: 0.8, source: 'panel', chatId: msg.chatId","about: String(msg.userId), importance: 0.8, source: 'panel', chatId: msg.chatId")
edit('src/security/danger.js',"const ownerChat = owner ? `private:${owner}` : ''","const ownerChat = chatId.startsWith('private:') && isOwner({ ...cfg, ownerQQ: cfg.ownerQQ || owner }, chatId.slice(8)) ? chatId : ''")
edit('src/security/danger.js',"if (!isOwner({ ownerQQ: owner }, userId)) return false","if (String(chatId) !== 'private:' + String(userId) || !isOwner({ ...getConfig(), ownerQQ: getConfig()?.ownerQQ || owner }, userId)) return false")
edit('src/security/danger.js',"    if (ok) {","    if (ok && isOwner({ ...getConfig(), ownerQQ: getConfig()?.ownerQQ || owner }, chatId.slice(8))) {")
// Protect either owner from group moderation, and expose the same contact scope.
edit('src/modules/group-admin/index.js',"String(uid) === String(cfg.ownerQQ)","isOwner(cfg, uid)")
const group=changes.get('src/modules/group-admin/index.js')
if(!/import.*\bisOwner\b/.test(group))changes.set('src/modules/group-admin/index.js',"import { isOwner } from '../../chat/access.js'\n"+group)
edit('src/modules/contacts/index.js',"k === 'private' && n === String(cfg.ownerQQ || '')","k === 'private' && isOwner(cfg, n)")
const contacts=changes.get('src/modules/contacts/index.js')
if(!/import.*\bisOwner\b/.test(contacts))changes.set('src/modules/contacts/index.js',"import { isOwner } from '../../chat/access.js'\n"+contacts)
edit('src/core/bridge.js',"kind === 'private' && id === cfg.ownerQQ","kind === 'private' && isOwner(cfg, id)")
const bridge=changes.get('src/core/bridge.js')
if(!/import.*\bisOwner\b/.test(bridge))changes.set('src/core/bridge.js',"import { isOwner } from '../chat/access.js'\n"+bridge)
mkdirSync(dirname(out),{recursive:true})
cpSync(source,out,{recursive:true,filter:p=>!relative(source,p).split(/[\\/]/).some(x=>['node_modules','.git','.aurabot-cache'].includes(x))})
if(existsSync(join(source,'node_modules')))symlinkSync(join(source,'node_modules'),join(out,'node_modules'),'junction')
for(const [name,text] of changes)writeFileSync(join(out,name),text)
writeFileSync(join(out,'src/chat/principal-policy.js'),readFileSync(join(repo,'src/fangyuan-agent/modules/principals/policy.mjs')))
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const manifest={source,productionWrites:0,changed:[...changes.keys(),'src/chat/principal-policy.js'].map(name=>({name,before:sha(join(source,name)),after:sha(join(out,name))})),scope:'explicit co-owners; groups retain social level; notification defaults stay primary owner'}
writeFileSync(join(out,'co-owner-preparation.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({prepared:true,changedFiles:manifest.changed.length,productionWrites:0}))
