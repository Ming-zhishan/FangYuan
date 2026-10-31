import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVoiceEnvelope } from '../modules/voice/envelope.mjs'
test('captured reply + @ + voice is delivered as a standalone record without changing its audio',()=>{
  const voice={type:'record',data:{file:'base64://fixed audio fixture'}}
  const message=[{type:'reply',data:{id:'1657052533'}},{type:'at',data:{qq:'2449113325'}},{type:'text',data:{text:' '}},voice]
  assert.deepEqual(normalizeVoiceEnvelope(message),[voice])
  assert.equal(normalizeVoiceEnvelope([voice])[0],voice)
  const text=[{type:'reply',data:{id:'m'}},{type:'text',data:{text:'你好'}}]
  assert.equal(normalizeVoiceEnvelope(text),text)
})
