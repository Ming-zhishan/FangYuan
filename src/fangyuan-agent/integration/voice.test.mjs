import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import voice from '../modules/voice/index.mjs'

test('installed Chinese male voice produces real local WAV audio without sending to QQ', async (t) => {
  const root = process.env.AURABOT_SOURCE_ROOT
  const native = await import(pathToFileURL(join(root, 'src/modules/voice/index.js')))
  const folder = mkdtempSync(join(tmpdir(), 'fy-male-voice-')); t.after(() => rmSync(folder, { recursive: true, force: true }))
  const service = voice.setup({ lib: () => native, dataDir: (...parts) => join(folder, ...parts),
    config: () => ({ ext: { voice: { preferLocalMale: true, windowsVoice: 'Microsoft Kangkang' } } }),
    core: { local: { active: () => false }, hub: {}, onebot: {}, http: {} }, route() {},
  })
  const result = await service.speak('嗯，这句接住了。')
  const bytes = readFileSync(result.file)
  assert.equal(bytes.subarray(0, 4).toString(), 'RIFF'); assert.equal(bytes.subarray(8, 12).toString(), 'WAVE')
  assert.ok(bytes.length > 10000)
})
