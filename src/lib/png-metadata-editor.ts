export type PngTextMetadata = Record<string, string>

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8')

const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
        let value = index
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
        }
        table[index] = value >>> 0
    }
    return table
})()

const crc32 = (bytes: Uint8Array) => {
    let value = 0xffffffff
    for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
    return (value ^ 0xffffffff) >>> 0
}

const dataUrlToBytes = (dataUrl: string) => {
    const separator = dataUrl.indexOf(',')
    if (separator < 0) throw new Error('Invalid image data')
    const binary = atob(dataUrl.slice(separator + 1))
    return Uint8Array.from(binary, char => char.charCodeAt(0))
}

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((value, index) => bytes[index] === value)

const getChunkType = (bytes: Uint8Array, offset: number) => textDecoder.decode(bytes.subarray(offset + 4, offset + 8))

const createTextChunk = (key: string, value: string) => {
    const keyBytes = textEncoder.encode(key)
    const valueBytes = textEncoder.encode(value)
    const data = new Uint8Array(keyBytes.length + 1 + valueBytes.length)
    data.set(keyBytes)
    data[keyBytes.length] = 0
    data.set(valueBytes, keyBytes.length + 1)

    const chunk = new Uint8Array(data.length + 12)
    const view = new DataView(chunk.buffer)
    view.setUint32(0, data.length, false)
    chunk.set(textEncoder.encode('tEXt'), 4)
    chunk.set(data, 8)
    const crcInput = new Uint8Array(data.length + 4)
    crcInput.set(chunk.subarray(4, 8))
    crcInput.set(data, 4)
    view.setUint32(data.length + 8, crc32(crcInput), false)
    return chunk
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

const walkChunks = (bytes: Uint8Array, visitor: (type: string, offset: number, end: number) => void) => {
    if (!isPng(bytes)) throw new Error('PNG metadata editing supports PNG files only')
    let offset = 8
    while (offset + 12 <= bytes.length) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false)
        const end = offset + 12 + length
        if (end > bytes.length) throw new Error('Invalid PNG chunk')
        const type = getChunkType(bytes, offset)
        visitor(type, offset, end)
        offset = end
        if (type === 'IEND') return
    }
    throw new Error('PNG is missing an IEND chunk')
}

export const readPngTextMetadata = (dataUrl: string): PngTextMetadata => {
    const metadata: PngTextMetadata = {}
    const bytes = dataUrlToBytes(dataUrl)
    walkChunks(bytes, (type, offset, end) => {
        if (type !== 'tEXt') return
        const data = bytes.subarray(offset + 8, end - 4)
        const separator = data.indexOf(0)
        if (separator < 1) return
        const key = textDecoder.decode(data.subarray(0, separator))
        metadata[key] = textDecoder.decode(data.subarray(separator + 1))
    })
    return metadata
}

export const writePngTextMetadata = (dataUrl: string, metadata: PngTextMetadata) => {
    const bytes = dataUrlToBytes(dataUrl)
    const chunks: Uint8Array[] = [bytes.subarray(0, 8)]
    let iend: Uint8Array | null = null

    walkChunks(bytes, (type, offset, end) => {
        const chunk = bytes.subarray(offset, end)
        if (type === 'tEXt') return
        if (type === 'IEND') {
            iend = chunk
            return
        }
        chunks.push(chunk)
    })

    for (const [key, value] of Object.entries(metadata)) {
        if (!key || typeof value !== 'string') continue
        chunks.push(createTextChunk(key, value))
    }
    if (!iend) throw new Error('PNG is missing an IEND chunk')
    chunks.push(iend)
    return concat(chunks)
}
