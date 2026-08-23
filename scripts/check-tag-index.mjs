import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const tags = JSON.parse(await readFile('src/assets/tags.json', 'utf8'))
const aliases = JSON.parse(await readFile('src/assets/tag-aliases.json', 'utf8'))
const tagBytes = await readFile('src/assets/tags.bin')
const aliasBytes = await readFile('src/assets/tag-aliases.bin')
const decoder = new TextDecoder()
const typeCodes = new Map([['general', 0], ['copyright', 1], ['character', 2], ['artist', 3], ['meta', 4]])

assert.equal(tags.length, 300_000)
assert.equal(new Set(tags.map(tag => tag.label)).size, tags.length)
assert.ok(tags.every(tag => (
    tag.label === tag.value
    && Number.isInteger(tag.count)
    && Number.isInteger(tag.danbooruId)
    && typeof tag.danbooruName === 'string'
    && tag.isDeprecated === false
    && typeof tag.createdAt === 'string'
    && typeof tag.updatedAt === 'string'
    && typeCodes.has(tag.type)
)))
assert.ok(tags.every((tag, index) => index === 0 || tags[index - 1].count >= tag.count))

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
assert.ok(aliases.every(alias => tagLabels.has(alias.canonical) && !tagLabels.has(alias.alias)))
assert.equal(aliasBytes.subarray(0, 8).toString('ascii'), 'NAIALI01')
assert.equal(aliasBytes.readUInt32LE(8), aliases.length)
const aliasLength = aliasBytes.readUInt32LE(12)
const canonicalLength = aliasBytes.readUInt32LE(16)
assert.equal(20 + aliasLength + canonicalLength, aliasBytes.length)
assert.deepEqual(decoder.decode(aliasBytes.subarray(20, 20 + aliasLength)).split('\n'), aliases.map(alias => alias.alias))
assert.deepEqual(decoder.decode(aliasBytes.subarray(20 + aliasLength)).split('\n'), aliases.map(alias => alias.canonical))

console.log(`Tag index check passed: ${tags.length.toLocaleString()} tags, ${aliases.length.toLocaleString()} aliases.`)
