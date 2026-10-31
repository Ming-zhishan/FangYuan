import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldUseWindowsVoice, listInstalledWindowsVoices } from '../modules/voice/capability.mjs'
import { shouldUseWindowsVoice as aurabotCheck, listInstalledWindowsVoices as aurabotList } from '../../aurabot-modules/voice/capability.mjs'
import baselineVoice from '../modules/voice/index.mjs'
import aurabotVoice from '../../aurabot-modules/voice/index.mjs'

const installed = ['Microsoft Huihui Desktop', 'Microsoft Zira Desktop', 'Microsoft David Desktop']

test('a missing configured Kangkang voice must not be announced as installed', () => {
  assert.equal(shouldUseWindowsVoice({ platform: 'win32', enabled: true, requestedName: 'Microsoft Kangkang', installedNames: installed }), false)
  assert.equal(shouldUseWindowsVoice({ platform: 'win32', enabled: true, requestedName: 'Microsoft David Desktop', installedNames: installed }), true)
  assert.equal(shouldUseWindowsVoice({ platform: 'win32', enabled: true, requestedName: 'microsoft david desktop ', installedNames: installed }), true)
  assert.equal(shouldUseWindowsVoice({ platform: 'linux', enabled: true, requestedName: 'Microsoft David Desktop', installedNames: installed }), false)
  assert.equal(shouldUseWindowsVoice({ platform: 'win32', enabled: false, requestedName: 'Microsoft David Desktop', installedNames: installed }), false)
  assert.equal(shouldUseWindowsVoice({ platform: 'win32', enabled: true, requestedName: '', installedNames: installed }), false)
})
test('SAPI probe uses a bounded, hidden, noninteractive read-only process and fails closed', () => {
  let invocation
  const run = (command,args,options) => {
    invocation = {command,args,options}
    return { status:0, stdout:'Microsoft Huihui Desktop\r\nMicrosoft Zira Desktop\nMicrosoft David Desktop\n' }
  }
  assert.deepEqual(listInstalledWindowsVoices({run,platform:'win32'}),installed)
  assert.equal(invocation.command,'powershell.exe')
  assert.ok(invocation.args.includes('-NonInteractive'))
  assert.equal(invocation.options.windowsHide,true)
  assert.ok(invocation.options.timeout<=3000)
  assert.deepEqual(listInstalledWindowsVoices({run:()=>{throw Error('Voice subsystem offline')},platform:'win32'}),[])
  assert.deepEqual(listInstalledWindowsVoices({run:()=>({status:1,stdout:''}),platform:'win32'}),[])
  assert.deepEqual(listInstalledWindowsVoices({run,platform:'linux'}),[])
})
test('production and standalone module copies share identical capability checks', () => {
  const p={platform:'win32',enabled:true,requestedName:'Microsoft Kangkang',installedNames:installed}
  assert.equal(aurabotCheck(p),shouldUseWindowsVoice(p))
  assert.deepEqual(aurabotList({run:()=>({status:0,stdout:'Microsoft David Desktop\n'}),platform:'win32'}),['Microsoft David Desktop'])
  assert.equal(readFileSync(new URL('../modules/voice/capability.mjs',import.meta.url),'utf8'),
    readFileSync(new URL('../../aurabot-modules/voice/capability.mjs',import.meta.url),'utf8'))
  assert.equal(readFileSync(new URL('../modules/voice/index.mjs',import.meta.url),'utf8'),
    readFileSync(new URL('../../aurabot-modules/voice/index.mjs',import.meta.url),'utf8'))
})
test('when no eligible local voice, the wrapper delegates TTS to the existing Aurabot native service', async () => {
  for(const voice of [baselineVoice,aurabotVoice]){
    const events=[],calls=[],sentinel={file:'native-voice.wav'}
    const local={active:kind=>kind==='tts',call:async(kind,args)=>{calls.push({kind,args});return sentinel}}
    let wrapped
    const api={
      config:()=>({ext:{voice:{preferLocalMale:true,windowsVoice:'FangYuan QA Nonexistent SAPI Voice'}}}),
      dataDir:()=>{throw Error('SAPI path should not be used on non-Windows platforms')},
      on:(event,fn)=>{events.push(event)},
      lib:()=>({default:{setup:arg=>{wrapped=arg;return {status:'native-ready'}}}}),
      core:{local}
    }
    const result=voice.setup(api)
    assert.equal(result.status,'native-ready')
    assert.deepEqual(events,['send'])
    assert.equal(wrapped.core.local.active('tts'),true)
    assert.equal(await wrapped.core.local.call('tts',{text:'短句'}),sentinel)
    assert.equal(calls.length,1)
  }
})
