import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const trees = [
  { label: 'agent', source: 'src/fangyuan-agent', live: 'operations/legacy-tools/fangyuan-dsh' },
  { label: 'aurabot', source: 'artifacts/runtime-modules/modules', live: 'runtime/dsh-live/aurabot/modules' },
  { label: 'qq-bootstrap', source: 'legacy/qq-bootstrap', live: 'runtime/qq-stack/setup' }
]
const ignored = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'backups', 'logs', 'modules-data', '.aurabot-cache'])
const output = { at: new Date().toISOString(), readOnly: true, comparedTreesReadOnly: true, reportWritten: false, comparisons: [] }
const inside = (parent, child) => {
  const relative = path.relative(parent, child)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}
function fail(code, detail = {}) {
  const error = new Error(code)
  error.detail = { code, ...detail }
  throw error
}
function files(directory, relative = '', result = []) {
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const name = path.posix.join(relative, entry.name)
    if (entry.isDirectory()) files(directory, name, result)
    else if (entry.isFile()) result.push(name)
    else fail('unsupported_entry') // Do not follow nested links or read special files.
  }
  return result.sort()
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

try {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node operations/check-source-drift.mjs [--runtime-modules BUNDLE_MODULES] [--report NEW_FILE]\nDefault: JSON on stdout, no file writes. Differences are informational. Missing or unreadable inputs exit 2.')
  } else {
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      if (!['--report', '--runtime-modules'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(options, args[i])) fail('invalid_arguments')
      options[args[i]] = args[i + 1]
    }
    const report = options['--report'] ? path.resolve(options['--report']) : null
    if (options['--runtime-modules']) trees.find(x => x.label === 'aurabot').source = path.resolve(options['--runtime-modules'])
    const roots = []
    const unavailable = []
    for (const tree of trees) {
      for (const side of ['source', 'live']) {
        try {
          const directory = path.resolve(root, tree[side])
          if (!fs.statSync(directory).isDirectory()) throw Error()
          roots.push(fs.realpathSync(directory))
        } catch { unavailable.push({ label: tree.label, side }) }
      }
    }
    if (unavailable.length) fail('directories_unavailable', { unavailable })
    if (report) {
      // Resolve the existing parent so junctions cannot place reports in compared trees.
      let target
      try { target = path.join(fs.realpathSync(path.dirname(report)), path.basename(report)) }
      catch { fail('report_parent_unavailable') }
      if (roots.some(directory => inside(directory, target))) fail('report_inside_compared_tree')
    }
    for (const tree of trees) {
      const source = path.resolve(root, tree.source), live = path.resolve(root, tree.live)
      const sourceFiles = files(source), liveFiles = files(live)
      const sourceSet = new Set(sourceFiles), liveSet = new Set(liveFiles)
      const missing = sourceFiles.filter(name => !liveSet.has(name))
      const modified = sourceFiles.filter(name => liveSet.has(name) && sha(path.join(source, name)) !== sha(path.join(live, name)))
      const additional = liveFiles.filter(name => !sourceSet.has(name))
      output.comparisons.push({ label: tree.label, sourceFiles: sourceFiles.length, missingInLive: missing,
        modifiedInLive: modified, extraLiveFiles: additional.slice(0, 30), extraLiveFileCount: additional.length,
        note: 'Raw bytes and exact path casing; differences are informational. NEVER automatically overwrite production.' })
    }
    if (report) {
      let descriptor
      try { descriptor = fs.openSync(report, 'wx') }
      catch { fail('report_create_failed') }
      output.readOnly = false
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ ...output, reportWritten: true }, null, 2) + '\n')
        output.reportWritten = true
      } finally { fs.closeSync(descriptor) }
    }
    console.log(JSON.stringify(output, null, 2))
  }
} catch (error) {
  // Never print exception paths, compared contents or private environment configuration.
  output.error = error.detail || { code: 'io_failed' }
  console.log(JSON.stringify(output, null, 2))
  process.exitCode = 2
}
