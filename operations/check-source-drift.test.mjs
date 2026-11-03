import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-source-drift.mjs', import.meta.url))
const sourceDirs = ['src/fangyuan-agent', 'artifacts/runtime-modules/modules', 'src/qq-bootstrap']
const liveDirs = ['operations/legacy-tools/fangyuan-dsh', 'runtime/dsh-live/aurabot/modules', 'runtime/qq-stack/setup']
function fixture(t, populate = true) {
  const temporary = fs.mkdtempSync(path.join(tmpdir(), 'fangyuan-drift-test-'))
  const root = path.join(temporary, '资料 空格 # percent%')
  const write = (name, content) => {
    const destination = path.join(root, name)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, content)
  }
  write('operations/check-source-drift.mjs', fs.readFileSync(script))
  if (populate) for (const directory of [...sourceDirs, ...liveDirs]) write(directory + '/same.txt', 'synthetic\n')
  t.after(() => {
    const target = path.resolve(temporary)
    assert.equal(path.dirname(target), path.resolve(tmpdir()))
    assert.ok(path.basename(target).startsWith('fangyuan-drift-test-'))
    fs.rmSync(target, { recursive: true, force: true })
  })
  const run = (...args) => {
    const result = spawnSync(process.execPath, [path.join(root, 'operations/check-source-drift.mjs'), ...args], {
      cwd: temporary, encoding: 'utf8', timeout: 10000
    })
    assert.equal(result.stderr, '')
    assert.ok(!result.stdout.includes(temporary), 'diagnostics must not disclose the absolute project path')
    return { ...result, data: args.length === 1 && args[0] === '--help' ? null : JSON.parse(result.stdout) }
  }
  return { root, write, run }
}
function snapshot(root) {
  const result = {}
  for (const name of fs.readdirSync(root, { recursive: true })) {
    const file = path.join(root, name), info = fs.lstatSync(file)
    result[name] = info.isFile() ? fs.readFileSync(file).toString('base64') : info.isSymbolicLink() ? fs.readlinkSync(file) : 'directory'
  }
  return result
}

test('default invocation decodes special project paths and performs no writes', t => {
  const f = fixture(t), before = snapshot(f.root), result = f.run()
  assert.equal(result.status, 0)
  assert.equal(result.data.readOnly, true)
  assert.equal(result.data.reportWritten, false)
  assert.equal(result.data.comparisons.length, 3)
  assert.deepEqual(snapshot(f.root), before)
})

test('reports missing, changed and extra files without syncing them', t => {
  const f = fixture(t)
  f.write(sourceDirs[0] + '/only-source.txt', 'source')
  f.write(liveDirs[0] + '/same.txt', 'different')
  f.write(liveDirs[0] + '/README.md', 'live-only')
  const before = snapshot(f.root), result = f.run(), comparison = result.data.comparisons[0]
  assert.equal(result.status, 0)
  assert.deepEqual(comparison.missingInLive, ['only-source.txt'])
  assert.deepEqual(comparison.modifiedInLive, ['same.txt'])
  assert.deepEqual(comparison.extraLiveFiles, ['README.md'])
  assert.equal(comparison.extraLiveFileCount, 1)
  assert.deepEqual(snapshot(f.root), before)
})

test('case differences and raw newline differences remain visible', t => {
  const f = fixture(t)
  f.write(sourceDirs[0] + '/Case.txt', 'same')
  f.write(liveDirs[0] + '/case.txt', 'same')
  f.write(liveDirs[0] + '/same.txt', 'synthetic\r\n')
  const result = f.run(), comparison = result.data.comparisons[0]
  assert.equal(result.status, 0)
  assert.deepEqual(comparison.missingInLive, ['Case.txt'])
  assert.deepEqual(comparison.extraLiveFiles, ['case.txt'])
  assert.deepEqual(comparison.modifiedInLive, ['same.txt'])
})

test('missing runtime directories fail clearly without creating a report', t => {
  const f = fixture(t, false), before = snapshot(f.root), result = f.run('--report', path.join(f.root, 'report.json'))
  assert.equal(result.status, 2)
  assert.equal(result.data.error.code, 'directories_unavailable')
  assert.equal(result.data.error.unavailable.length, 6)
  assert.equal(result.data.reportWritten, false)
  assert.deepEqual(snapshot(f.root), before)
})

test('only explicit report mode writes a new report and labels the write', t => {
  const f = fixture(t), report = path.join(f.root, 'report.json'), before = snapshot(f.root)
  const result = f.run('--report', report)
  assert.equal(result.status, 0)
  assert.equal(result.data.readOnly, false)
  assert.equal(result.data.comparedTreesReadOnly, true)
  assert.equal(result.data.reportWritten, true)
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')), result.data)
  const after = snapshot(f.root)
  delete after['report.json']
  assert.deepEqual(after, before)
})

test('existing reports are never overwritten', t => {
  const f = fixture(t)
  f.write('report.json', 'previous report')
  const before = snapshot(f.root), result = f.run('--report', path.join(f.root, 'report.json'))
  assert.equal(result.status, 2)
  assert.equal(result.data.error.code, 'report_create_failed')
  assert.equal(result.data.readOnly, true)
  assert.deepEqual(snapshot(f.root), before)
})

test('reports cannot be created inside either compared tree', t => {
  const f = fixture(t), before = snapshot(f.root)
  for (const directory of [...sourceDirs, ...liveDirs]) {
    const result = f.run('--report', path.join(f.root, directory, 'new-report.json'))
    assert.equal(result.status, 2)
    assert.equal(result.data.error.code, 'report_inside_compared_tree')
  }
  assert.deepEqual(snapshot(f.root), before)
})

test('absent report parents and invalid arguments fail without writing', t => {
  const f = fixture(t), before = snapshot(f.root)
  const invalid = f.run('--report', path.join(f.root, 'missing/report.json'))
  assert.equal(invalid.status, 2)
  assert.equal(invalid.data.error.code, 'report_parent_unavailable')
  for (const args of [['--unknown'], ['--report'], ['--report', '--help'], ['--report', 'a.json', 'b.json']]) {
    const result = f.run(...args)
    assert.equal(result.status, 2)
    assert.equal(result.data.error.code, 'invalid_arguments')
  }
  assert.deepEqual(snapshot(f.root), before)
})

test('ignored cache directories do not create false drift', t => {
  const f = fixture(t)
  f.write(sourceDirs[0] + '/node_modules/local.txt', 'ignored')
  f.write(liveDirs[0] + '/.aurabot-cache/generated.mjs', 'ignored')
  const result = f.run()
  assert.equal(result.status, 0)
  assert.equal(result.data.comparisons[0].sourceFiles, 1)
  assert.equal(result.data.comparisons[0].extraLiveFileCount, 0)
})

test('extra file previews disclose their full count and remain sorted', t => {
  const f = fixture(t)
  for (let i = 0; i < 35; i++) f.write(liveDirs[0] + '/extra-' + String(i).padStart(2, '0') + '.txt', 'synthetic')
  const result = f.run(), comparison = result.data.comparisons[0]
  assert.equal(result.status, 0)
  assert.equal(comparison.extraLiveFiles.length, 30)
  assert.equal(comparison.extraLiveFileCount, 35)
  assert.equal(comparison.extraLiveFiles[0], 'extra-00.txt')
})

test('nested directory links are rejected instead of traversed', t => {
  const f = fixture(t)
  fs.symlinkSync(path.resolve(f.root, sourceDirs[1]), path.join(f.root, liveDirs[0], 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const result = f.run()
  assert.equal(result.status, 2)
  assert.equal(result.data.error.code, 'unsupported_entry')
})

test('a report parent alias cannot bypass compared-tree protection', t => {
  const f = fixture(t)
  const alias = path.join(f.root, 'alias')
  fs.symlinkSync(path.resolve(f.root, liveDirs[0]), alias, process.platform === 'win32' ? 'junction' : 'dir')
  const result = f.run('--report', path.join(alias, 'report.json'))
  assert.equal(result.status, 2)
  assert.equal(result.data.error.code, 'report_inside_compared_tree')
  assert.equal(fs.existsSync(path.join(alias, 'report.json')), false)
})

test('help is available without a runtime and causes no writes', t => {
  const f = fixture(t, false), before = snapshot(f.root), result = f.run('--help')
  assert.equal(result.status, 0)
  assert.match(result.stdout, /no file writes/)
  assert.deepEqual(snapshot(f.root), before)
})

test('an explicit runtime bundle selects that source without writing or exposing its absolute path', t => {
  const f = fixture(t)
  f.write('new-bundle/modules/same.txt', 'synthetic\n')
  f.write(sourceDirs[1] + '/only-old-bundle.txt', 'old')
  const before = snapshot(f.root), result = f.run('--runtime-modules', path.join(f.root, 'new-bundle/modules'))
  assert.equal(result.status, 0)
  assert.deepEqual(result.data.comparisons[1].missingInLive, [])
  assert.equal(result.data.comparisons[1].sourceFiles, 1)
  assert.deepEqual(snapshot(f.root), before)
})
