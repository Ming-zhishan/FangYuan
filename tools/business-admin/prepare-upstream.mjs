#!/usr/bin/env node
/** Prepare an isolated upstream copy. Never edit the input checkout or a running host. */
import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const args = process.argv.slice(2), get = name => args[args.indexOf(name) + 1]
if (!args.includes('--source') || !args.includes('--out')) throw new Error('Provide --source verified-upstream --out new-isolated-directory')
const source = realpathSync(resolve(get('--source'))), out = resolve(get('--out'))
const contains = (a, b) => { const r = relative(a, b); return !r || !r.startsWith('..') && !isAbsolute(r) }
if (existsSync(out) || contains(source, out) || contains(out, source)) throw new Error('Output must be new and separate from source')
const hub = join(source, 'src/chat/hub.js'), original = readFileSync(hub, 'utf8').replaceAll('\r\n','\n')
let candidate = original
function replaceOnce(before, after) {
  if (candidate.split(before).length !== 2) throw new Error('Unsupported upstream anchor; review before preparing')
  candidate = candidate.replace(before, after)
}
replaceOnce("import { checkAllowed, levelFor, presetFor, isOwner } from './access.js'", "import { checkAllowed, levelFor, presetFor, isOwner } from './access.js'\nimport { businessCommandAllowed, isManager } from './principal-policy.js'\nimport { parseCommand } from './commands.js'")
replaceOnce("    if (onCommand && isOwner(cfg, msg.userId) && /^\\s*[/／]/.test(msg.text)) {", "    const businessCommand = parseCommand(msg.text, [{ name: 'admin', aliases: ['管理', '权限'] }])\n    if (onCommand && (isOwner(cfg, msg.userId) || businessCommandAllowed(cfg, msg, businessCommand?.name)) && /^\\s*[/／]/.test(msg.text)) {")
replaceOnce('  function chatOfSession(sessionId) {', "  function turnSendersAllManagers(sessionId) {\n    const st = turnState.get(sessionKey(sessionId))\n    if (!st || !st.senders.size) return false\n    return [...st.senders].every(uid => isManager(getConfig(), String(uid)))\n  }\n\n  function chatOfSession(sessionId) {")
replaceOnce('    turnSendersAllOwner,', '    turnSendersAllOwner,\n    turnSendersAllManagers,\n    supportsBusinessAdministration: true,')
replaceOnce('hooks.groupDecide(decision, { msg, policy: pol, recentTexts, memScore })', 'hooks.groupDecide(decision, { msg: { ...msg, raw: event }, policy: pol, recentTexts, memScore })')
mkdirSync(dirname(out), { recursive: true })
cpSync(source, out, { recursive: true, filter: path => !['node_modules','.git','.aurabot-cache'].some(name => relative(source,path).split(/[\\/]/).includes(name)) })
if (existsSync(join(source, 'node_modules'))) symlinkSync(join(source, 'node_modules'), join(out, 'node_modules'), 'junction')
writeFileSync(join(out, 'src/chat/hub.js'), candidate)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const policy = readFileSync(join(repo, 'src/fangyuan-agent/modules/principals/policy.mjs'), 'utf8')
writeFileSync(join(out, 'src/chat/principal-policy.js'), policy)
const sha = s => createHash('sha256').update(s).digest('hex')
writeFileSync(join(out, 'business-admin-preparation.json'), JSON.stringify({ sourceHubSha256: sha(original), candidateHubSha256: sha(candidate), policySha256: sha(policy), scope: 'isolated upstream preparation; not deployed; owner/full access unchanged' }, null, 2))
console.log(JSON.stringify({ prepared: true, productionWrites: 0, nativeChanges: ['bounded business command admission','all-manager sender check','authenticated targets at pre-admission hook'], fullAccessChanged: false }))
