import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as protocol from '../src/lib/remote-protocol.ts'

// Exercise real storage callbacks with serialized transactions, without a browser dependency.
let record = null, queue = Promise.resolve(), releaseOpen
const indexedDB = { open(name, version) {
  assert.equal(name, 'nais2-forge-remote-pairing'); assert.equal(version, 1)
  const request = {}
  const open = () => { request.result = { close() {}, transaction(name) {
    assert.equal(name, 'sessions')
    const transaction = { objectStore() { return {
      get(key) {
        assert.equal(key, 'active')
        const request = {}
        queue = queue.then(() => new Promise(resolve => setImmediate(() => {
          request.result = structuredClone(record)
          request.onsuccess()
          setImmediate(() => { transaction.oncomplete(); resolve() })
        })))
        return request
      },
      put(value, key) { assert.equal(key, 'active'); record = structuredClone(value) },
      delete(key) { assert.equal(key, 'active'); record = null },
    } }, abort() { throw new Error('Unexpected abort') } }
    return transaction
  } }; request.onsuccess() }
  if (releaseOpen === true) releaseOpen = open
  else setImmediate(open)
  return request
} }
function compile(source, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, console, setTimeout, clearTimeout, ...globals })
  return module.exports
}
const storage = compile(readFileSync(new URL('../src/lib/remote-pairing-storage.ts', import.meta.url), 'utf8'), { indexedDB })
const invitation = protocol.createInvitation(24), deviceId = protocol.randomDeviceId()
const active = { room: invitation.room, deviceId, createdAt: invitation.createdAt, expiresAt: invitation.accessExpiresAt,
  inboundKey: await protocol.deriveKey(invitation.secret, invitation.room, deviceId, 'phone-to-app'),
  outboundKey: await protocol.deriveKey(invitation.secret, invitation.room, deviceId, 'app-to-phone'),
  lastInboundSeq: 0, nextOutboundSeq: 1, preserved: 'unknown field' }
await storage.saveRemoteSession(active)
await Promise.all([1, 2].map(() => storage.updateRemoteSession(active, current => ({ ...current, nextOutboundSeq: current.nextOutboundSeq + 1 }))))
assert.equal(record.nextOutboundSeq, 3)
assert.equal(record.preserved, 'unknown field')
assert.equal(record.inboundKey.extractable, false)
releaseOpen = true
let current = true
const lateSave = storage.saveRemoteSession(active, () => current)
current = false
await storage.clearRemoteSession()
releaseOpen(); await lateSave
assert.equal(record, null, 'late save must not revive a revoked session')
await storage.saveRemoteSession({ ...active, room: 'replacement' })
await storage.clearRemoteSession(() => true, active)
assert.equal(record.room, 'replacement', 'expired old tab must not delete a new pairing')

let generationCount = 0, finishGeneration
const generation = { isGenerating: false, generatingMode: null, previewImage: 'data:image/png;base64,eA==',
  generate: () => { generationCount++; return new Promise(resolve => { finishGeneration = resolve }) } }
const generationStore = { getState: () => generation }
const messages = []
class Socket { static OPEN = 1; readyState = 1; send(value) { messages.push(JSON.parse(value)) } close() { this.readyState = 3 } }
let source = readFileSync(new URL('../src/components/RemoteControl.tsx', import.meta.url), 'utf8')
source = source.slice(0, source.lastIndexOf('\n    return (')) + '\n return {handleMessage, revoke, generateQr, sessionRef, socketRef, epochRef, remoteBusyRef};\n}'
source = source.replace(/import\.meta\.env\.[A-Z_]+/g, "''")
const { RemoteControl } = compile(source, { WebSocket: Socket,
  Image: class { width = 1; height = 1; async decode() {} },
  document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,eA==' }) },
  require(name) {
    if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} }
    if (name === 'react-i18next') return { useTranslation: () => ({ t: key => key }) }
    if (name === 'qrcode') return { toDataURL: async () => 'QR' }
    if (name.endsWith('/remote-protocol')) return protocol
    if (name.endsWith('/remote-pairing-storage')) return storage
    if (name.endsWith('/generation-store')) return { useGenerationStore: generationStore }
    if (name.endsWith('/auth-store')) return { useAuthStore: { getState: () => ({ isVerified: true }) } }
    return {}
  } })
const control = RemoteControl(), socket = new Socket()
await storage.saveRemoteSession(active)
control.sessionRef.current = active; control.socketRef.current = socket
let seq = 0
const requestId = protocol.randomDeviceId()
async function request(type, busy = false) {
  const frame = await protocol.encryptFrame(active.inboundKey, active.room, 'phone-to-app', ++seq, { type, requestId })
  await control.handleMessage(JSON.stringify({ kind: 'data', frame }), socket, 0, busy)
}
async function drain(predicate) {
  for (let n = 0; n < 200 && !predicate(); n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(predicate(), 'async completion did not arrive')
}
const response = async index => protocol.decryptFrame(active.outboundKey, active.room, 'app-to-phone', messages[index].frame)
await request('ping'); assert.equal((await response(0)).busy, false)
await request('generate'); await drain(() => generationCount === 1)
await request('ping'); assert.equal((await response(2)).busy, true, 'ping must not wait for generation')
await request('generate'); assert.equal((await response(3)).type, 'error'); assert.equal(generationCount, 1)
finishGeneration(); await drain(() => !control.remoteBusyRef.current)
await request('generate', true); assert.equal((await response(5)).type, 'error', 'busy arrival must not become a queued generation')
await control.generateQr()
assert.equal(record, null); assert.equal(socket.readyState, 3); assert.equal(control.sessionRef.current, null)
await request('generate'); assert.equal(generationCount, 1, 'revoked session must not generate')
assert.equal(messages.length, 6)
console.log('Remote runtime checks passed: atomic counters, late-save revocation, ping, duplicate rejection, QR invalidation.')
