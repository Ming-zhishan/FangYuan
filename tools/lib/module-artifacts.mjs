import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))
const canonical = 'src/fangyuan-agent/modules', overrides = 'src/aurabot-runtime-overrides'
const card = 'src/fangyuan-agent/personas/gu-yue-fang-yuan.md', config = 'src/fangyuan-agent/config.patch.json'
const excluded = new Set(['conversation/voice-examples.txt'])
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const inside = (parent, child) => { const rel = path.relative(parent, child); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) }
const fail = code => { throw Error(code) }
const gitEnvironment = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete gitEnvironment[key]
function git(root, args, optional = false) {
  const result = spawnSync('git', ['-C', root, ...args], { env: gitEnvironment, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
  if (result.error || result.status !== 0) { if (optional) return null; fail('git_input_unavailable') }
  return result.stdout
}
function readSource(root, relative) {
  if (path.posix.normalize(relative) !== relative || relative.startsWith('../') || path.isAbsolute(relative) || relative.includes('\\')) fail('invalid_source_path')
  if (relative.split('/').some(x => /^(?:private|secrets|node_modules|modules-data|logs|backups|\.git|\.aurabot-cache)$/i.test(x) || /^\.env(?:\.|$)/i.test(x))) fail('restricted_source_path')
  if (!/\.(?:mjs|js|json|txt|md|ts)$/.test(relative)) fail('unsupported_source_type')
  let current = root
  const parts = relative.split('/')
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i])
    const entry = fs.lstatSync(current)
    if (entry.isSymbolicLink() || (i < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())) fail('unsupported_source_entry')
  }
  const bytes = fs.readFileSync(current), text = bytes.toString('utf8')
  if (bytes.includes(0) || !Buffer.from(text).equals(bytes)) fail('non_utf8_source')
  return Buffer.from(text.replace(/\r\n/g, '\n'))
}
function tracked(root, prefix) {
  return git(root, ['ls-files', '-z', '--', prefix]).split('\0').filter(Boolean).sort().map(source => ({
    relative: source.slice(prefix.length + 1), source, bytes: readSource(root, source)
  }))
}
export function planBundle({ root = repositoryRoot, profile = 'runtime' } = {}) {
  if (!['development', 'runtime'].includes(profile)) fail('invalid_profile')
  root = fs.realpathSync(root)
  const files = new Map()
  for (const entry of tracked(root, canonical)) if (profile !== 'runtime' || !excluded.has(entry.relative)) files.set('modules/' + entry.relative, entry)
  if (!files.size) fail('canonical_source_empty')
  if (profile === 'runtime') for (const entry of tracked(root, overrides)) {
    const previous = files.get('modules/' + entry.relative)
    if (previous?.bytes.equals(entry.bytes)) fail('redundant_runtime_override')
    files.set('modules/' + entry.relative, entry)
  }
  files.set('personas/gu-yue-fang-yuan.md', { source: card, bytes: readSource(root, card) })
  files.set('config.patch.json', { source: config, bytes: readSource(root, config) })
  const persona = files.get('personas/gu-yue-fang-yuan.md').bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/^---\n[\s\S]*?\n---\n?/, '').trim()
  const core = files.get('modules/fangyuan/core.txt')?.bytes.toString('utf8').trim()
  const provenance = JSON.parse(files.get('modules/fangyuan/core-provenance.json')?.bytes.toString('utf8') || '{}')
  if (core !== persona || provenance.sourceSha256 !== sha(persona) || !provenance.compression?.startsWith('none;')) fail('persona_core_out_of_sync')
  const template = JSON.parse(files.get('config.patch.json').bytes.toString('utf8'))
  if (template.enabled !== false || template.dryRun !== true) fail('template_must_remain_disabled')
  const inventory = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, entry]) => ({ path: file, source: entry.source, sha256: sha(entry.bytes) }))
  const manifest = { format_version: 1, profile, scope: 'module_bundle_not_deployment', normalization: 'UTF8_CRLF_to_LF',
    source_revision: git(root, ['rev-parse', '--verify', 'HEAD'], true)?.trim() || null,
    source_dirty: !!git(root, ['status', '--porcelain', '--untracked-files=no', '--', canonical, overrides, card, config]).trim(),
    module_files: inventory.filter(x => x.path.startsWith('modules/')).length,
    content_sha256: sha(profile + '\n' + inventory.map(x => x.path + '\0' + x.sha256).join('\n')), files: inventory }
  return { root, files, manifest }
}
function destination(root, out) {
  const absolute = path.resolve(out)
  if (fs.existsSync(absolute)) fail('output_already_exists')
  let cursor = absolute
  const missing = []
  while (!fs.existsSync(cursor)) { missing.unshift(path.basename(cursor)); const parent = path.dirname(cursor); if (parent === cursor) fail('output_parent_unavailable'); cursor = parent }
  if (!fs.statSync(cursor).isDirectory()) fail('output_parent_unavailable')
  const resolved = path.join(fs.realpathSync(cursor), ...missing)
  const protectedPaths = ['src', 'tools', 'docs', 'config', 'operations', 'runtime', 'services', '.git'].map(x => path.join(root, x))
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']).trim()
  const commonDir = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']).trim())
  for (const protectedPath of [...protectedPaths, gitDir, commonDir]) if (inside(protectedPath, resolved) || inside(resolved, protectedPath)) fail('output_overlaps_protected_tree')
  return absolute
}
export function buildBundle({ root = repositoryRoot, profile = 'runtime', out } = {}) {
  const plan = planBundle({ root, profile })
  if (!out) return { mode: 'plan', ...plan.manifest }
  const target = destination(plan.root, out)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.mkdirSync(target)
  for (const [relative, entry] of plan.files) {
    const file = path.join(target, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, entry.bytes, { flag: 'wx' })
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(plan.manifest, null, 2) + '\n', { flag: 'wx' })
  return { mode: 'built', ...plan.manifest }
}
