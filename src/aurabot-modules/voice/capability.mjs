import { spawnSync } from 'node:child_process'

/** Exact installed SAPI voice matching. A configured but absent male voice is not an available TTS engine. */
export function shouldUseWindowsVoice({ platform, enabled, requestedName, installedNames } = {}) {
  if (platform !== 'win32' || enabled !== true || typeof requestedName !== 'string' || !requestedName.trim()) return false
  if (!Array.isArray(installedNames)) return false
  return installedNames.some(name => typeof name === 'string' && name.trim().toLowerCase() === requestedName.trim().toLowerCase())
}

export function listInstalledWindowsVoices({ run = spawnSync, platform = process.platform } = {}) {
  if (platform !== 'win32') return []
  const command = 'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; try {$s.GetInstalledVoices() | ForEach-Object {$_.VoiceInfo.Name}} finally {$s.Dispose()}'
  try {
    const result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 3000, encoding: 'utf8', maxBuffer: 32768
    })
    if (result.error || result.status !== 0 || typeof result.stdout !== 'string') return []
    return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  } catch { return [] }
}
