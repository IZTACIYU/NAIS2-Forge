import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const key = 'nais2-forge-settings'
const original = {
    customResolutions: [
        { id: 'a', label: '세로', width: 832, height: 1216, extra: 'preserve' },
        { id: 'b', label: '横', width: 1216, height: 832 },
        { id: 'c', label: 'Square', width: 1024, height: 1024 },
    ], savePath: 'keep/path', unknownSetting: { keep: true },
}
const disk = new Map([[key, JSON.stringify({ state: original, version: 0 })]])
const storage = {
    getItem: async name => disk.get(name) ?? null,
    setItem: async (name, value) => disk.set(name, value),
    removeItem: () => assert.fail('No removal allowed'),
}
async function loadStore() {
    const exports = {}
    vm.runInNewContext(ts.transpileModule(readFileSync('src/stores/settings-store.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
        exports, console, require: name => name === '@/lib/indexed-db' ? { indexedDBStorage: storage } : require(name),
    })
    const store = exports.useSettingsStore
    if (!store.persist.hasHydrated()) await new Promise(resolve => store.persist.onFinishHydration(resolve))
    return store
}
const store = await loadStore()
assert.deepEqual(JSON.parse(disk.get(key)).state, original)
store.getState().reorderCustomResolution('a', 'c')
assert.deepEqual(JSON.parse(disk.get(key)).state.customResolutions, [original.customResolutions[1], original.customResolutions[2], original.customResolutions[0]])
const restarted = await loadStore()
assert.equal(restarted.getState().customResolutions.map(item => item.id).join(','), 'b,c,a')
for (const [from, to] of [['missing', 'a'], ['a', 'missing'], ['a', 'a']]) {
    const before = disk.get(key)
    restarted.getState().reorderCustomResolution(from, to)
    assert.equal(disk.get(key), before)
}
restarted.getState().reorderCustomResolution('a', 'b')
const saved = JSON.parse(disk.get(key)).state
for (const [field, value] of Object.entries(original)) assert.deepEqual(saved[field], value)

const sceneSource = readFileSync('src/pages/SceneMode.tsx', 'utf8')
const derivedCode = sceneSource.match(/const searchTerm = [\s\S]*?\[scenes, searchTerm\]\)/)[0]
const filter = new Function('scenes', 'sceneSearch', 'useMemo', `${derivedCode}; return visibleScenes`)
const scenes = [{ id: 'a', name: 'Forest 밤' }, { id: 'b', name: '바다' }, { id: 'c', name: 'forest 낮' }]
for (const [query, expected] of [[' FOREST ', ['a', 'c']], ['밤', ['a']], ['missing', []], ['', ['a', 'b', 'c']]]) {
    assert.deepEqual(filter(scenes, query, fn => fn()).map(item => item.id), expected)
}
assert.equal(scenes.length, 3)
assert.match(sceneSource, /SortableContext items=\{visibleScenes\.map/)
assert.match(sceneSource, /sortingDisabled=\{Boolean\(searchTerm\)\}/)
assert.match(sceneSource, /if \(!searchTerm && over/)
assert.match(sceneSource, /applySceneReviewDecisions\(scenes, reviewDecisions\)/)
const resolutionSource = readFileSync('src/components/ui/ResolutionSelector.tsx', 'utf8')
assert.equal((resolutionSource.match(/<SortableResolutionList>/g) || []).length, 2)
assert.match(resolutionSource, /onDragEnd=/)
assert.doesNotMatch(resolutionSource, /onDragOver=|onDragMove=/)
for (const locale of ['ko', 'en', 'ja']) {
    const messages = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'))
    assert.ok(messages.resolutions.reorder && messages.scene.searchByName && messages.scene.noSearchResults)
}
console.log('Resolution reorder/restart/rollback/data preservation and scene name filtering checks passed.')
