import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as capabilities from '../src/lib/model-capabilities.ts'
import * as memory from '../src/lib/model-option-memory.ts'
import { pickRemoteSettings, validateRemoteSettings, validateRemoteBatch, remoteGenerationCost } from '../src/lib/remote-generation.ts'

let state, persisted, writes = [], requests = [], events = [], images = []
const refs = { characterImages: [], vibeImages: [], releaseImageData() {} }
const auth = { token: 'test-token', isVerified: true, refreshAnlas() {}, runGenerationWithAccountFallback: action => action(auth.token) }
const module = { exports: {} }
const code = ts.transpileModule(readFileSync(new URL('../src/stores/generation-store.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(code, {
  module, exports: module.exports, console: { log() {}, warn() {}, error: error => { throw error } },
  Math, Date, AbortController, setTimeout, atob, window: { dispatchEvent: event => events.push(event) },
  CustomEvent: class { constructor(type, value) { this.type = type; this.detail = value.detail } },
  require(name) {
    if (name === 'zustand') return { create: () => init => {
      state = init(update => {
        const patch = typeof update === 'function' ? update(state) : update
        writes.push(patch); state = { ...state, ...patch }; persisted = init.partialize(state)
      }, () => state)
      return { getState: () => state }
    } }
    if (name === 'zustand/middleware') return { persist: (init, config) => { init.partialize = config.partialize; return init }, createJSONStorage: () => ({}) }
    if (name.endsWith('/auth-store')) return { useAuthStore: { getState: () => auth } }
    if (name.endsWith('/settings-store')) return { useSettingsStore: { getState: () => ({ autoSave: false, imageFormat: 'png', useStreaming: false, generationDelay: 0, generationDelayJitter: 0 }) } }
    if (name.endsWith('/character-store')) return { useCharacterStore: { getState: () => refs } }
    if (name.endsWith('/character-prompt-store')) return { useCharacterPromptStore: { getState: () => ({ characters: [], groups: [], positionEnabled: false }) } }
    if (name.endsWith('/model-capabilities')) return capabilities
    if (name.endsWith('/model-option-memory')) return memory
    if (name.endsWith('/generation-request')) return { buildGenerationRequest: async request => { requests.push(structuredClone(request)); return {} } }
    if (name.endsWith('/novelai-api')) return { generateImage: async () => ({ success: true, imageData: 'eA==' }) }
    if (name.endsWith('/generation-delay')) return { calculateGenerationDelay: () => 0 }
    if (name === '@/i18n') return { default: { t: key => key } }
    if (name.endsWith('/use-toast')) return { toast() {} }
    return {}
  },
})
const store = module.exports.useGenerationStore
const original = { ...pickRemoteSettings(state), seed: 777, seedLocked: true }
Object.assign(state, original)
const remote = validateRemoteSettings({ ...original, model: 'nai-diffusion-5-full', basePrompt: 'remote base', negativePrompt: 'remote negative',
  steps: 35, cfgScale: 6, cfgRescale: .4, modelMode: 'furry', qualityTagPreset: 'light', ucPreset: 3, transparentBackground: true,
  seed: 123, selectedResolution: { label: 'Square', width: 1024, height: 1024 } })
const memoryBefore = structuredClone(state.modelOptionMemory)
await store.getState().generate({ settings: remote, batchCount: 3, onImage: async (image, index) => { images.push({ image, index, requests: requests.length }) } })
assert.equal(requests.length, 3); assert.deepEqual(images.map(image => image.index), [1, 2, 3])
assert.deepEqual(images.map(image => image.requests), [1, 2, 3], 'deliver each image before requesting the next')
for (const request of requests) {
  assert.equal(request.positiveParts[0].value, 'remote base'); assert.equal(request.negativeParts[0].value, 'remote negative')
  assert.equal(request.model, remote.model); assert.equal(request.modelMode, 'furry'); assert.equal(request.qualityTagPreset, 'light')
  assert.equal(request.ucPreset, 3); assert.equal(request.transparentBackground, true); assert.equal(request.seed, 123)
  assert.equal(request.steps, 35); assert.equal(request.cfgRescale, .4); assert.equal(request.width, 1024)
}
assert.deepEqual(pickRemoteSettings(state), original)
assert.equal(persisted.seed, 777); assert.equal(persisted.batchCount, 1)
assert.deepEqual(structuredClone(state.modelOptionMemory), memoryBefore)
for (const patch of writes) assert.ok(!Object.keys(remote).some(key => Object.hasOwn(patch, key)), 'remote must not write settings to PC state')
requests = []; images = []; writes = []
await store.getState().generate({ batchCount: 1 })
assert.equal(requests[0].model, original.model); assert.equal(requests[0].steps, original.steps); assert.equal(requests[0].seed, 777)
requests = []
await store.getState().generate({ settings: remote, batchCount: 3, shouldContinue: () => requests.length < 1 })
assert.equal(requests.length, 1, 'revoked connection stops remaining batch')
for (const invalid of [{ ...remote, token: 'injected' }, { ...remote, steps: NaN }, { ...remote, cfgScale: 99 }, { ...remote, model: 'arbitrary' },
  { ...remote, sampler: 'execute' }, { ...remote, seed: -1 }, { ...remote, selectedResolution: { label: 'bad', width: 1, height: 1024 } }]) {
  assert.throws(() => validateRemoteSettings(invalid))
}
for (const count of [0, -1, 1.5, 101, Infinity, '3']) assert.throws(() => validateRemoteBatch(count))
assert.equal(validateRemoteBatch(3), 3)
const context = { entitlement: { unlimitedImageGeneration: true }, characterReferenceCount: 0, uncachedVibeCount: 0, sourceDimensions: null }
assert.equal(remoteGenerationCost(original, 3, context), 0)
assert.ok(remoteGenerationCost(remote, 3, context) > 0)
assert.equal(events.length, 5)
requests = []
Object.assign(state, { sourceImage: null, mask: null, i2iMode: 'inpaint', inpaintingPrompt: 'inactive inpaint' })
await store.getState().generate({ batchCount: 1 })
assert.ok(!requests[0].positiveParts.some(part => part.value === 'inactive inpaint'))
assert.equal(state.i2iMode, 'inpaint', 'inactive mode detection must not reset persisted settings')
console.log('Remote generation checks passed: request-local settings/seed, per-image batch delivery, unchanged PC serialization, local generation, revoke, allowlist and costs.')
