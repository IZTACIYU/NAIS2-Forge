import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import ts from 'typescript'
import { stripDeleteDirectives, deletePromptTags } from '../src/lib/delete-prompts.ts'

const targets = new Set()
assert.equal(stripDeleteDirectives('#del-Blue eyes\r\na,\r\n#DEL-bad hands,', targets), 'a,\r\n')
assert.deepEqual([...targets], ['blue eyes', 'bad hands'])
const del = text => deletePromptTags(text, new Set(['blue eyes']))
for (const [source, expected] of [
    ['blue eyes', ''],
    ['blue eyes, smile', ' smile'],
    ['smile, blue eyes', 'smile'],
    ['a, blue eyes, b', 'a, b'],
    ['2::blue eyes, smile::, sky', '2:: smile::, sky'],
    ['2::blue eyes::, sky', ' sky'],
    ['{blue eyes}, [blue eyes, smile]', ' [ smile]'],
    ['2::{blue eyes}, smile::', '2:: smile::'],
    ['blue eyes\r\nsmile', 'smile'],
    ['dark blue eyes, blue eyeshadow', 'dark blue eyes, blue eyeshadow'],
    ['"blue eyes, smile", blue eyes', '"blue eyes, smile"'],
    ["hands on another's head, blue eyes", "hands on another's head"],
    ['2::blue eyes, smile', '2::blue eyes, smile'],
    ['sky  ,     smile,\n\n#source', 'sky  ,     smile,\n\n#source'],
]) assert.equal(del(source), expected, source)

// Execute the real request builder and prompt dependencies, with only wildcard I/O mocked.
// Compare no-directive outputs to HEAD to catch whitespace/order regressions.
function loadBuilder(previous = false) {
    const cache = new Map()
    function load(name) {
        const filename = name.replace(/^@\/lib\//, '').replace(/^\.\//, '').replace(/\.ts$/, '')
        if (filename === 'fragment-processor') return { processWildcards: async text => text.replace(/<sample>/g, 'blue eyes') }
        if (cache.has(filename)) return cache.get(filename)
        const path = `src/lib/${filename}.ts`
        const source = previous && filename === 'generation-request'
            ? execFileSync('git', ['show', `HEAD:${path}`], { encoding: 'utf8' })
            : readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
        const exports = {}
        cache.set(filename, exports)
        vm.runInNewContext(ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText, { exports, require: load, console })
        return exports
    }
    return load('generation-request').buildGenerationRequest
}
const build = loadBuilder()
const previous = loadBuilder(true)
const input = {
    positiveParts: [{ value: 'blue eyes,  sky  ,     smile,\n\n' }, { value: '2::blue eyes, red hair::' }],
    negativeParts: [{ value: 'blue eyes, bad hands' }],
    characterInputs: [{ character: { id: 'one', name: 'one', prompt: 'girl, blue eyes, <sample>', negative: 'blue eyes, bad hands' } }],
    characterPromptLayoutEnabled: true, characterPositionEnabled: false,
    characterImages: [], vibeImages: [], model: 'nai-diffusion-5-full', modelMode: 'anime',
    qualityToggle: true, qualityTagPreset: 'standard', ucPreset: 0,
    promptWhitespaceMode: 'preserve', insertBlankLinesBetweenPromptParts: true,
    removeEmptyPromptSeparators: false, transparentBackground: true,
}
for (const model of ['nai-diffusion-5-full', 'nai-diffusion-4-5-full']) {
    for (const promptWhitespaceMode of ['preserve', 'compact']) {
        const options = { ...input, model, promptWhitespaceMode }
        assert.equal(JSON.stringify(await build(options)), JSON.stringify(await previous(options)))
    }
}
const options = structuredClone(input)
options.characterInputs[0].appendedPrompts = ['#del-blue eyes\n#del-no text\n#del-transparent background']
options.negativeParts.push({ value: '#del-bad hands' })
const original = JSON.stringify(options)
const result = await build(options)
assert.doesNotMatch(result.prompt, /blue eyes|no text|transparent background|#del-/)
assert.match(result.prompt, /red hair/)
assert.match(result.prompt, /masterpiece/)
assert.doesNotMatch(result.characterPrompts[0].prompt, /blue eyes|#del-/)
assert.match(result.negative_prompt, /blue eyes/)
assert.doesNotMatch(result.negative_prompt, /bad hands|#del-/)
assert.equal(result.characterPrompts[0].negative.trim(), 'blue eyes')
assert.equal(JSON.stringify(options), original)
assert.equal(result.generationSources.characterPrompts[0].prompt, input.characterInputs[0].character.prompt)
// Directives in disabled inputs must not remove active tags; adjacent boxes cannot be consumed.
const disabled = structuredClone(input)
disabled.characterInputs[0].character.prompt = '#del-blue eyes'
disabled.characterInputs[0].character.promptEnabled = false
assert.match((await build(disabled)).prompt, /blue eyes/)
const adjacent = structuredClone(input)
adjacent.insertBlankLinesBetweenPromptParts = false
adjacent.positiveParts = [{ value: '#del-blue eyes' }, { value: 'blue eyes, smile' }]
assert.match((await build(adjacent)).prompt, /smile/)
assert.doesNotMatch((await build(adjacent)).prompt, /blue eyes|#del-/)
// Conditional output may carry a deletion; evaluate conditions first, delete last.
adjacent.positiveParts = [{ value: 'blue eyes, red hair\n#if+blue eyes: #del-red hair' }]
assert.match((await build(adjacent)).prompt, /blue eyes/)
assert.doesNotMatch((await build(adjacent)).prompt, /red hair|#del-/)
const panel = readFileSync(new URL('../src/components/layout/PromptPanel.tsx', import.meta.url), 'utf8')
assert.match(panel, /expertCharacterPromptLayoutEnabled \? buildSceneCharacterPrompt\(character\)/)
assert.match(panel, /stripDeleteDirectives\(text, positiveDeletes\)/)
assert.match(panel, /stripDeleteDirectives\(text, negativeDeletes\)/)
assert.match(panel, /deletePromptTags\(mergeQualityTags/)
console.log('Delete directives: weighted/quoted tags, polarity, shared request, presets, disabled inputs, original data and unchanged payload checks passed.')
