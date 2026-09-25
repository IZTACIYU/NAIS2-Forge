import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const key = 'nais2-forge-settings'
const original = { imageFormat: 'webp', savePath: 'keep/path', unknownSetting: { keep: true } }
const disk = new Map([[key, JSON.stringify({ state: original, version: 0 })]])
const storage = {
    getItem: async name => disk.get(name) ?? null,
    setItem: async (name, value) => disk.set(name, value),
    removeItem: () => assert.fail('Existing settings must not be removed'),
}
async function loadStore() {
    const exports = {}
    vm.runInNewContext(ts.transpileModule(readFileSync('src/stores/settings-store.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
        exports, console, require: name => name === '@/lib/indexed-db' ? { indexedDBStorage: storage } : require(name),
    })
    if (!exports.useSettingsStore.persist.hasHydrated()) {
        await new Promise(resolve => exports.useSettingsStore.persist.onFinishHydration(resolve))
    }
    return exports.useSettingsStore
}

const store = await loadStore()
assert.equal(store.getState().exportImageFormat, 'png')
assert.equal(store.getState().exportWebpQuality, 90)
assert.deepEqual(JSON.parse(disk.get(key)).state, original)
store.getState().setExportImageFormat('webp')
store.getState().setExportWebpQuality(72)
store.getState().setExportImageFormat('jpeg')
const restarted = await loadStore()
assert.equal(restarted.getState().exportImageFormat, 'jpeg')
assert.equal(restarted.getState().exportWebpQuality, 72)
for (const [field, value] of Object.entries(original)) assert.deepEqual(JSON.parse(disk.get(key)).state[field], value)

const calls = []
const imageActions = {}
class FileReaderStub {
    readAsDataURL() {
        this.result = 'data:image/webp;base64,d2VicA=='
        this.onload()
    }
}
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/exif-actions.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
    exports: imageActions, FileReader: FileReaderStub,
    require: name => name === '@/lib/exif-stripper'
        ? { stripImageMetadata: async (...args) => {
            calls.push(args)
            return { blob: {}, mimeType: 'image/webp', extension: 'webp' }
        } }
        : name === '@/stores/settings-store' ? { useSettingsStore: store } : {},
})
const png = 'data:image/png;base64,cG5n'
assert.equal((await imageActions.prepareImageForR2Upload(png, 'png', 72, false)).contentBase64, 'cG5n')
assert.equal(calls.length, 0)
const converted = await imageActions.prepareImageForR2Upload(png, 'webp', 72, false)
assert.deepEqual(calls[0], [png, 'webp', 0.72, true])
assert.equal(converted.extension, 'webp')
assert.equal(converted.contentType, 'image/webp')
console.log('Export defaults and R2 image preparation checks passed.')
