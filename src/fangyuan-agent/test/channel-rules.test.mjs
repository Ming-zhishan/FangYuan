import test from 'node:test'
import assert from 'node:assert/strict'
import { channelRules } from '../modules/fangyuan/index.mjs'

test('splitting stays off until the host is proven to split on newlines', () => {
  const off = channelRules({ ownerQQ: '100001' }, 'group')
  assert.match(off, /不要用换行拆条/)
  assert.doesNotMatch(off, /私聊最多三条/)

  const on = channelRules({ ownerQQ: '100001', ext: { channel: { splitReplies: true } } }, 'group')
  assert.match(on, /私聊最多三条、群里最多两条/)
  assert.match(on, /各自独占一行/)
})

test('the punctuation habit does not depend on the split switch', () => {
  for (const ext of [undefined, { channel: { splitReplies: true } }]) {
    assert.match(channelRules({ ownerQQ: '100001', ext }, 'private'), /句末一般不加句号，问号照常用/)
  }
})

test('voice and sticker hints follow the real capability flags', () => {
  const off = channelRules({ ownerQQ: '100001', voice: { enabled: false }, stickers: { enabled: false } })
  assert.match(off, /语音未启用，不假装发送/)
  assert.match(off, /表情包未启用/)

  const on = channelRules({ ownerQQ: '100001', voice: { enabled: true }, stickers: { enabled: true }, ext: { channel: { splitReplies: true } } })
  assert.match(on, /语音独占一行不拆/)
  assert.match(on, /<sticker:标签>/)
})