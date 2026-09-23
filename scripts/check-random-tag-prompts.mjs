import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { pickRandomTagIndex, resolveRandomTagPrompts } from '../src/lib/random-tag-prompts.ts'

const index = { types: new Uint8Array([2, 2, 2, 1, 3]), counts: new Uint32Array([9, 10, 11, 10, 10]) }
for (const [operator, expected] of [['>', 2], ['>=', 1], ['<', 0], ['<=', 0], ['=', 1]]) {
    assert.equal(pickRandomTagIndex(index, { category: 'character', operator, count: 10, preview: true }), expected)
}
assert.equal(pickRandomTagIndex(index, { category: 'artist', preview: true }), 4)
assert.equal(pickRandomTagIndex(index, { category: 'copyright', preview: true }), 3)
assert.equal(pickRandomTagIndex(index, { category: 'character', operator: '>', count: 11 }), -1)
const originalRandom = Math.random
try {
    Math.random = () => { throw new Error('Preview must not draw randomness') }
    assert.equal(pickRandomTagIndex(index, { category: 'character', preview: true }), 0)
    Math.random = () => 0.99
    assert.equal(pickRandomTagIndex(index, { category: 'character' }), 0)
    Math.random = () => 0
    assert.equal(pickRandomTagIndex(index, { category: 'character' }), 2)
} finally { Math.random = originalRandom }
for (const operator of ['>', '<', '>=', '=>', '<=', '=<', '=']) {
    const output = await resolveRandomTagPrompts(`2::#rArtist ${operator} 100::`, async query => {
        assert.equal(query.category, 'artist')
        assert.equal(query.count, 100)
        assert.equal(query.operator, operator.replace('=>', '>=').replace('=<', '<='))
        return 'test artist'
    })
    assert.equal(output, '2::test artist::')
}
for (const invalid of ['#rCopy >', '#rCopy >=-1', '#rCopy>1.2', '#rCopy>10abc', '#rCopy>>10']) {
    await assert.rejects(resolveRandomTagPrompts(invalid, async () => assert.fail('Malformed filter queried DB')), /Invalid/)
}
await assert.rejects(resolveRandomTagPrompts('#rChara>999', async () => null), /No matching tags/)
assert.equal(await resolveRandomTagPrompts('sky  ,\n#source', async () => assert.fail()), 'sky  ,\n#source')

// Exercise the real worker, bundled DB, fragment processor and request builder.
// No user store, network API, alias DB or persistence is accessed.
const pending = new Map(), cache = new Map()
let requestId = 0, loads = 0
const scope = { postMessage: data => {
    const { resolve, reject } = pending.get(data.id)
    pending.delete(data.id)
    data.error ? reject(new Error(data.error)) : resolve(data.matches[0]?.value ?? null)
} }
function pick(query) {
    return new Promise((resolve, reject) => {
        const id = ++requestId
        pending.set(id, { resolve, reject })
        scope.onmessage({ data: { id, kind: 'random', query } })
    })
}
function load(name) {
    if (name.includes('tags.bin?url')) return { default: 'tags.bin' }
    if (name.includes('tag-aliases.bin?url')) return { default: 'aliases.bin' }
    if (name.endsWith('tag-search-client')) return { pickRandomTag: pick }
    if (name.endsWith('fragment-store')) return {
        normalizeFragmentPath: text => text,
        useFragmentStore: { getState: () => ({
            getRandomLine: async name => name === 'test' ? '#rArtist>=100' : null,
            getSequentialLine: () => assert.fail('No sequential state changes'),
            getFileByPath: name => name === 'test' ? { id: 'test' } : null,
            loadFileContent: async () => ['#rArtist>=100'],
        }) },
    }
    const filename = name.replace(/^@\/lib\//, '').replace(/^\.\//, '').replace(/\.ts$/, '')
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(ts.transpileModule(readFileSync(`src/lib/${filename}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, {
        exports, require: load, self: scope, console, TextDecoder,
        fetch: async url => {
            assert.equal(url, 'tags.bin')
            loads++
            const bytes = readFileSync('src/assets/tags.bin')
            return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
        },
    })
    return exports
}
load('tag-search.worker')
const tags = new Map(JSON.parse(readFileSync('src/assets/tags.json', 'utf8')).map(tag => [tag.value, tag]))
for (const category of ['character', 'artist', 'copyright']) {
    for (let i = 0; i < 10; i++) {
        const value = await pick({ category, operator: '>=', count: 1000 })
        assert.equal(tags.get(value).type, category)
        assert.ok(tags.get(value).count >= 1000)
    }
}
assert.equal(loads, 1)
const fragments = load('fragment-processor')
const expanded = await fragments.processWildcards('#rChara<=100, <test>, #rCopy>=1000')
assert.doesNotMatch(expanded, /#r|<test>/)
assert.equal(await fragments.resolveFragmentsForTokenCount('#rChara<=100, <test>'),
    await fragments.resolveFragmentsForTokenCount('#rChara<=100, <test>'))
const input = {
    positiveParts: [{ value: '#rChara>=100' }, { value: '#rCopy<1000' }],
    negativeParts: [{ value: '#rArtist=>100' }],
    characterInputs: [{ character: { id: 'one', prompt: '#rChara', negative: '#rCopy' } }],
    characterPromptLayoutEnabled: true, characterPositionEnabled: false,
    characterImages: [], vibeImages: [], model: 'nai-diffusion-5-full', modelMode: 'anime',
    qualityToggle: false, qualityTagPreset: 'none', ucPreset: 4,
    promptWhitespaceMode: 'preserve', insertBlankLinesBetweenPromptParts: true,
    removeEmptyPromptSeparators: false, transparentBackground: false,
}
const before = JSON.stringify(input)
const build = load('generation-request').buildGenerationRequest
const result = await build(input)
for (const value of [result.prompt, result.negative_prompt, result.characterPrompts[0].prompt, result.characterPrompts[0].negative]) {
    assert.doesNotMatch(value, /#r(?:Chara|Artist|Copy)/i)
}
assert.equal(JSON.stringify(input), before)
assert.equal(result.generationSources.characterPrompts[0].prompt, '#rChara')
await assert.rejects(build({ ...input, positiveParts: [{ value: '#rChara>4294967295' }] }), /No matching tags/)
console.log('Random tags: filters, aliases of operators, uniform selection endpoints, deterministic preview, real DB/worker, fragments and generation request checks passed.')
