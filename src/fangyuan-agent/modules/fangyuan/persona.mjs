import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

export const MIN_CHARS = 120
export const MAX_CHARS = 20000
export const personaSha = (text) => createHash('sha256').update(String(text).replaceAll('\r\n', '\n').trim()).digest('hex')

/** The operator's own persona lives beside the module data, never in the source tree. */
export function readCustomPersona(file) {
  try {
    const text = readFileSync(file, 'utf8')
    return text.trim() ? text.replaceAll('\r\n', '\n').trim() : ''
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error }
}

export function writeCustomPersona(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, file)
}

export function clearCustomPersona(file) {
  try { unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

/**
 * Persona text is content, not authority. Length, language and an explicit
 * "ignore the permissions" attempt are rejected; everything else is left to the operator.
 */
export function validatePersona(text) {
  const body = String(text || '').replaceAll('\r\n', '\n').trim()
  if (body.length < MIN_CHARS) throw new Error(`人格文本至少 ${MIN_CHARS} 字符；请保留身份、目标与表达方式`)
  if (body.length > MAX_CHARS) throw new Error(`人格文本超过 ${MAX_CHARS} 字符；请精简或拆分为人格与补充规则`)
  if (/(?:忽略|绕过|跳过|取消|无视).{0,12}(?:权限|授权|安全|限制)/.test(body)) throw new Error('人格文本不能改写权限与授权；权限由代码判定，人格只描述立场与表达')
  return body
}
