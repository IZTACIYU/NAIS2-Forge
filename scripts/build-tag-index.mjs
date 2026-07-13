import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src', 'assets', 'tags.json')
const outputPath = path.join(root, 'src', 'assets', 'tags.bin')
const typeCodes = new Map([
    ['general', 0],
    ['copyright', 1],
    ['character', 2],
    ['artist', 3],
])

const tags = JSON.parse(await readFile(sourcePath, 'utf8'))
const labels = Buffer.from(tags.map(tag => tag.label).join('\n'), 'utf8')
const header = Buffer.alloc(16)
header.write('NAITAG01', 0, 'ascii')
header.writeUInt32LE(tags.length, 8)
header.writeUInt32LE(labels.length, 12)

const counts = Buffer.alloc(tags.length * 4)
const types = Buffer.alloc(tags.length)

for (let index = 0; index < tags.length; index++) {
    const tag = tags[index]
    if (tag.value !== tag.label) throw new Error(`Tag value differs from label at index ${index}`)

    const typeCode = typeCodes.get(tag.type)
    if (typeCode === undefined) throw new Error(`Unknown tag type: ${tag.type}`)

    counts.writeUInt32LE(tag.count, index * 4)
    types[index] = typeCode
}

await writeFile(outputPath, Buffer.concat([header, counts, types, labels]))
console.log(`Wrote ${tags.length.toLocaleString()} tags to ${path.relative(root, outputPath)}`)
