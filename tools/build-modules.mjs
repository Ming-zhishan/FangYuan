import { buildBundle } from './lib/module-artifacts.mjs'

try {
  const args = process.argv.slice(2), settings = {}
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node tools/build-modules.mjs [--profile runtime|development] [--out NEW_DIRECTORY]\nWithout --out, validate tracked inputs and print a plan. Never deploys or overwrites outputs.')
  } else {
    for (let i = 0; i < args.length; i += 2) {
      const name = args[i], value = args[i + 1]
      if (!['--profile', '--out'].includes(name) || !value || value.startsWith('--') || Object.hasOwn(settings, name.slice(2))) throw Error('invalid_arguments')
      settings[name.slice(2)] = value
    }
    const result = buildBundle(settings)
    console.log(JSON.stringify({ mode: result.mode, profile: result.profile, module_files: result.module_files, source_revision: result.source_revision, source_dirty: result.source_dirty, content_sha256: result.content_sha256, deployment_actions: 0 }))
  }
} catch (error) {
  const safe = /^[a-z_]+$/.test(error.message) ? error.message : 'artifact_io_failed'
  console.error(JSON.stringify({ error: safe, deployment_actions: 0 }))
  process.exitCode = 2
}
