import { realpathSync, rmSync } from 'node:fs'
import { dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
export function removeTestDirectory(dir) {
  const target = realpathSync(dir), root = realpathSync(tmpdir())
  if (dirname(target).toLowerCase() !== root.toLowerCase() || !basename(target).startsWith('fangyuan-')) throw new Error('Refusing cleanup outside the intended test directory')
  rmSync(target, { recursive: true, force: false })
}
