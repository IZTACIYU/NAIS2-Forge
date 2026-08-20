import assert from 'node:assert/strict'
import { deflate, inflate } from 'pako'
import { stripPngMetadataBytes } from '../src/lib/exif-stripper.ts'

const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
        table[index] = value >>> 0
    }
    return table
})()

const crc32 = (bytes: Uint8Array) => {
    let value = 0xffffffff
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
}

const writeUint32 = (bytes: Uint8Array, offset: number, value: number) =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false)

const chunk = (type: string, data = new Uint8Array()) => {
    const result = new Uint8Array(data.length + 12)
    writeUint32(result, 0, data.length)
    result.set(new TextEncoder().encode(type), 4)
    result.set(data, 8)
    writeUint32(result, data.length + 8, crc32(result.subarray(4, data.length + 8)))
    return result
}

const concat = (parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

const textBits = (value: string) => [...new TextEncoder().encode(value)]
    .flatMap(byte => byte.toString(2).padStart(8, '0').split('').map(Number))

const numberBits = (value: number) => value.toString(2).padStart(32, '0').split('').map(Number)

const width = 512
const pixels = new Uint8Array(width * 4)
for (let x = 0; x < width; x++) pixels.set([12, 34, 56, 255], x * 4)

const payload = new TextEncoder().encode('{"Comment":"secret"}')
const hiddenBits = [
    ...textBits('stealth_pngcomp'),
    ...numberBits(payload.length * 8),
    ...[...payload].flatMap(byte => byte.toString(2).padStart(8, '0').split('').map(Number)),
]
hiddenBits.forEach((bit, position) => {
    pixels[position * 4 + 3] = (pixels[position * 4 + 3] & 0xfe) | bit
})

const ihdr = new Uint8Array(13)
writeUint32(ihdr, 0, width)
writeUint32(ihdr, 4, 1)
ihdr.set([8, 6, 0, 0, 0], 8)
const text = new TextEncoder().encode('Comment\0visible metadata')
const source = concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('tEXt', text),
    chunk('IDAT', deflate(concat([new Uint8Array([0]), pixels]))),
    chunk('IEND'),
])

const stripped = await stripPngMetadataBytes(source)
let offset = 8
const idat: Uint8Array[] = []
while (offset + 12 <= stripped.length) {
    const length = new DataView(stripped.buffer, stripped.byteOffset + offset, 4).getUint32(0, false)
    const type = new TextDecoder().decode(stripped.subarray(offset + 4, offset + 8))
    assert.ok(!['tEXt', 'zTXt', 'iTXt', 'eXIf'].includes(type))
    if (type === 'IDAT') idat.push(stripped.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
}

const decoded = inflate(concat(idat))
assert.equal(decoded[0], 0)
const outputPixels = decoded.subarray(1)
for (let x = 0; x < width; x++) {
    const index = x * 4
    assert.deepEqual([...outputPixels.subarray(index, index + 3)], [...pixels.subarray(index, index + 3)])
    assert.ok(outputPixels[index + 3] === pixels[index + 3] || outputPixels[index + 3] === pixels[index + 3] + 1)
}

let signature = ''
for (let byte = 0; byte < 'stealth_pngcomp'.length; byte++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) value = (value << 1) | (outputPixels[(byte * 8 + bit) * 4 + 3] & 1)
    signature += String.fromCharCode(value)
}
assert.notEqual(signature, 'stealth_pngcomp')
assert.notEqual(signature, 'stealth_pnginfo')

console.log('EXIF strip check passed: PNG text chunks and stealth alpha payload removed; RGB preserved.')
