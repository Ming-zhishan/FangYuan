import { spawn } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeVoiceEnvelope } from './envelope.mjs'
import { listInstalledWindowsVoices, shouldUseWindowsVoice } from './capability.mjs'

/** Keep native media/ASR routes; provide an installed Chinese male voice without an online dependency. */
export default {
  id: 'voice', name: '方源语音', api: 1, version: '0.1.0', tab: 'voice',
  setup(api) {
    api.on?.('send', normalizeVoiceEnvelope)
    const native = api.lib('modules/voice/index.js').default, local = api.core.local
    const synthesize = async ({ text }) => {
      const folder = api.dataDir('audio'); mkdirSync(folder, { recursive: true })
      const file = join(folder, randomUUID() + '.wav')
      const script = '[Console]::InputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Speech;' +
        '$d=([Console]::In.ReadToEnd()|ConvertFrom-Json);$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;' +
        'try{$s.SelectVoice($d.voice);$s.SetOutputToWaveFile($d.file);$s.Speak($d.text)}finally{$s.Dispose()}'
      await new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
        const timer = setTimeout(() => { child.kill(); reject(new Error('本地语音超时')) }, 30000)
        child.on('error', (e) => { clearTimeout(timer); reject(e) })
        child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('本地语音失败：' + code)) })
        child.stdout.resume(); child.stderr.resume()
        child.stdin.end(JSON.stringify({ file, text: String(text), voice: api.config().ext?.voice?.windowsVoice || 'Microsoft Kangkang' }), 'utf8')
      })
      if (statSync(file).size < 1000) throw new Error('语音文件不完整')
      return { file }
    }
    // Return to native TTS if the selected Windows voice is absent; never claim a missing voice is available.
    let observed = [], checkedAt = 0
    const preferred = () => {
      const cfg = api.config().ext?.voice || {}
      if (cfg.preferLocalMale !== true || process.platform !== 'win32') return false
      const now = Date.now()
      if (!checkedAt || now - checkedAt >= 600000) {
        observed = listInstalledWindowsVoices()
        checkedAt = now
      }
      return shouldUseWindowsVoice({ platform: process.platform, enabled: true,
        requestedName: cfg.windowsVoice || 'Microsoft Kangkang', installedNames: observed })
    }
    return native.setup({ ...api, core: { ...api.core, local: {
      ...local,
      active: (kind) => kind === 'tts' && preferred() || local?.active?.(kind),
      call: (kind, args) => kind === 'tts' && preferred() ? synthesize(args) : local.call(kind, args),
    } } })
  },
}
