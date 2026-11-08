import { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildBundle } from '../../../tools/lib/module-artifacts.mjs'

const directory = mkdtempSync(join(tmpdir(), 'fangyuan-runtime-test-'))
const out = join(directory, 'bundle')
after(() => {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('fangyuan-runtime-test-')) throw Error('Unexpected test directory')
  rmSync(directory, { recursive: true, force: true })
})
buildBundle({ profile: 'runtime', out })
export const loadRuntimeModule = relative => import(pathToFileURL(join(out, 'modules', relative)))
