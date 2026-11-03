import { spawnSync } from 'node:child_process'

const checks = [
  ['CREDENTIAL', /\b(?:sk-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/],
  ['PRIVATE_KEY', /-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----/],
  ['QQ_ID_OR_PHONE', /(?<![A-Za-z0-9])\d{9,11}(?![A-Za-z0-9])/],
  ['LOCAL_ABSOLUTE_PATH', /[A-Za-z]:\\(?:Users|ProgramData|Documents|FangYuan|下载)\\/],
]
const diffArgs = ['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=ACMTU', '--no-ext-diff', '--no-textconv', '--']

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'buffer', timeout: 10000, maxBuffer: 16 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error('Git ' + args[0] + ' failed')
  return result.stdout
}
function restrictedPath(name) {
  const parts = name.replace(/\\/g, '/').split('/')
  return parts.some(part => (/^\.env(?:\..+)?$/i.test(part) && part.toLowerCase() !== '.env.example') || /^(?:\.aurabot-cache|private|secrets|tokens|node_modules|services|runtime|archive|research)$/i.test(part)) || /\.(?:sqlite3?|db|pem|pfx|key|gguf|safetensors|mp3|wav|mp4)$/i.test(name)
}
function audit() {
  const root = git(['rev-parse', '--show-toplevel']).toString('utf8').trim()
  // Freeze names, modes and object IDs in one snapshot. Renames are deletion + addition.
  const snapshot = git(diffArgs, root)
  const fields = new TextDecoder('utf-8', { fatal: true }).decode(snapshot).split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2) throw new Error('Malformed staged diff')
  let files = 0, blocks = 0, review = 0
  for (let i = 0; i < fields.length; i += 2) {
    const header = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([a-f0-9]{40}|[a-f0-9]{64}) ([AMTU])$/.exec(fields[i])
    const name = fields[i + 1], label = JSON.stringify(name)
    if (!header || !name) throw new Error('Malformed staged entry')
    files++
    if (header[5] === 'U') { console.log('REVIEW unmerged:', label); review++; continue }
    if (restrictedPath(name)) { console.log('BLOCK path:', label); blocks++; continue }
    if (!['100644', '100755'].includes(header[2])) { console.log('REVIEW unsupported_mode:', label); review++; continue }
    // Read the immutable staged blob; never open or follow a working-tree path.
    const blob = git(['cat-file', 'blob', header[4]], root)
    let data
    try {
      data = new TextDecoder('utf-8', { fatal: true }).decode(blob)
      if (data.includes('\0')) throw new Error('Binary content')
    } catch { console.log('REVIEW non_text:', label); review++; continue }
    for (const [type, pattern] of checks) {
      if (pattern.test(data)) { console.log('REVIEW ' + type + ':', label); review++ }
    }
  }
  // An index changed by another writer must not receive a clean result for the old snapshot.
  if (!snapshot.equals(git(diffArgs, root))) throw new Error('Staged index changed; rerun audit')
  console.log('staged_files=' + files + ' blocks=' + blocks + ' review_flags=' + review)
  return blocks || review ? 1 : 0
}
try { process.exitCode = audit() }
catch (error) { console.error('Cannot audit staged files: ' + error.message); process.exitCode = 2 }
