import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as contract from '../src/lib/remote-workspace.ts'
import * as remote from '../src/lib/remote-generation.ts'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'

const store = initial => {
  let state = initial
  return { getState: () => state, setState(value) { state = { ...state, ...(typeof value === 'function' ? value(state) : value) } } }
}
const chars = store({ characters: [{ id: 'pc', name: 'PC', prompt: 'original', negative: '', enabled: true, position: { x: .5, y: .5 } }], positionEnabled: false, activeCharacterLimit: 6 })
Object.assign(chars.getState(), {
  setPositionEnabled: value => chars.setState({ positionEnabled: value }),
  setActiveCharacterLimit: value => chars.setState({ activeCharacterLimit: value }),
  addCharacter: value => chars.setState(s => ({ characters: [...s.characters, value] })),
  updateCharacter: (id, value) => chars.setState(s => ({ characters: s.characters.map(item => item.id === id ? { ...item, ...value } : item) })),
  removeCharacter: id => chars.setState(s => ({ characters: s.characters.filter(item => item.id !== id) })),
})
const refs = store({ characterImages: [], vibeImages: [] })
for (const [kind, key] of [['Character', 'characterImages'], ['Vibe', 'vibeImages']]) Object.assign(refs.getState(), {
  [`add${kind}Image`]: async (image, name) => refs.setState(s => ({ [key]: [...s[key], { id: 'saved-ref', name, base64: '', filePath: '/preserved/new.png', enabled: true }] })),
  [`update${kind}Image`]: (id, value) => refs.setState(s => ({ [key]: s[key].map(item => item.id === id ? { ...item, ...value } : item) })),
})
const contents = new Map([['f', ['one', 'two']]])
const fragments = store({ files: [{ id: 'f', name: 'file', folder: '', updatedAt: 1 }], sequentialIndex: 42 })
let fragmentFailure
Object.assign(fragments.getState(), {
  getFileWithContent: async id => { const item = fragments.getState().files.find(item => item.id === id); return item && { ...item, content: contents.get(id) } },
  getFileByPath: path => fragments.getState().files.find(item => [item.folder, item.name].filter(Boolean).join('/') === path),
  loadFileContent: async id => contents.get(id),
  updateFile: async (id, value) => { if (fragmentFailure) return fragmentFailure(); contents.set(id, value.content); fragments.setState(s => ({ files: s.files.map(item => item.id === id ? { ...item, name: value.name, folder: value.folder, updatedAt: item.updatedAt + 1 } : item) })) },
  addFile: async (name, folder, content) => { const item = { id: `f-${contents.size}`, name, folder }; contents.set(item.id, content); fragments.setState(s => ({ files: [...s.files, item] })); return { ...item, content } },
})
const settings = { basePrompt: 'PC', additionalPrompt: '', detailPrompt: '', negativePrompt: '', inpaintingPrompt: '', model: 'nai-diffusion-5-full', steps: 28, cfgScale: 5, cfgRescale: 0, sampler: 'k_euler_ancestral', scheduler: 'karras', smea: false, smeaDyn: false, variety: false, modelMode: 'anime', qualityToggle: true, qualityTagPreset: 'standard', ucPreset: 0, transparentBackground: false, seed: 1, seedLocked: false, selectedResolution: { label: 'P', width: 832, height: 1216 }, strength: .5, noise: 0 }
const generation = store({ ...settings, modelOptionMemory: {}, applyPreset: value => generation.setState(value) })
for (const key of ['modelMode', 'qualityTagPreset', 'transparentBackground', 'seed', 'seedLocked', 'inpaintingPrompt', 'strength', 'noise']) generation.getState()[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => generation.setState({ [key]: value })
const scenes = store({ presets: [{ id: 'p', name: 'Preset', scenes: [{ id: 's', name: 'Scene', scenePrompt: 'original', sceneNegativePrompt: '', images: [], folderPath: '/preserved/scene' }] }], sceneCharacterAdditions: {} })
scenes.getState().getScene = (p, id) => scenes.getState().presets.find(item => item.id === p)?.scenes.find(item => item.id === id)
scenes.getState().deleteScene = (p, id) => scenes.setState(s => ({ presets: s.presets.map(item => item.id === p ? { ...item, scenes: item.scenes.filter(scene => scene.id !== id) } : item) }))
scenes.getState().addScene = (p, name, id) => scenes.setState(s => ({ presets: s.presets.map(item => item.id === p ? { ...item, scenes: [...item.scenes, { id, name, scenePrompt: '', images: [] }] } : item) }))
const updateScene = (p, id, value) => scenes.setState(s => ({ presets: s.presets.map(item => item.id === p ? { ...item, scenes: item.scenes.map(scene => scene.id === id ? { ...scene, ...value } : scene) } : item) }))
for (const [name, field] of [['Prompt', 'scenePrompt'], ['NegativePrompt', 'sceneNegativePrompt'], ['MultiCharacterSlots', 'multiCharacterSlots']]) scenes.getState()[`updateScene${name}`] = (p, id, value) => updateScene(p, id, { [field]: value })
scenes.getState().updateSceneSettings = updateScene
scenes.getState().updateSceneCharacterAddition = (p, id, value) => scenes.setState(s => ({ sceneCharacterAdditions: { ...s.sceneCharacterAdditions, [p]: { ...s.sceneCharacterAdditions[p], [id]: value } } }))
let flushFailure = 0
const dependencies = {
  '@/stores/character-prompt-store': { useCharacterPromptStore: chars }, '@/stores/character-store': { useCharacterStore: refs },
  '@/stores/fragment-store': { useFragmentStore: fragments, normalizeFragmentPath: path => path.trim().toLowerCase() },
  '@/stores/scene-store': { useSceneStore: scenes }, '@/stores/generation-store': { useGenerationStore: generation },
  '@/lib/model-capabilities': { getModelCapabilities }, '@/lib/remote-generation': remote, '@/lib/remote-workspace': contract,
  '@/lib/random-character-selection': { getRandomCharacterDisplayName: item => item.name.replace(/\s-\s[a-z0-9]{6}\s-\s\d+$/i, '') },
  '@/lib/indexed-db': { flushAllPendingWrites: async () => { if (flushFailure > 0) { flushFailure--; throw Error('flush failed') } }, readStoredStateItem: async () => JSON.stringify({ state: { presets: scenes.getState().presets } }) },
  './remote-scene-queue': { resolveRemoteScene: item => { if (!scenes.getState().presets.some(p => p.id === item.presetId)) throw Error('Missing preset'); if (!item.newScene && !scenes.getState().getScene(item.presetId, item.sceneId)) throw Error('Missing scene') } },
}
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/remote-workspace.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, require: name => { assert.ok(dependencies[name], name); return dependencies[name] }, structuredClone, crypto, TextEncoder, Image: class { width = 2; height = 2; async decode() {} } })
const api = module.exports
chars.setState({ characters: [{ id: 'pc', name: 'PC', prompt: 'original', negative: '', enabled: true, position: { x: .5, y: .5 } }, { id: 'a', name: 'Alice - abc123 - 0', prompt: '', negative: '', enabled: true, position: { x: .5, y: .5 } }] })
assert.equal((await api.remoteAssetPage('characters', 0, undefined, 'ali')).items[0].id, 'a')
assert.equal((await api.remoteAssetPage('characters', 0, undefined, 'abc123')).items.length, 0, 'internal variant hash is not searchable')
await assert.rejects(api.remoteAssetPage('characters', 0, undefined, ' '.repeat(2)))
chars.setState({ characters: chars.getState().characters.slice(0, 1) })
const original = JSON.stringify(chars.getState()), asset = await api.readRemoteAsset('characters', 'pc')
const edited = { ...asset, prompt: 'web', position: { x: .2, y: .8 } }
const workspace = await api.resolveRemoteAssets(contract.validateRemoteAssets([edited]), settings.model)
assert.equal(workspace.characters[0].prompt, 'web'); assert.equal(workspace.positionEnabled, true); assert.equal(JSON.stringify(chars.getState()), original)
assert.equal((await api.resolveRemoteAssets([edited], settings.model, false)).positionEnabled, false, 'web-only toggle must not force positions on when characters are edited')
assert.equal(chars.getState().positionEnabled, false, 'request-only toggle must not change PC state')
assert.equal(await workspace.fragmentResolver('file', true), 'one'); assert.equal(await workspace.fragmentResolver('file', true), 'two'); assert.equal(fragments.getState().sequentialIndex, 42)
assert.throws(() => contract.validateRemoteAssets([{ ...edited, filePath: '/private/path' }]))
assert.throws(() => contract.validateRemoteAssets([{ ...edited, revision: undefined, id: 'not-web' }]))
const saved = await api.applyRemoteAssets([edited], settings.model, () => true)
assert.equal(chars.getState().characters[0].prompt, 'web'); await saved.rollback(); assert.equal(chars.getState().characters[0].prompt, 'original')
const toggled = { ...asset, promptEnabled: false, negativeEnabled: false, costumeEnabled: false }
assert.equal((await api.resolveRemoteAssets(contract.validateRemoteAssets([toggled]), settings.model)).characters[0].promptEnabled, false)
const toggleSave = await api.applyRemoteAssets([toggled], settings.model, () => true)
assert.equal(chars.getState().characters[0].negativeEnabled, false)
await toggleSave.rollback()
assert.equal(JSON.stringify(chars.getState()), original, 'rollback preserves absent optional fields')
assert.throws(() => contract.validateRemoteAssets([{ ...toggled, promptEnabled: 'false' }]))
const fragment = await api.readRemoteAsset('fragments', 'f')
fragmentFailure = () => { chars.getState().updateCharacter('pc', { prompt: 'concurrent PC' }); throw Error('save failed') }
await assert.rejects(api.applyRemoteAssets([edited, { ...fragment, content: ['new'] }], settings.model, () => true), /save failed/)
assert.equal(chars.getState().characters[0].prompt, 'concurrent PC', 'rollback must preserve later PC edits')
fragmentFailure = undefined
const newFragment = { kind: 'fragments', id: 'web-fragment', name: 'new file', enabled: true, folder: '', content: ['new line'] }
const fragmentSave = await api.applyRemoteAssets(contract.validateRemoteAssets([newFragment]), settings.model, () => true)
assert.equal(fragmentSave.assets[0].content[0], 'new line'); await fragmentSave.rollback()
const newReference = { kind: 'references', id: 'web-reference', name: 'new ref', enabled: true, mode: 'character', referenceType: 'character&style', strength: .6, fidelity: .6, informationExtracted: 1, image: 'data:image/png;base64,eA==' }
const refSave = await api.applyRemoteAssets(contract.validateRemoteAssets([newReference]), settings.model, () => true)
assert.equal(refSave.assets[0].id, 'saved-ref'); assert.equal('filePath' in refSave.assets[0], false); assert.equal(refs.getState().characterImages[0].filePath, '/preserved/new.png'); await refSave.rollback(); assert.equal(refs.getState().characterImages.length, 0)
await assert.rejects(api.resolveRemoteAssets([edited], settings.model), /PC item changed/)
const revision = await contract.remoteRevision(remote.pickRemoteSettings(generation.getState()))
await assert.rejects(api.applyRemoteWorkspace(settings, revision, [], undefined, () => true, true, true), /PC position changed/)
assert.equal(chars.getState().positionEnabled, false, 'stale web toggle must not overwrite PC state')
await api.applyRemoteWorkspace(settings, revision, [], undefined, () => true, true, false)
assert.equal(chars.getState().positionEnabled, true, 'explicit app apply must update the existing PC-wide toggle')
chars.setState({ positionEnabled: false })
await assert.rejects(api.applyRemoteWorkspace({ ...settings, basePrompt: 'WEB' }, '0'.repeat(64), [], undefined, () => true), /PC settings changed/)
const draft = { presetId: 'p', sceneId: 'web-new', newScene: { name: 'New', width: 832, height: 1216 }, scenePrompt: 'new prompt', sceneNegativePrompt: '', characterPromptIds: [], npcs: [], count: 1 }
const result = await api.applyRemoteWorkspace({ ...settings, basePrompt: 'WEB' }, revision, [], [draft], () => true)
assert.equal(generation.getState().basePrompt, 'WEB'); assert.equal(scenes.getState().getScene('p', 'web-new').scenePrompt, 'new prompt'); assert.equal(scenes.getState().getScene('p', 's').folderPath, '/preserved/scene'); assert.equal(result.sceneRevisions.length, 1)
const updatePrompt = scenes.getState().updateScenePrompt
scenes.getState().updateScenePrompt = () => { throw Error('scene save failed') }
await assert.rejects(api.applyRemoteWorkspace({ ...settings, basePrompt: 'WEB' }, result.revision, [], [{ ...draft, sceneId: 'web-failing' }], () => true, true, false), /scene save failed/)
assert.equal(chars.getState().positionEnabled, false, 'failed app apply must restore the existing position toggle')
scenes.getState().updateScenePrompt = updatePrompt
const beforeFailure = generation.getState().basePrompt
generation.getState().setNoise = () => { throw Error('owner failed') }
await assert.rejects(api.applyRemoteWorkspace({ ...settings, basePrompt: 'must rollback' }, result.revision, [], undefined, () => true), /owner failed/)
assert.equal(generation.getState().basePrompt, beforeFailure)
await assert.rejects(api.applyRemoteAssets([], settings.model, () => false), /Connection expired/)
assert.throws(() => remote.validateRemoteSceneQueue([draft, { ...draft, sceneId: 'web-second' }]), /Duplicate scene name/)
const deleteRevision = await api.remoteSceneDeleteRevision('p', 's')
await assert.rejects(api.deleteRemoteScene('p', 's', '0'.repeat(64), () => true), /PC scene changed/)
assert.equal(scenes.getState().getScene('p', 's').folderPath, '/preserved/scene')
flushFailure = 1
await assert.rejects(api.deleteRemoteScene('p', 's', deleteRevision, () => true), /flush failed/)
assert.equal(scenes.getState().getScene('p', 's').folderPath, '/preserved/scene', 'failed persistence restores scene metadata')
await api.deleteRemoteScene('p', 's', deleteRevision, () => true)
assert.equal(scenes.getState().getScene('p', 's'), undefined)
// Run the actual fragment owner against a transaction stub: stale writes must abort before commit.
let fragmentStore, interfere, dbContent = new Map()
const nativeModule = { exports: {} }
const indexedDB = { open() { const request = {}; setImmediate(() => { request.result = { transaction() {
  const transaction = { aborted: false, abort() { this.aborted = true; setImmediate(() => this.onabort?.()) }, objectStore() { return { put(content, id) { const write = {}; setImmediate(() => { interfere?.(); write.onsuccess(); if (!transaction.aborted) setImmediate(() => { dbContent.set(id, structuredClone(content)); transaction.oncomplete?.() }) }); return write } } } }
  return transaction
} }; request.onsuccess() }); return request } }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/stores/fragment-store.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: nativeModule, exports: nativeModule.exports, indexedDB, setImmediate, console,
    require(name) { if (name === 'zustand') return { create: () => initialize => { fragmentStore = store({}); fragmentStore.setState(initialize(fragmentStore.setState, fragmentStore.getState)); return fragmentStore } }; if (name === 'zustand/middleware') return { persist: initialize => initialize, createJSONStorage: () => ({}) }; return {} } })
await fragmentStore.getState().addFile('first', '', ['before'], 'web-unique')
await new Promise(resolve => setImmediate(resolve))
interfere = () => fragmentStore.setState(s => ({ files: s.files.map(item => ({ ...item, name: 'PC renamed' })) }))
await assert.rejects(fragmentStore.getState().updateFile('web-unique', { content: ['must not commit'] }, () => true), /changed during save/)
assert.equal(dbContent.get('web-unique')[0], 'before'); assert.equal(fragmentStore.getState().files[0].name, 'PC renamed')
await assert.rejects(fragmentStore.getState().addFile('duplicate', '', [], 'web-unique'), /Duplicate fragment ID/)
const fragmentModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/fragment-processor.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: fragmentModule, exports: fragmentModule.exports, console, require(name) { if (name.endsWith('/fragment-store')) return dependencies['@/stores/fragment-store']; if (name.endsWith('/random-tag-prompts')) return { resolveRandomTagPrompts: async value => value }; return { pickRandomTag: () => null } } })
assert.equal(await fragmentModule.exports.processWildcards('<file>', async () => 'remote line'), 'remote line')
await assert.rejects(fragmentModule.exports.processWildcards('<file>', async () => '<file>'), /nesting limit/)
await assert.rejects(fragmentModule.exports.processWildcards('<file>'.repeat(2049), async () => 'line'), /expansion limit/)
console.log('Remote workspace passed: strict fields, request isolation, local sequence, conflicts, guarded rollback, app apply, scene creation, stale fragment abort and expansion limits.')
