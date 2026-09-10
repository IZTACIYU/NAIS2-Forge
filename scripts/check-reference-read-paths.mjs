import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const reads = []
const resolutions = []
const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
const filesystem = {
    exists: async path => path === 'current/image.bin',
    readFile: async path => { reads.push(path); assert.equal(path, 'current/image.bin'); return bytes },
    writeFile: () => assert.fail('Read compatibility must not write files'),
}
const modules = new Map()
function load(relativePath) {
    if (modules.has(relativePath)) return modules.get(relativePath)
    const exports = {}
    modules.set(relativePath, exports)
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
        exports, Uint8Array, atob, btoa, console,
        require: name => {
            if (name === '@tauri-apps/plugin-fs') return filesystem
            if (name === '@tauri-apps/api/path' || name === 'jszip') return {}
            if (name === '@tauri-apps/plugin-dialog') return { save: async () => null }
            if (name === '@/lib/image-utils') return load('../src/lib/image-utils.ts')
            if (name === '@tauri-apps/api/core') return {
                invoke: async (command, args) => {
                    assert.equal(command, 'resolve_reference_path')
                    resolutions.push(args.filePath)
                    return args.filePath === 'legacy/image.bin' ? 'current/image.bin' : args.filePath
                },
            }
            throw new Error(`Unexpected dependency: ${name}`)
        },
    })
    return exports
}
const utils = load('../src/lib/image-utils.ts')
assert.equal(await utils.loadReferenceImage('legacy/image.bin'), 'data:image/png;base64,iVBORw==')
assert.equal(await utils.loadEncodedVibe('legacy/image.bin'), 'iVBORw==')
assert.equal(await utils.loadReferenceImage('missing/image.bin'), null)
const image = Object.freeze({ filePath: 'legacy/image.bin', base64: '', name: 'reference' })
assert.equal(await load('../src/lib/reference-export.ts').downloadReferenceImage(image, 'image'), false)
assert.equal(image.filePath, 'legacy/image.bin')
assert.deepEqual(reads, Array(3).fill('current/image.bin'))
assert.deepEqual(resolutions, ['legacy/image.bin', 'legacy/image.bin', 'missing/image.bin', 'legacy/image.bin'])
const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8')
assert.equal((native.match(/let prepared = prepare_generation_references\(\s*&app,/g) || []).length, 2)
assert.match(native, /std::fs::read\(resolve_reference_path\(app, path\)\?\)/)
assert.match(native, /tokio::fs::read\(resolve_reference_path\(app.clone\(\), path.to_string\(\)\)\?\)/)
assert.equal((native.match(/reference.file_path = Some\(resolve_reference_path\(app.clone\(\), path\)\?\)/g) || []).length, 2)
console.log('Reference read routing passed; no user files or network accessed.')
