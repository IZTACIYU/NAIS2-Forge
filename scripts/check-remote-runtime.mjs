import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as protocol from '../src/lib/remote-protocol.ts'
import * as remote from '../src/lib/remote-generation.ts'

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
    { module, exports: module.exports, console, setTimeout, clearTimeout, structuredClone, ...globals })
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

const settings = { basePrompt: 'base', additionalPrompt: '', detailPrompt: '', negativePrompt: '', inpaintingPrompt: '', model: 'nai-diffusion-5-full',
  steps: 28, cfgScale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral', scheduler: 'karras', smea: false, smeaDyn: false, variety: false,
  modelMode: 'anime', qualityToggle: true, qualityTagPreset: 'standard', ucPreset: 0, transparentBackground: false,
  seed: 123, seedLocked: true, selectedResolution: { label: 'Portrait', width: 832, height: 1216 }, strength: .5, noise: 0 }
let generationCount = 0, finishGeneration
let finishSceneGeneration, sceneGenerationCount = 0
const scene = { id: 'scene', name: 'Scene', scenePrompt: 'PC scene', width: 832, height: 1216, folderPath: '/private/path', images: [{ id: 'image', url: '/private/path/image.png', isFavorite: true }] }
const sceneState = { isGenerating: false, activePresetId: 'preset', presets: [{ id: 'preset', name: 'Preset', scenes: [scene] }], sceneCharacterAdditions: {}, getScene(presetId, sceneId) { return presetId === 'preset' && sceneId === 'scene' ? scene : undefined } }
const generation = { ...settings, batchCount: 1, isGenerating: false, generatingMode: null, previewImage: 'data:image/png;base64,eA==',
  generate: options => { generationCount++; return new Promise(resolve => { finishGeneration = async () => { await options.onImage(generation.previewImage, 1); resolve() } }) } }
const generationStore = { getState: () => generation }
const messages = []
class Socket { static OPEN = 1; readyState = 1; send(value) { messages.push(JSON.parse(value)) } close() { this.readyState = 3 } }
let source = readFileSync(new URL('../src/components/RemoteControl.tsx', import.meta.url), 'utf8')
source = source.slice(0, source.lastIndexOf('\n    return (')) + '\n return {handleMessage, revoke, generateQr, sessionRef, socketRef, epochRef, remoteBusyRef, sendSession, outboundUsageRef};\n}'
source = source.replace(/import\.meta\.env\.[A-Z_]+/g, "''")
const previewReads = [], previewUrls = new Set(); let canvasSource
const { RemoteControl } = compile(source, { WebSocket: Socket, TextEncoder, Blob,
  URL: { createObjectURL: () => { const url = `blob:preview-${previewReads.length}`; previewUrls.add(url); return url }, revokeObjectURL: url => previewUrls.delete(url) },
  Image: class { width = 1; height = 1; async decode() {} },
  document: { createElement: () => ({ getContext: () => ({ drawImage(image) { canvasSource = image.src } }), toDataURL: () => { assert.ok(canvasSource.startsWith('data:') || canvasSource.startsWith('blob:'), 'asset image can render but cannot safely export its canvas'); return 'data:image/webp;base64,eA==' } }) },
  require(name) {
    if (name === '@tauri-apps/plugin-fs') return { readFile: async path => { previewReads.push(path); return new Uint8Array([120]) } }
    if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} }
    if (name === 'react-i18next') return { useTranslation: () => ({ t: key => key }) }
    if (name === 'qrcode') return { toDataURL: async () => 'QR' }
    if (name.endsWith('/remote-protocol')) return protocol
    if (name.endsWith('/remote-pairing-storage')) return storage
    if (name.endsWith('/remote-generation')) return remote
    if (name.endsWith('/ResolutionSelector')) return { RESOLUTION_PRESETS: [] }
    if (name.endsWith('/character-store')) return { useCharacterStore: { getState: () => ({ characterImages: [], vibeImages: [] }) } }
    if (name.endsWith('/settings-store')) return { useSettingsStore: { getState: () => ({ customResolutions: [] }) } }
    if (name.endsWith('/generation-store')) return { useGenerationStore: generationStore }
    if (name.endsWith('/scene-store')) return { useSceneStore: { getState: () => sceneState } }
    if (name.endsWith('/character-prompt-store')) return { useCharacterPromptStore: { getState: () => ({ characters: [{ id: 'macro', name: 'Macro', prompt: 'private character content' }] }) } }
    if (name.endsWith('/scene-image-selection')) return { pickSceneRepresentativeImage: () => scene.images[0] }
    if (name.endsWith('/remote-scene-queue')) return {
      resolveRemoteScene: item => { if (item.sceneId !== scene.id || item.presetId !== 'preset') throw new Error('Missing scene'); return scene },
      remoteSceneCostContext: (_, context) => context,
      runRemoteSceneQueue: options => { sceneGenerationCount++; return new Promise(resolve => { finishSceneGeneration = async () => { await options.onImage('data:image/png;base64,eA==', 1, options.queue[0]); resolve(1) } }) },
    }
    if (name.endsWith('/auth-store')) return { useAuthStore: { getState: () => ({ isVerified: true, imageGenerationEntitlement: { unlimitedImageGeneration: true } }) } }
    return {}
  } })
const control = RemoteControl(), socket = new Socket()
await storage.saveRemoteSession(active)
control.sessionRef.current = active; control.socketRef.current = socket
let seq = 0
const requestId = protocol.randomDeviceId()
async function request(type, busy = false, payload = {}) {
  const frame = await protocol.encryptFrame(active.inboundKey, active.room, 'phone-to-app', ++seq, { ...payload, type, requestId })
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
await finishGeneration(); await drain(() => !control.remoteBusyRef.current)
assert.equal((await response(4)).type, 'image'); assert.equal((await response(5)).type, 'complete')
await request('generate', true); assert.equal((await response(6)).type, 'error', 'busy arrival must not become a queued generation')
generation.i2iMode = 'inpaint'
await request('snapshot'); assert.equal((await response(7)).snapshot.settings.basePrompt, 'base')
assert.equal((await response(7)).snapshot.i2iMode, null, 'a remembered mode without a source is not active inpaint')
await request('generate', false, { settings, batchCount: 3, expectedCost: 99 })
await drain(() => !control.remoteBusyRef.current)
assert.equal((await response(8)).reason, 'cost-changed'); assert.equal(generationCount, 1)
await request('generate', false, { settings: { ...settings, token: 'arbitrary' }, batchCount: 1, expectedCost: 0 })
await drain(() => !control.remoteBusyRef.current)
assert.equal((await response(9)).type, 'error'); assert.equal(generationCount, 1)
await request('generate', false, { settings, batchCount: 1, expectedCost: 0, originalImages: true })
await drain(() => generationCount === 2)
await finishGeneration(); await drain(() => !control.remoteBusyRef.current)
assert.equal((await response(11)).preview, generation.previewImage, 'original bytes must bypass thumbnail canvas')
assert.equal((await response(12)).type, 'complete')
control.outboundUsageRef.current = { socket, startedAt: Date.now() - 10990, count: 16, bytes: 40_000_000 }
await control.sendSession({ type: 'pong', requestId }, active, 0, socket)
assert.equal(control.outboundUsageRef.current.count, 1, 'sender must reset a full relay window before another frame')
assert.equal((await response(13)).type, 'pong')
await request('scene-list')
const page = (await response(14)).scenePage
assert.equal(page.scenes[0].scenePrompt, 'PC scene'); assert.equal(page.scenes[0].count, 0)
assert.equal(page.characters[0].id, 'macro'); assert.ok(!JSON.stringify(page).includes('/private/path')); assert.ok(!JSON.stringify(page).includes('private character content'))
await request('scene-list', false, { presetId: 'missing' }); assert.equal((await response(15)).reason, 'scene-list-failed')
await request('scene-list', false, { page: -1 }); assert.equal((await response(16)).reason, 'scene-list-failed')
const sceneDraft = { presetId: 'preset', sceneId: 'scene', scenePrompt: 'WEB scene', sceneNegativePrompt: '', characterPromptIds: [], npcs: [], count: 1 }
await request('scene-generate', false, { settings, queue: [{ ...sceneDraft, folderPath: '/evil' }], expectedCost: 0 })
await drain(() => !control.remoteBusyRef.current); assert.equal((await response(17)).type, 'error'); assert.equal(sceneGenerationCount, 0)
await request('scene-generate', false, { settings, queue: [sceneDraft], expectedCost: 0, originalImages: true })
await drain(() => sceneGenerationCount === 1 && messages.length >= 19); assert.equal((await response(18)).type, 'started')
await request('scene-generate', false, { settings, queue: [sceneDraft], expectedCost: 0 }); assert.equal((await response(19)).reason, 'busy-or-not-ready'); assert.equal(sceneGenerationCount, 1)
await finishSceneGeneration(); await drain(() => !control.remoteBusyRef.current)
assert.equal((await response(20)).sceneId, 'scene'); assert.equal((await response(20)).presetId, 'preset'); assert.equal((await response(21)).type, 'complete')
assert.equal(scene.scenePrompt, 'PC scene'); assert.equal(sceneState.activePresetId, 'preset')
await request('scene-images', false, { presetId: 'preset', sceneId: 'scene', page: 0 })
const gallery = (await response(22)).sceneImages
assert.equal(gallery.images.length, 1); assert.equal(gallery.images[0].isFavorite, true); assert.equal(gallery.totalImages, 1)
assert.ok(gallery.images[0].thumbnail.startsWith('data:image/webp')); assert.ok(!JSON.stringify(gallery).includes('url'))
assert.ok(previewReads.length >= 2); assert.ok(previewReads.every(path => path === scene.images[0].url)); assert.equal(previewUrls.size, 0, 'temporary file preview URL must be revoked')
await request('scene-images', false, { presetId: 'preset', sceneId: 'scene', page: 0 }); assert.ok((await response(23)).sceneImages.images[0].thumbnail, 're-entering scene reloads stored file preview'); assert.equal(previewUrls.size, 0)
await request('scene-images', false, { presetId: 'preset', sceneId: 'missing' }); assert.equal((await response(24)).reason, 'scene-images-failed')
await control.generateQr()
assert.equal(record, null); assert.equal(socket.readyState, 3); assert.equal(control.sessionRef.current, null)
await request('generate'); assert.equal(generationCount, 2, 'revoked session must not generate')
assert.equal(messages.length, 25)
console.log('Remote runtime checks passed: atomic counters, late-save revocation, ping, duplicate rejection, QR invalidation.')
