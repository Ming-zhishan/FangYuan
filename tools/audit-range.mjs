import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [base, target] = process.argv.slice(2)
const valid = s => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s || '')
const env = { ...process.env }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete env[key]
let temporary, view, attached = false
function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', timeout: 30000 })
  if (r.error || r.status !== 0) throw Error('Git ' + args[0] + ' failed')
  return r.stdout.trim()
}
try {
  if (!valid(base) || !valid(target) || process.argv.length !== 4) throw Error('Provide two full commit IDs')
  const root = git(['rev-parse', '--show-toplevel'])
  for (const sha of [base, target]) git(['rev-parse', '--verify', sha + '^{commit}'], root)
  temporary = mkdtempSync(join(tmpdir(), 'fangyuan-audit-range-'))
  view = join(temporary, 'view')
  // No source checkout or dependency installation; the original index stays untouched.
  git(['worktree', 'add', '--detach', '--no-checkout', view, base], root)
  attached = true
  git(['read-tree', target], view)
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./audit-staged.mjs', import.meta.url))], { cwd: view, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 })
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  if (r.error || ![0, 1, 2].includes(r.status)) throw Error('Staged audit failed')
  process.exitCode = r.status
} catch (error) { console.error('Cannot audit commit range: ' + error.message); process.exitCode = 2 }
finally {
  try {
    if (temporary) {
      if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('fangyuan-audit-range-')) throw Error('Unexpected temporary root')
      if (attached) {
        if (relative(realpathSync(temporary), realpathSync(view)) !== 'view') throw Error('Unexpected temporary worktree')
        git(['worktree', 'remove', '--force', view])
      }
      rmSync(temporary, { recursive: true, force: true })
    }
  } catch { console.error('Temporary audit worktree cleanup failed; inspect task-owned temporary files'); process.exitCode = 2 }
}
