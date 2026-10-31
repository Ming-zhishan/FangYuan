import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Only an acknowledged avatar or an operator-provided public asset enters this catalogue. */
export function avatarCatalog(api) {
  const directory = api.dataDir('public-avatars')
  mkdirSync(directory, { recursive: true })
  const index = join(directory, 'index.json')
  const read = () => { try { return JSON.parse(readFileSync(index, 'utf8')).filter((a) => /^[a-z0-9_-]{1,32}$/i.test(a.id)).slice(-24) } catch { return [] } }
  const list = () => [
    ...(api.config().ext?.profile?.publicAvatars || []).filter((a) => /^[a-z0-9_-]{1,32}$/i.test(a.id) && /^https?:\/\//i.test(a.url)).map((a) => ({ ...a, file: a.url })),
    ...read().filter((a) => /^https?:\/\//i.test(a.url || '') || (/^avatar-[a-f0-9]{24}\.img$/.test(a.filename || '') && existsSync(join(directory, a.filename)))),
  ].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i)
  return {
    list,
    resolve(asset) { return asset.file || asset.url || 'base64://' + readFileSync(join(directory, asset.filename)).toString('base64') },
    capture(file) {
      if (typeof file !== 'string') return
      const key = createHash('sha256').update(file).digest('hex').slice(0, 24)
      const asset = { id: 'used-' + key, title: '已使用的公开头像', adoptedAt: Date.now() }
      if (/^https?:\/\//i.test(file)) asset.url = file
      else if (/^base64:\/\/[a-zA-Z0-9+/=]+$/.test(file)) {
        const bytes = Buffer.from(file.slice(9), 'base64')
        if (!bytes.length || bytes.length > 2 * 1024 * 1024) return
        asset.filename = 'avatar-' + key + '.img'; writeFileSync(join(directory, asset.filename), bytes)
      } else return
      const rows = read().filter((a) => a.id !== asset.id); rows.push(asset)
      writeFileSync(index + '.next', JSON.stringify(rows.slice(-24), null, 2)); renameSync(index + '.next', index)
    },
  }
}
