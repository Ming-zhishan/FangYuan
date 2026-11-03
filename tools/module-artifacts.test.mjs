import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { buildBundle, planBundle, repositoryRoot } from './lib/module-artifacts.mjs'

const canonical = 'src/fangyuan-agent/modules', overrides = 'src/aurabot-runtime-overrides'
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'fangyuan-bundle-test-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()))
    assert.ok(path.basename(root).startsWith('fangyuan-bundle-test-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_PREFIX']) delete env[key]
  const git = (...args) => {
    const r = spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', timeout: 10000 })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), content) }
  git('init', '--quiet')
  git('config', 'core.autocrlf', 'false')
  write(canonical + '/fangyuan/core.txt', 'Synthetic persona\r\n')
  write(canonical + '/fangyuan/core-provenance.json', JSON.stringify({ sourceSha256: createHash('sha256').update('Synthetic persona').digest('hex'), compression: 'none; synthetic fixture' }))
  write(canonical + '/mood/index.mjs', 'export default { profile: "development" }\r\n')
  write(canonical + '/conversation/voice-examples.txt', 'development-only\r\n')
  write(overrides + '/mood/index.mjs', 'export default { profile: "runtime" }\n')
  write(overrides + '/learning/cost_policy.json', '{"guard":true}\n')
  write('src/fangyuan-agent/personas/gu-yue-fang-yuan.md', '---\r\nname: Synthetic\r\n---\r\nSynthetic persona\r\n')
  write('src/fangyuan-agent/config.patch.json', '{"enabled":false,"dryRun":true}\n')
  git('add', '--all')
  return { root, git, write }
}

test('plan reads tracked sources without writing or refreshing the caller index', t => {
  const f = fixture(t), before = fs.readFileSync(path.join(f.root, '.git/index'))
  f.write(canonical + '/untracked.mjs', 'throw Error("not an input")')
  const result = buildBundle({ root: f.root })
  assert.equal(result.mode, 'plan')
  assert.equal(result.files.some(x => x.path.includes('untracked')), false)
  assert.deepEqual(fs.readFileSync(path.join(f.root, '.git/index')), before)
  assert.equal(fs.existsSync(path.join(f.root, 'artifacts')), false)
})
test('runtime artifact is independent, applies its overrides and excludes only the declared sample', async t => {
  const f = fixture(t), out = path.join(f.root, 'artifacts/runtime')
  const result = buildBundle({ root: f.root, out })
  assert.equal((await import(pathToFileURL(path.join(out, 'modules/mood/index.mjs')))).default.profile, 'runtime')
  assert.equal(fs.existsSync(path.join(out, 'modules/conversation/voice-examples.txt')), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'modules/learning/cost_policy.json'))).guard, true)
  assert.equal(fs.readFileSync(path.join(out, 'modules/fangyuan/core.txt'), 'utf8').includes('\r'), false)
  for (const entry of result.files) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(out, entry.path))).digest('hex'), entry.sha256)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'))), Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'mode')))
})
test('development artifact preserves the sample and original implementation', async t => {
  const f = fixture(t), out = path.join(f.root, 'dev')
  buildBundle({ root: f.root, profile: 'development', out })
  assert.equal((await import(pathToFileURL(path.join(out, 'modules/mood/index.mjs')))).default.profile, 'development')
  assert.equal(fs.readFileSync(path.join(out, 'modules/conversation/voice-examples.txt'), 'utf8'), 'development-only\n')
  assert.equal(fs.existsSync(path.join(out, 'modules/learning/cost_policy.json')), false)
})
test('repeated builds of the same input produce identical manifests and contents', t => {
  const f = fixture(t)
  const a = buildBundle({ root: f.root, out: path.join(f.root, 'one') })
  const b = buildBundle({ root: f.root, out: path.join(f.root, 'two') })
  assert.deepEqual(a, b)
})
test('existing outputs, source trees and their junction aliases cannot be overwritten', t => {
  const f = fixture(t), out = path.join(f.root, 'existing')
  fs.mkdirSync(out)
  assert.throws(() => buildBundle({ root: f.root, out }), /output_already_exists/)
  for (const name of [canonical + '/new', 'docs/new', '.git/new']) assert.throws(() => buildBundle({ root: f.root, out: path.join(f.root, name) }), /output_overlaps_protected_tree/)
  const alias = path.join(f.root, 'alias')
  fs.symlinkSync(path.join(f.root, canonical), alias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => buildBundle({ root: f.root, out: path.join(alias, 'new') }), /output_overlaps_protected_tree/)
})
test('persona drift and enabled templates fail before creating an output directory', t => {
  const f = fixture(t), out = path.join(f.root, 'invalid')
  f.write(canonical + '/fangyuan/core.txt', 'different persona')
  assert.throws(() => buildBundle({ root: f.root, out }), /persona_core_out_of_sync/)
  assert.equal(fs.existsSync(out), false)
  f.write(canonical + '/fangyuan/core.txt', 'Synthetic persona')
  f.write('src/fangyuan-agent/config.patch.json', '{"enabled":true,"dryRun":false}')
  assert.throws(() => buildBundle({ root: f.root, out }), /template_must_remain_disabled/)
  assert.equal(fs.existsSync(out), false)
})
test('tracked secrets, binary inputs and nested links are rejected', t => {
  const f = fixture(t), file = canonical + '/private/example.json'
  f.write(file, '{}'); f.git('add', '--', file)
  assert.throws(() => planBundle({ root: f.root }), /restricted_source_path/)
  f.git('rm', '-f', '--', file)
  f.write(canonical + '/binary.txt', Buffer.from([0, 1])); f.git('add', '--', canonical + '/binary.txt')
  assert.throws(() => planBundle({ root: f.root }), /non_utf8_source/)
  f.git('rm', '-f', '--', canonical + '/binary.txt')
  fs.symlinkSync(path.join(f.root, canonical, 'mood'), path.join(f.root, canonical, 'alias.mjs'), process.platform === 'win32' ? 'junction' : 'dir')
  f.git('update-index', '--add', '--cacheinfo', '120000,' + f.git('hash-object', '-w', '--stdin').trim() + ',' + canonical + '/alias.mjs')
  assert.throws(() => planBundle({ root: f.root }), /unsupported_source_entry/)
})
test('redundant overrides and unknown profiles fail clearly', t => {
  const f = fixture(t)
  f.write(overrides + '/mood/index.mjs', fs.readFileSync(path.join(f.root, canonical, 'mood/index.mjs')))
  assert.throws(() => planBundle({ root: f.root }), /redundant_runtime_override/)
  assert.throws(() => planBundle({ root: f.root, profile: 'unknown' }), /invalid_profile/)
})
test('every runtime JavaScript module in the real repository imports from an independent artifact', async t => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'fangyuan-bundle-test-real-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()))
    assert.ok(path.basename(dir).startsWith('fangyuan-bundle-test-'))
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const out = path.join(dir, 'bundle'), result = buildBundle({ root: repositoryRoot, out })
  for (const entry of result.files.filter(x => x.path.endsWith('.mjs'))) await import(pathToFileURL(path.join(out, entry.path)))
})
