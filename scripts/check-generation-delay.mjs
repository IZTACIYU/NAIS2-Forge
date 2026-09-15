import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { calculateGenerationDelay } from '../src/lib/generation-delay.ts'

const random = Math.random
try {
    let calls = 0
    for (const [sample, expected] of [[0, 850], [1 / 3, 900], [0.12345, 868.5175], [0.99999, 999.9985]]) {
        Math.random = () => { calls++; return sample }
        assert.ok(Math.abs(calculateGenerationDelay(900, 100) - expected) < 1e-8)
    }
    assert.equal(calls, 4)
    Math.random = () => assert.fail('Disabled jitter must not draw a random value')
    assert.equal(calculateGenerationDelay(900, 0), 900)
    assert.equal(calculateGenerationDelay(900, NaN), 900)
    Math.random = () => 0
    assert.equal(calculateGenerationDelay(0, 100), 0)
    Math.random = () => 0.5
    assert.equal(calculateGenerationDelay(0, 100), 25)
} finally {
    Math.random = random
}

// Use real Zustand persistence with isolated in-memory storage, never user data.
const require = createRequire(import.meta.url)
const key = 'nais2-forge-settings'
const original = { generationDelay: 1200, savePath: 'keep/me', customResolutions: [{ id: 'keep', width: 832, height: 1216 }], unknownSetting: 'preserve' }
const disk = new Map([[key, JSON.stringify({ state: original, version: 0 })]])
const source = readFileSync(new URL('../src/stores/settings-store.ts', import.meta.url), 'utf8')
const storage = {
    getItem: async name => disk.get(name) ?? null,
    setItem: async (name, value) => disk.set(name, value),
    removeItem: () => assert.fail('Settings upgrade must not delete storage'),
}
async function loadStore() {
    const exports = {}
    vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
        exports, console,
        require: name => name === '@/lib/indexed-db' ? { indexedDBStorage: storage } : require(name),
    })
    const store = exports.useSettingsStore
    if (!store.persist.hasHydrated()) await new Promise(resolve => store.persist.onFinishHydration(resolve))
    return store
}
const store = await loadStore()
assert.equal(store.getState().generationDelayJitter, 0)
assert.equal(store.getState().acknowledgedAnnouncementId, '')
assert.deepEqual(JSON.parse(disk.get(key)).state, original)
store.getState().setGenerationDelayJitter(100)
store.getState().acknowledgeAnnouncement('1.10.3-generation-delay')
const restarted = await loadStore()
assert.equal(restarted.getState().generationDelayJitter, 100)
assert.equal(restarted.getState().acknowledgedAnnouncementId, '1.10.3-generation-delay')
const saved = JSON.parse(disk.get(key)).state
for (const [field, value] of Object.entries(original)) assert.deepEqual(saved[field], value)
for (const [value, expected] of [[NaN, 0], [-5, 0], [Infinity, 0], [9999, 5000]]) {
    restarted.getState().setGenerationDelayJitter(value)
    assert.equal(restarted.getState().generationDelayJitter, expected)
}
for (const path of ['../src/stores/generation-store.ts', '../src/hooks/useSceneGeneration.ts']) {
    const caller = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(caller, /calculateGenerationDelay\(generationDelay, generationDelayJitter\)/)
    assert.doesNotMatch(caller, /setTimeout\(resolve, generationDelay\)/)
}
const dialog = readFileSync(new URL('../src/components/AnnouncementDialog.tsx', import.meta.url), 'utf8')
assert.match(dialog, /hydrated && acknowledged !== ANNOUNCEMENT_ID/)
assert.match(dialog, /onFinishHydration/)
assert.match(dialog, /acknowledge\(ANNOUNCEMENT_ID\)/)
for (const language of ['ko', 'en', 'ja']) {
    const locale = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))
    assert.ok(locale.announcement.title && locale.announcement.body && locale.announcement.confirm)
    assert.ok(locale.settingsPage.generationDelayJitter.description)
}
console.log('Fractional jitter, both callers, legacy settings preservation and acknowledgement restart checks passed.')
