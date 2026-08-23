import { readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src', 'assets', 'tags.json')
const outputPath = path.join(root, 'src', 'assets', 'tags.bin')
const aliasesSourcePath = path.join(root, 'src', 'assets', 'tag-aliases.json')
const aliasesOutputPath = path.join(root, 'src', 'assets', 'tag-aliases.bin')
const typeCodes = new Map([
    ['general', 0],
    ['copyright', 1],
    ['character', 2],
    ['artist', 3],
    ['meta', 4],
])

const writeAtomic = async (filePath, bytes) => {
    const temporaryPath = `${filePath}.tmp`
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, filePath)
}

export async function buildTagIndexes() {
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
        if (tag.label.includes('\n')) throw new Error(`Tag label contains a newline at index ${index}`)

        const typeCode = typeCodes.get(tag.type)
        if (typeCode === undefined) throw new Error(`Unknown tag type: ${tag.type}`)

        counts.writeUInt32LE(tag.count, index * 4)
        types[index] = typeCode
    }

    await writeAtomic(outputPath, Buffer.concat([header, counts, types, labels]))

    const aliases = JSON.parse(await readFile(aliasesSourcePath, 'utf8'))
    const aliasLabels = Buffer.from(aliases.map(alias => alias.alias).join('\n'), 'utf8')
    const canonicalLabels = Buffer.from(aliases.map(alias => alias.canonical).join('\n'), 'utf8')
    const aliasHeader = Buffer.alloc(20)
    aliasHeader.write('NAIALI01', 0, 'ascii')
    aliasHeader.writeUInt32LE(aliases.length, 8)
    aliasHeader.writeUInt32LE(aliasLabels.length, 12)
    aliasHeader.writeUInt32LE(canonicalLabels.length, 16)

    for (const [index, alias] of aliases.entries()) {
        if (alias.alias.includes('\n') || alias.canonical.includes('\n')) {
            throw new Error(`Alias contains a newline at index ${index}`)
        }
    }

    await writeAtomic(aliasesOutputPath, Buffer.concat([aliasHeader, aliasLabels, canonicalLabels]))
    console.log(`Wrote ${tags.length.toLocaleString()} tags and ${aliases.length.toLocaleString()} aliases`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await buildTagIndexes()
}
