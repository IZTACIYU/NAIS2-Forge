import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { validateRemoteSceneQueue } from '../src/lib/remote-generation.ts'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'

function compile(path, require) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require, console, structuredClone, setTimeout, atob, Uint8Array,
      window: { dispatchEvent() {} }, CustomEvent: class {}, })
  return module.exports
}
const characters = [{ id: 'main', name: 'Main', enabled: true, prompt: 'main', negative: '' }, { id: 'extra', name: 'Extra', enabled: false, prompt: 'extra', negative: '' }]
const scenes = [{ id: 'a', name: 'A', scenePrompt: 'PC A', sceneNegativePrompt: 'PC negative', width: 832, height: 1216, folderPath: '/existing/A', queueCount: 7, images: [] },
  { id: 'b', name: 'B', scenePrompt: 'PC B', width: 1216, height: 832, folderPath: '/existing/B', queueCount: 3, images: [] }]
const settings = { savePath: '/not-used', useStreaming: false, imageFormat: 'png', expertSceneRandomCharactersEnabled: true, sceneRandomCharactersActive: true,
  expertSceneCharacterAdditionsEnabled: true, sceneCharacterAdditionMode: 'scene', generationDelay: 0, generationDelayJitter: 0 }
const gen = { basePrompt: 'PC base', additionalPrompt: 'PC add', detailPrompt: 'PC detail', negativePrompt: 'PC neg', inpaintingPrompt: 'stale inpaint',
  i2iMode: 'inpaint', model: 'nai-diffusion-5-full', seed: 123, seedLocked: true, isGenerating: false, generatingMode: null, setGeneratingMode(value) { gen.generatingMode = value } }
const state = { isGenerating: false, isCancelling: false, generationSessionId: 5, completedCount: 0, totalQueuedCount: 0, activePresetId: 'other',
  presets: [{ id: 'p', name: 'Preset', scenes }], sceneCharacterAdditions: { p: { a: { mode: 'scene', characterPromptIds: [], characterReferenceIds: [], vibeReferenceIds: [] } } },
  getScene(presetId, id) { return presetId === 'p' ? scenes.find(scene => scene.id === id) : undefined },
  addImageToScene(presetId, id, path, folder) { assert.equal(presetId, 'p'); assert.equal(folder, `/existing/${id.toUpperCase()}`); saved.push(path) },
  setStreamingData() {}, setGenerationProgress(completed, total) { state.completedCount = completed; state.totalQueuedCount = total } }
const saved = [], requests = [], refs = { characterImages: [], vibeImages: [], releaseImageData() {} }
const store = { getState: () => state, setState: value => Object.assign(state, value) }
const helper = compile('../src/lib/scene-character-prompts.ts', name => name.endsWith('/character-gender') ? { getCharacterGender: () => 'all' } : { splitCostumePrompt: () => ({}), COSTUME_PROMPT_MARKER: '' })
let npcGenerated = false
const dependencies = name => {
  if (name.endsWith('/scene-store')) return { useSceneStore: store }
  if (name.endsWith('/generation-store')) return { useGenerationStore: { getState: () => gen } }
  if (name.endsWith('/settings-store')) return { useSettingsStore: { getState: () => settings } }
  if (name.endsWith('/character-prompt-store')) return { useCharacterPromptStore: { getState: () => ({ characters, groups: [], positionEnabled: false }), setState() { assert.fail('Remote generation must not mutate character activation') } } }
  if (name.endsWith('/character-store')) return { useCharacterStore: { getState: () => refs } }
  if (name.endsWith('/scene-character-prompts')) return helper
  if (name.endsWith('/model-capabilities')) return { getModelCapabilities }
  if (name.endsWith('/random-character-selection')) return { getRandomCharacterCandidates: () => [], pickRandomCharacters: () => [] }
  if (name.endsWith('/generation-delay')) return { calculateGenerationDelay: () => 0 }
  if (name.endsWith('/generation-request')) return { buildGenerationRequest: async value => { requests.push(structuredClone(value)); return { imageFormat: 'png' } } }
  if (name.endsWith('/auth-store')) return { useAuthStore: { getState: () => ({ runGenerationWithAccountFallback: operation => operation('local-token'), refreshAnlas() {} }) } }
  if (name.endsWith('/novelai-api')) return { generateImage: async token => { assert.equal(token, 'local-token'); npcGenerated = true; return { success: true, imageData: 'eA==' } } }
  if (name === '@tauri-apps/plugin-fs') return { exists: async path => path.startsWith('/existing/'), writeFile: async () => {}, mkdir() { assert.fail('Must reuse actual scene folderPath') } }
  if (name === '@tauri-apps/api/path') return { join: async (...parts) => parts.join('/'), pictureDir: async () => '/pictures' }
  if (name.endsWith('/i18n')) return { default: { t: value => value } }
  if (name.endsWith('/use-toast')) return { toast() {} }
  return {}
}
const core = compile('../src/services/scene-generation.ts', dependencies)
const owner = compile('../src/services/remote-scene-queue.ts', name => name === './scene-generation' ? core : dependencies(name))
const draft = { presetId: 'p', sceneId: 'a', scenePrompt: 'WEB A', sceneNegativePrompt: 'WEB negative', characterPromptIds: ['extra'],
  multiCharacterSlots: [{ id: 'slot', target: 'manual', characterId: 'extra', prompt: 'scene extra', negativePrompt: 'scene extra negative', position: { x: .3, y: .7 } }],
  npcs: [{ id: 'npc', name: 'NPC', prompt: 'npc prompt', negative: 'npc negative', enabled: true }], count: 2 }
const remoteSettings = { ...gen, basePrompt: 'WEB base', steps: 28 }
const baseline = JSON.stringify({ scenes, characters, settings, basePrompt: gen.basePrompt, activePresetId: state.activePresetId, sessionId: state.generationSessionId })
assert.equal(validateRemoteSceneQueue([draft])[0].scenePrompt, 'WEB A')
for (const invalid of [[], [{ ...draft, folderPath: '/evil' }], [{ ...draft, count: 101 }], [draft, draft], [{ ...draft, characterPromptIds: ['extra', 'extra'] }],
  [{ ...draft, npcs: [{ ...draft.npcs[0], filePath: '/evil' }] }], [{ ...draft, npcs: [{ ...draft.npcs[0], enabled: 'yes' }] }]]) assert.throws(() => validateRemoteSceneQueue(invalid))
for (const update of [{ filePath: '/evil' }, { target: 'exec' }, { gender: 'invalid' }, { position: { x: -1, y: 0 } }, { position: { x: .5, y: NaN } }]) {
  assert.throws(() => validateRemoteSceneQueue([{ ...draft, multiCharacterSlots: [{ ...draft.multiCharacterSlots[0], ...update }] }]))
}
assert.throws(() => owner.resolveRemoteScene({ ...draft, multiCharacterSlots: [{ ...draft.multiCharacterSlots[0], characterId: 'missing' }] }, gen.model))
assert.throws(() => owner.resolveRemoteScene({ ...draft, sceneId: 'missing' }, gen.model))
assert.throws(() => owner.resolveRemoteScene({ ...draft, characterPromptIds: ['missing'] }, gen.model))
assert.throws(() => owner.resolveRemoteScene({ ...draft, npcs: Array.from({ length: 32 }, (_, id) => ({ ...draft.npcs[0], id: String(id) })) }, gen.model))
const delivered = []
const count = await owner.runRemoteSceneQueue({ settings: remoteSettings, queue: [draft, { ...draft, sceneId: 'b', count: 1 }], shouldContinue: () => true,
  onImage: async (image, index, item) => {
    assert.equal(image, 'data:image/png;base64,eA=='); assert.equal(owner.isRemoteSceneQueueRunning(), true); assert.equal(gen.generatingMode, 'scene')
    await assert.rejects(owner.runRemoteSceneQueue({ settings: remoteSettings, queue: [draft], shouldContinue: () => true, onImage: async () => {} }), /busy/)
    delivered.push([index, item.sceneId])
  } })
assert.equal(count, 3); assert.deepEqual(delivered, [[1, 'a'], [2, 'a'], [3, 'b']]); assert.ok(npcGenerated)
assert.equal(JSON.stringify({ scenes, characters, settings, basePrompt: gen.basePrompt, activePresetId: state.activePresetId, sessionId: state.generationSessionId }), baseline)
assert.equal(owner.isRemoteSceneQueueRunning(), false); assert.equal(state.isGenerating, false); assert.equal(gen.generatingMode, null)
assert.deepEqual(requests[0].positiveParts.map(part => part.value), ['WEB base', '', 'PC add', 'WEB A', 'PC detail'])
assert.deepEqual(requests[0].negativeParts.map(part => part.value), ['PC neg', 'WEB negative'])
assert.deepEqual(requests[0].characterInputs.map(input => input.character.id), ['main', 'extra', 'scene-custom:a:npc'])
assert.deepEqual(requests[0].mainCharacterInputs.map(input => input.character.id), ['main'])
assert.deepEqual(requests[0].characterInputs[1].appendedPrompts, ['scene extra'])
assert.deepEqual(requests[0].characterInputs[1].appendedNegativePrompts, ['scene extra negative'])
assert.deepEqual(requests[0].characterInputs[1].position, { x: .3, y: .7 })
assert.equal(requests[0].width, 832); assert.equal(requests[2].width, 1216); assert.equal(saved.length, 3)
let current = true
assert.equal(await owner.runRemoteSceneQueue({ settings: remoteSettings, queue: [draft], shouldContinue: () => current, onImage: async () => { current = false } }), 1)
assert.equal(await owner.runRemoteSceneQueue({ settings: remoteSettings, queue: [draft], shouldContinue: () => false, onImage: async () => assert.fail() }), 0)
await core.generateSceneImage({ presetId: 'p', scene: scenes[0] })
assert.deepEqual(requests.at(-1).positiveParts.map(part => part.value), ['PC base', '', 'PC add', 'PC A', 'PC detail'])
assert.deepEqual(requests.at(-1).characterInputs.map(input => input.character.id), ['main'])
assert.equal(JSON.stringify({ scenes, characters, settings, basePrompt: gen.basePrompt, activePresetId: state.activePresetId, sessionId: state.generationSessionId }), baseline)
const hook = readFileSync(new URL('../src/hooks/useSceneGeneration.ts', import.meta.url), 'utf8')
assert.ok(hook.includes('isProcessing || isRemoteSceneQueueRunning()')); assert.ok(hook.includes('await generateSceneImage(')); assert.ok(!hook.includes('buildGenerationRequest('))
console.log('Remote scenes passed: strict input, shared PC pipeline, request-local edits/NPCs, scene folders, queue isolation, busy/cancel/revocation, ordinary PC generation.')
