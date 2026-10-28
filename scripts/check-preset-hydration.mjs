import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createStore } from 'zustand/vanilla'
import { persist, createJSONStorage } from 'zustand/middleware'
import * as models from '../src/lib/model-capabilities.ts'
import * as modelMemory from '../src/lib/model-option-memory.ts'

const presetKey = 'nais2-forge-presets', generationKey = 'nais2-forge-generation'
const original = {
    presets: Array.from({ length: 6 }, (_, index) => ({
        id: index ? `preset-${index}` : 'default', name: `Style ${index}`, createdAt: index,
        isDefault: index === 0, basePrompt: `style ${index}`, additionalPrompt: `extra ${index}`,
        detailPrompt: `detail ${index}`, negativePrompt: `negative ${index}`,
        model: 'nai-diffusion-4-5-full', steps: 20 + index, cfgScale: 5, cfgRescale: 0.2,
        sampler: 'k_euler_ancestral', scheduler: 'karras', smea: false, smeaDyn: false,
        variety: false, qualityToggle: index % 2 === 0, ucPreset: index % 5,
        selectedResolution: { label: `Custom ${index}`, width: 832, height: 1216 },
        futurePresetField: { values: [index, `keep ${index}`] },
    })),
    activePresetId: 'preset-3', futureRootField: { keep: true },
}
const json = value => JSON.parse(JSON.stringify(value))
const disk = new Map([
    [presetKey, JSON.stringify({ state: original, version: 0 })],
    [generationKey, JSON.stringify({ state: { ...original.presets[3], basePrompt: 'unsaved generation draft' }, version: 0 })],
])
const source = Object.fromEntries(['preset-store', 'generation-store'].map(name => [name,
    ts.transpileModule(readFileSync(`src/stores/${name}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
]))

// Real stores/middleware; only storage, time and unused generation I/O are isolated.
function openStores() {
    const pending = new Map(), timers = new Map(), modules = new Map(), writes = []
    let now = 0, timerId = 0
    const storage = {
        getItem: name => {
            const snapshot = disk.get(name) ?? null
            return new Promise((resolve, reject) => pending.set(name, { resolve: () => resolve(snapshot), reject }))
        },
        async setItem(name, value) { writes.push(name); disk.set(name, value) },
        removeItem() { assert.fail('Must not delete storage') },
    }
    function load(name) {
        if (modules.has(name)) return modules.get(name)
        const exports = {}
        modules.set(name, exports)
        vm.runInNewContext(source[name], {
            exports, console: { log() {}, error() {} },
            setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId },
            clearTimeout: id => timers.delete(id),
            require(id) {
                if (id === 'zustand') return { create: () => initializer => createStore(initializer) }
                if (id === 'zustand/middleware') return { persist, createJSONStorage }
                if (id === '@/lib/indexed-db') return { indexedDBStorage: storage }
                if (id === './generation-store') return load('generation-store')
                if (id === '@/lib/model-capabilities') return models
                if (id === '@/lib/model-option-memory') return modelMemory
                if (id === './character-prompt-store') return { useCharacterPromptStore: { getState: () => ({ setActiveCharacterLimit() {} }) } }
                return {} // Unused API/filesystem/UI dependencies; no generation is executed.
            },
        })
        return exports
    }
    const preset = load('preset-store').usePresetStore
    const generation = load('generation-store').useGenerationStore
    return {
        preset, generation, timers,
        presetWrites: () => writes.filter(name => name === presetKey).length,
        async finish(key, fail = false) {
            const read = pending.get(key)
            assert.ok(read, `pending ${key}`)
            pending.delete(key)
            fail ? read.reject(new Error('Synthetic read failure')) : read.resolve()
            await new Promise(setImmediate)
        },
        advance(milliseconds) {
            now += milliseconds
            for (const [id, timer] of timers) {
                if (timer.at > now) continue
                timers.delete(id); timer.callback()
            }
        },
    }
}
const stored = () => JSON.parse(disk.get(presetKey)).state

// A new module/store pair models refresh without opening the app or a real DB.
for (const first of [generationKey, presetKey, generationKey]) {
    const run = openStores()
    assert.equal(run.presetWrites(), 0, 'Importing actions must not persist defaults')
    await run.finish(first)
    run.preset.getState().syncFromGenerationStore()
    run.advance(1000)
    assert.equal(run.presetWrites(), 0, 'Partially hydrated stores must not sync')
    assert.deepEqual(stored(), original)
    await run.finish(first === presetKey ? generationKey : presetKey)
    assert.ok(run.preset.persist.hasHydrated() && run.generation.persist.hasHydrated())
    run.advance(1000)
    assert.equal(run.presetWrites(), 0, 'Hydration is not an edit')
    assert.deepEqual(json(run.preset.getState()), original)
    assert.deepEqual(stored(), original, 'All six records, order, active ID and unknown fields survive refresh')
}

const run = openStores()
await run.finish(generationKey); await run.finish(presetKey)
run.generation.getState().setBasePrompt('edited active style')
run.advance(499)
assert.deepEqual(stored(), original, 'Keep the existing debounce')
run.advance(1)
const edited = structuredClone(original)
edited.presets[3].basePrompt = 'edited active style'
assert.deepEqual(stored(), edited, 'Only the active preset changes after an edit')
assert.equal(run.presetWrites(), 1)

run.preset.getState().loadPreset('preset-1')
assert.equal(run.preset.getState().activePresetId, 'preset-1')
for (const field of ['basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt', 'model', 'steps', 'cfgScale', 'cfgRescale', 'sampler', 'scheduler', 'qualityToggle', 'ucPreset', 'selectedResolution']) {
    assert.deepEqual(json(run.generation.getState()[field]), edited.presets[1][field], `Switch applies ${field}`)
}
assert.equal(run.timers.size, 0, 'Loading a preset must not queue an auto-save or suppression timer')
run.generation.getState().setAdditionalPrompt('edit immediately after switching')
run.advance(500)
edited.activePresetId = 'preset-1'
edited.presets[1].additionalPrompt = 'edit immediately after switching'
assert.deepEqual(stored(), edited)

// A pending debounce must also refuse to write during a later hydration/read failure.
run.generation.getState().setDetailPrompt('not safe to sync while rehydrating')
const rehydrate = run.preset.persist.rehydrate()
run.advance(500)
assert.deepEqual(stored(), edited)
await run.finish(presetKey, true); await rehydrate
run.generation.getState().setNegativePrompt('still not safe after failed read')
run.preset.getState().syncFromGenerationStore()
run.advance(500)
assert.deepEqual(stored(), edited)

const reopened = openStores()
await reopened.finish(presetKey); await reopened.finish(generationKey)
assert.deepEqual(json(reopened.preset.getState()), edited, 'Saved edits and selection survive another store instance')
assert.equal(reopened.presetWrites(), 0)
console.log('Preset hydration passed: no startup writes, both read orders, repeated store recreation, six-record/unknown-field preservation, real generation apply/edit sync, debounce and failed-read protection. No real DB or app used.')
