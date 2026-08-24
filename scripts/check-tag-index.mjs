import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { searchTagIndexes } from '../src/lib/tag-search-ranking.ts'

const tags = JSON.parse(await readFile('src/assets/tags.json', 'utf8'))
const legacyTags = JSON.parse(await readFile('src/assets/legacy-tags.json', 'utf8'))
const aliases = JSON.parse(await readFile('src/assets/tag-aliases.json', 'utf8'))
const metadata = JSON.parse(await readFile('src/assets/tags.meta.json', 'utf8'))
const tagBytes = await readFile('src/assets/tags.bin')
const aliasBytes = await readFile('src/assets/tag-aliases.bin')
const decoder = new TextDecoder()
const typeCodes = new Map([['general', 0], ['copyright', 1], ['character', 2], ['artist', 3], ['meta', 4]])

assert.equal(metadata.currentTags, 300_000)
assert.equal(metadata.legacySourceTags, legacyTags.length)
assert.equal(metadata.legacyAppTags, tags.filter(tag => tag.isLegacy).length)
assert.equal(metadata.appTags, tags.length)
assert.equal(legacyTags.length, 21_306)
assert.equal(metadata.legacyAppTags, 21_288)
assert.equal(tags.length, 321_288)
assert.equal(new Set(tags.map(tag => tag.label)).size, tags.length)
assert.ok(tags.every(tag => (
    tag.label === tag.value
    && Number.isInteger(tag.count)
    && typeCodes.has(tag.type)
    && (tag.isLegacy === true || (
        Number.isInteger(tag.danbooruId)
        && typeof tag.danbooruName === 'string'
        && tag.isDeprecated === false
        && typeof tag.createdAt === 'string'
        && typeof tag.updatedAt === 'string'
    ))
)))
assert.ok(tags.every((tag, index) => index === 0 || tags[index - 1].count >= tag.count))
assert.equal(new Set(legacyTags.map(tag => tag.label)).size, legacyTags.length)
assert.ok(legacyTags.every(tag => tag.label === tag.value && Number.isInteger(tag.count) && typeCodes.has(tag.type)))

assert.equal(tagBytes.subarray(0, 8).toString('ascii'), 'NAITAG01')
assert.equal(tagBytes.readUInt32LE(8), tags.length)
const labelLength = tagBytes.readUInt32LE(12)
const typeOffset = 16 + tags.length * 4
const labelOffset = typeOffset + tags.length
assert.equal(labelOffset + labelLength, tagBytes.length)
assert.ok(tagBytes.subarray(typeOffset, labelOffset).every(type => type <= 4))
assert.deepEqual(decoder.decode(tagBytes.subarray(labelOffset)).split('\n'), tags.map(tag => tag.label))
tags.forEach((tag, index) => {
    assert.equal(tagBytes.readUInt32LE(16 + index * 4), tag.count)
    assert.equal(tagBytes[typeOffset + index], typeCodes.get(tag.type))
})

assert.equal(new Set(aliases.map(alias => alias.alias)).size, aliases.length)
assert.ok(aliases.every(alias => alias.alias !== alias.canonical))
const tagLabels = new Set(tags.map(tag => tag.label))
const legacyLabels = new Set(legacyTags.map(tag => tag.label))
assert.ok(legacyTags.every(tag => tagLabels.has(tag.label)))
assert.ok(aliases.every(alias => tagLabels.has(alias.canonical) && (!tagLabels.has(alias.alias) || legacyLabels.has(alias.alias))))
assert.equal(aliases.filter(alias => legacyLabels.has(alias.alias)).length, 6_001)
assert.equal(aliasBytes.subarray(0, 8).toString('ascii'), 'NAIALI01')
assert.equal(aliasBytes.readUInt32LE(8), aliases.length)
const aliasLength = aliasBytes.readUInt32LE(12)
const canonicalLength = aliasBytes.readUInt32LE(16)
assert.equal(20 + aliasLength + canonicalLength, aliasBytes.length)
assert.deepEqual(decoder.decode(aliasBytes.subarray(20, 20 + aliasLength)).split('\n'), aliases.map(alias => alias.alias))
assert.deepEqual(decoder.decode(aliasBytes.subarray(20 + aliasLength)).split('\n'), aliases.map(alias => alias.canonical))

const exactTags = new Map(tags.map((tag, index) => [tag.label.toLowerCase(), index]))
const prefixBuckets = {}
tags.forEach((tag, index) => (prefixBuckets[tag.label[0].toLowerCase()] ||= []).push(index))
const prefixIndex = Object.fromEntries(Object.entries(prefixBuckets).map(([key, indexes]) => [key, Uint32Array.from(indexes)]))
const aliasIndex = new Map(aliases.map(alias => [alias.alias.toLowerCase(), exactTags.get(alias.canonical.toLowerCase())]))
const searchableIndex = { labels: tags.map(tag => tag.label), prefixIndex, exactTags }
const legacyAliasMatches = searchTagIndexes(searchableIndex, aliasIndex, 'see-through', 10).map(index => tags[index].label)
assert.deepEqual(legacyAliasMatches.slice(0, 2), ['see-through', 'see-through clothes'])
assert.ok(searchTagIndexes(searchableIndex, aliasIndex, 'aida suru', 10).some(index => tags[index].label === 'aida rayhunton'))
assert.equal(searchTagIndexes(searchableIndex, aliasIndex, 'blond', 20).filter(index => tags[index].label === 'blonde hair').length, 1)
assert.equal(tags[searchTagIndexes(searchableIndex, aliasIndex, '1girl', 10)[0]].label, '1girl')

console.log(`Tag index check passed: ${tags.length.toLocaleString()} tags, ${aliases.length.toLocaleString()} aliases.`)
