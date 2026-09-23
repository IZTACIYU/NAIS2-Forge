import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/components/ui/AutocompleteTextarea.tsx', 'utf8')
const helpers = source.slice(source.indexOf('    const getCurrentWord ='), source.indexOf('    const showSuggestionsAtCaret ='))
const { getCurrentWord, getDirectiveWord, getWildcardWord } = new Function(ts.transpileModule(
    helpers + '\nreturn { getCurrentWord, getDirectiveWord, getWildcardWord }',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText)()
for (const prefix of ['#rChara', '#rArtist>100', '#rCopy<=500', '#rCopy=<500', '#rArtist>=100', '#rArtist=>100', '2::#rChara<500::', 'sky, #rCopy<100']) {
    for (const separator of [', ', '\n']) {
        const value = prefix + separator + 'blue'
        assert.equal(getDirectiveWord(value, value.length), null, value)
        assert.equal(getWildcardWord(value, value.length), null, value)
        assert.equal(getCurrentWord(value, value.length), 'blue', value)
        const start = value.match(/[^,\n:]*$/).index
        assert.equal(value.slice(0, start).trimEnd(), (prefix + separator).trimEnd())
    }
}
for (const value of ['#r', '#rChara', '#rArtist<100']) assert.equal(getDirectiveWord(value, value.length), value)
assert.equal(getDirectiveWord('#if+girl: blue', 14), null)
for (const value of ['<hair', '#rCopy<100, <hair', '#rCopy<100\n<hair']) {
    assert.equal(getWildcardWord(value, value.length), 'hair')
}
const mid = '#rCopy<100, blue, later'
assert.equal(getDirectiveWord(mid, mid.indexOf(', later')), null)
assert.equal(getWildcardWord(mid, mid.indexOf(', later')), null)
console.log('Random directive boundaries, comparison-vs-fragment detection and subsequent tag insertion checks passed.')
