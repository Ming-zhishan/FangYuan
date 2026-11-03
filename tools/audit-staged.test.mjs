import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./audit-staged.mjs', import.meta.url))
const rangeScript = fileURLToPath(new URL('./audit-range.mjs', import.meta.url))
// Generated scanner markers only; no account data, private files or credentials.
const marker = 'sk-' + 'a'.repeat(24)
const env = { ...process.env }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_COMMON_DIR', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete env[key]

function fixture(t, initialize = true, prefix = 'fangyuan-audit-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  t.after(() => {
    const target = resolve(dir)
    assert.equal(dirname(target), resolve(tmpdir()))
    assert.ok(basename(target).startsWith('fangyuan-audit-test-'))
    rmSync(target, { recursive: true, force: true })
  })
  const git = (args, input, extraEnv = {}) => {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=' + join(dir, 'empty-hooks'), '-c', 'commit.gpgsign=false', '-c', 'user.name=Audit Fixture', '-c', 'user.email=audit@example.invalid', ...args], { cwd: dir, env: { ...env, ...extraEnv }, input, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  if (initialize) git(['init', '--quiet'])
  const write = (name, text) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text) }
  const stage = (name, text) => { write(name, text); git(['add', '--', name]) }
  const audit = (cwd = dir, extraEnv = {}) => spawnSync(process.execPath, [script], { cwd, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000 })
  const range = (base, target, extraEnv = {}) => spawnSync(process.execPath, [rangeScript, base, target], { cwd: dir, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 30000 })
  return { dir, git, write, stage, audit, range }
}
function expectExit(result, code, pattern) {
  assert.equal(result.status, code, result.stdout + result.stderr)
  if (pattern) assert.match(result.stdout + result.stderr, pattern)
  assert.ok(!result.stdout.includes(marker), 'diagnostics must never print matched contents')
}

test('staged content is reviewed even when the working file is clean', t => {
  const f = fixture(t); f.stage('sample.md', marker); f.write('sample.md', 'safe\n')
  expectExit(f.audit(), 1, /REVIEW CREDENTIAL/)
})
test('a clean index is accepted despite an unstaged working credential marker', t => {
  const f = fixture(t); f.stage('sample.md', 'safe\n'); f.write('sample.md', marker)
  expectExit(f.audit(), 0, /staged_files=1 blocks=0 review_flags=0/)
})
test('a missing working file does not hide its staged content', t => {
  const f = fixture(t); f.stage('sample.md', marker); unlinkSync(join(f.dir, 'sample.md'))
  expectExit(f.audit(), 1, /REVIEW CREDENTIAL/)
})
test('a safe staged file can be audited after its working copy is deleted', t => {
  const f = fixture(t); f.stage('sample.md', 'safe\n'); unlinkSync(join(f.dir, 'sample.md'))
  expectExit(f.audit(), 0)
})
test('nested invocation handles repository-relative paths and Chinese filenames', t => {
  const f = fixture(t, true, 'fangyuan-audit-test-资料 空格-'); f.stage('资料/带 空格.md', 'safe\n'); mkdirSync(join(f.dir, 'nested'))
  expectExit(f.audit(join(f.dir, 'nested')), 0, /staged_files=1/)
})
test('an unborn repository with nothing staged passes', t => {
  expectExit(fixture(t).audit(), 0, /staged_files=0 blocks=0 review_flags=0/)
})
test('a staged rename scans the destination blob rather than the working file', t => {
  const f = fixture(t); f.stage('old.md', 'safe\n'); f.git(['commit', '--quiet', '-m', 'fixture'])
  f.git(['mv', '--', 'old.md', 'new name.md']); f.stage('new name.md', marker); f.write('new name.md', 'safe\n')
  expectExit(f.audit(), 1, /REVIEW CREDENTIAL/)
})
test('staged deletion does not require reading a removed file', t => {
  const f = fixture(t); f.stage('old.md', marker); f.git(['commit', '--quiet', '-m', 'fixture']); f.git(['rm', '--', 'old.md'])
  expectExit(f.audit(), 0, /staged_files=0/)
})
test('restricted staged paths are blocked even without a working copy', t => {
  const f = fixture(t); f.stage('private/notes.md', 'safe\n'); unlinkSync(join(f.dir, 'private/notes.md'))
  expectExit(f.audit(), 1, /BLOCK path/)
})
test('an environment template is allowed but an environment override is blocked', t => {
  const f = fixture(t); f.stage('config/.env.example', 'EXAMPLE=placeholder\n')
  expectExit(f.audit(), 0)
  f.stage('config/.env.production', 'EXAMPLE=placeholder\n')
  expectExit(f.audit(), 1, /BLOCK path/)
})
test('symlink entries require review without following a filesystem target', t => {
  const f = fixture(t); const sha = f.git(['hash-object', '-w', '--stdin'], 'absent-target\n')
  f.git(['update-index', '--add', '--cacheinfo', '120000,' + sha + ',link.md'])
  expectExit(f.audit(), 1, /REVIEW unsupported_mode/)
})
test('gitlink entries require review rather than an unreadable blob pass', t => {
  const f = fixture(t); f.git(['commit', '--quiet', '--allow-empty', '-m', 'fixture']); const sha = f.git(['rev-parse', 'HEAD'])
  f.git(['update-index', '--add', '--cacheinfo', '160000,' + sha + ',vendor'])
  expectExit(f.audit(), 1, /REVIEW unsupported_mode/)
})
test('invalid UTF-8 staged content requires review', t => {
  const f = fixture(t); f.stage('sample.md', Buffer.from([0xff, 0xfe]))
  expectExit(f.audit(), 1, /REVIEW non_text/)
})
test('outside a Git worktree exits with an operational error', t => {
  expectExit(fixture(t, false).audit(), 2, /Cannot audit staged files/)
})
test('an unresolved index cannot report a clean audit', t => {
  const f = fixture(t); const sha = f.git(['hash-object', '-w', '--stdin'], 'safe\n')
  f.git(['update-index', '--index-info'], [1, 2, 3].map(stage => '100644 ' + sha + ' ' + stage + '\tconflict.md\n').join(''))
  expectExit(f.audit(), 1, /REVIEW unmerged/)
})
test('the explicitly selected Git index is audited independently', t => {
  const f = fixture(t); f.stage('sample.md', 'safe\n'); f.write('sample.md', marker)
  const selected = { GIT_INDEX_FILE: join(f.dir, 'alternate-index') }
  f.git(['add', '--', 'sample.md'], undefined, selected)
  expectExit(f.audit(f.dir, selected), 1, /REVIEW CREDENTIAL/)
  expectExit(f.audit(), 0)
})
test('a missing staged object is an operational error, never a clean audit', t => {
  const f = fixture(t)
  f.git(['update-index', '--add', '--cacheinfo', '100644,' + '1'.repeat(40) + ',missing.md'])
  expectExit(f.audit(), 2, /Cannot audit staged files/)
})
test('range audit checks new changes without rescanning inherited legacy contents', t => {
  const f = fixture(t); f.stage('legacy.md', marker); f.git(['commit', '--quiet', '-m', 'baseline'])
  const base = f.git(['rev-parse', 'HEAD'])
  f.stage('new.md', 'safe\n'); f.git(['commit', '--quiet', '-m', 'target'])
  const before = f.git(['worktree', 'list', '--porcelain'])
  expectExit(f.range(base, f.git(['rev-parse', 'HEAD'])), 0)
  assert.equal(f.git(['worktree', 'list', '--porcelain']), before)
})
test('range audit catches committed contents and preserves the callers working tree and index', t => {
  const f = fixture(t); f.stage('sample.md', 'safe\n'); f.git(['commit', '--quiet', '-m', 'baseline'])
  const base = f.git(['rev-parse', 'HEAD'])
  f.stage('sample.md', marker); f.git(['commit', '--quiet', '-m', 'target']); f.write('sample.md', 'unstaged\n')
  const before = f.git(['status', '--porcelain']), views = f.git(['worktree', 'list', '--porcelain'])
  expectExit(f.range(base, f.git(['rev-parse', 'HEAD'])), 1, /REVIEW CREDENTIAL/)
  assert.equal(f.git(['status', '--porcelain']), before)
  assert.equal(f.git(['worktree', 'list', '--porcelain']), views)
})
test('range audit rejects invalid revisions without changing repository state', t => {
  const f = fixture(t); const before = f.git(['status', '--porcelain'])
  expectExit(f.range('--invalid', 'HEAD'), 2, /Provide two full commit IDs/)
  assert.equal(f.git(['status', '--porcelain']), before)
})
test('range audit isolates inherited Git context and leaves an alternate index unchanged', t => {
  const f = fixture(t); f.stage('sample.md', 'safe\n'); f.git(['commit', '--quiet', '-m', 'baseline'])
  const base = f.git(['rev-parse', 'HEAD'])
  f.stage('sample.md', marker); f.git(['commit', '--quiet', '-m', 'target'])
  const alternate = join(f.dir, 'alternate-index'), original = readFileSync(join(f.dir, '.git/index'))
  writeFileSync(alternate, original)
  expectExit(f.range(base, f.git(['rev-parse', 'HEAD']), { GIT_DIR: join(f.dir, '.git'), GIT_WORK_TREE: f.dir, GIT_INDEX_FILE: alternate }), 1, /REVIEW CREDENTIAL/)
  assert.deepEqual(readFileSync(alternate), original)
  assert.deepEqual(readFileSync(join(f.dir, '.git/index')), original)
})
