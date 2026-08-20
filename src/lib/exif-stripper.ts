export interface StrippedImage {
    blob: Blob
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    extension: 'png' | 'jpg' | 'webp'
    width: number
    height: number
}

export type ExifOutputFormat = 'jpeg' | 'png' | 'webp'

type ImageMimeType = StrippedImage['mimeType']

export const imageMimeFromName = (name: string): ImageMimeType => {
    const extension = name.split('.').pop()?.toLowerCase()
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
    if (extension === 'webp') return 'image/webp'
    return 'image/png'
}

export const bytesToImageDataUrl = (bytes: Uint8Array, name = ''): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(reader.error || new Error('Failed to read image'))
        const buffer = Uint8Array.from(bytes).buffer
        reader.readAsDataURL(new Blob([buffer], { type: imageMimeFromName(name) }))
    })

const outputType = (format: ExifOutputFormat): Pick<StrippedImage, 'mimeType' | 'extension'> => {
    if (format === 'jpeg') return { mimeType: 'image/jpeg', extension: 'jpg' }
    if (format === 'webp') return { mimeType: 'image/webp', extension: 'webp' }
    return { mimeType: 'image/png', extension: 'png' }
}

const concatBytes = (parts: Uint8Array[]) => {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

const sourceMimeType = (source: string): ImageMimeType | null => {
    const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,/i.exec(source)
    if (!match) return null
    if (match[1].toLowerCase() === 'image/jpg') return 'image/jpeg'
    return match[1].toLowerCase() as ImageMimeType
}

const dataUrlBytes = (source: string) => {
    const encoded = source.slice(source.indexOf(',') + 1)
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
}

const readUint32BE = (bytes: Uint8Array, offset: number) =>
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0

const writeUint32BE = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = (value >>> 24) & 0xff
    bytes[offset + 1] = (value >>> 16) & 0xff
    bytes[offset + 2] = (value >>> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}

const writeUint32LE = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
    bytes[offset + 3] = (value >>> 24) & 0xff
}

const fourCC = (bytes: Uint8Array, offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

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

const createPngChunk = (type: string, data: Uint8Array) => {
    const chunk = new Uint8Array(data.length + 12)
    writeUint32BE(chunk, 0, data.length)
    for (let index = 0; index < 4; index++) chunk[index + 4] = type.charCodeAt(index)
    chunk.set(data, 8)
    writeUint32BE(chunk, data.length + 8, crc32(chunk.subarray(4, data.length + 8)))
    return chunk
}

const paethPredictor = (left: number, up: number, upperLeft: number) => {
    const estimate = left + up - upperLeft
    const leftDistance = Math.abs(estimate - left)
    const upDistance = Math.abs(estimate - up)
    const upperLeftDistance = Math.abs(estimate - upperLeft)
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
    return upDistance <= upperLeftDistance ? up : upperLeft
}

const unfilterPngRows = (filtered: Uint8Array, width: number, height: number, bytesPerPixel: number) => {
    const rowLength = width * bytesPerPixel
    if (filtered.length !== height * (rowLength + 1)) return null

    const filters = new Uint8Array(height)
    const rows: Uint8Array[] = []
    let offset = 0
    let previous: Uint8Array = new Uint8Array(rowLength)
    for (let y = 0; y < height; y++) {
        const filter = filtered[offset++]
        if (filter > 4) return null
        filters[y] = filter
        const row = new Uint8Array(rowLength)
        for (let x = 0; x < rowLength; x++) {
            const encoded = filtered[offset++]
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0
            const up = previous[x]
            const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0
            const predictor = filter === 1
                ? left
                : filter === 2
                    ? up
                    : filter === 3
                        ? Math.floor((left + up) / 2)
                        : filter === 4
                            ? paethPredictor(left, up, upperLeft)
                            : 0
            row[x] = (encoded + predictor) & 0xff
        }
        rows.push(row)
        previous = row
    }
    return { filters, rows }
}

const filterPngRows = (rows: Uint8Array[], filters: Uint8Array, bytesPerPixel: number) => {
    const rowLength = rows[0]?.length ?? 0
    const filtered = new Uint8Array(rows.length * (rowLength + 1))
    let offset = 0
    let previous: Uint8Array = new Uint8Array(rowLength)
    rows.forEach((row, y) => {
        const filter = filters[y]
        filtered[offset++] = filter
        for (let x = 0; x < rowLength; x++) {
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0
            const up = previous[x]
            const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0
            const predictor = filter === 1
                ? left
                : filter === 2
                    ? up
                    : filter === 3
                        ? Math.floor((left + up) / 2)
                        : filter === 4
                            ? paethPredictor(left, up, upperLeft)
                            : 0
            filtered[offset++] = (row[x] - predictor) & 0xff
        }
        previous = row
    })
    return filtered
}

const clearStealthAlphaPayload = (
    rows: Uint8Array[],
    width: number,
    height: number,
    bytesPerPixel: number,
    alphaOffset: number,
) => {
    const signatureBitCount = 'stealth_pnginfo'.length * 8
    const pixelCount = width * height
    if (pixelCount < signatureBitCount + 32) return false

    const alphaBit = (position: number) => {
        const x = Math.floor(position / height)
        const y = position % height
        return rows[y][x * bytesPerPixel + alphaOffset] & 1
    }
    let signature = ''
    for (let byte = 0; byte < signatureBitCount; byte += 8) {
        let value = 0
        for (let bit = 0; bit < 8; bit++) value = (value << 1) | alphaBit(byte + bit)
        signature += String.fromCharCode(value)
    }
    if (signature !== 'stealth_pnginfo' && signature !== 'stealth_pngcomp') return false

    let payloadBitCount = 0
    for (let bit = 0; bit < 32; bit++) payloadBitCount = (payloadBitCount * 2) + alphaBit(signatureBitCount + bit)
    const totalBitCount = signatureBitCount + 32 + payloadBitCount
    if (!Number.isSafeInteger(totalBitCount) || totalBitCount > pixelCount) return false

    for (let position = 0; position < totalBitCount; position++) {
        const x = Math.floor(position / height)
        const y = position % height
        const alphaIndex = x * bytesPerPixel + alphaOffset
        rows[y][alphaIndex] |= 1
    }
    return true
}

export const stripPngMetadataBytes = async (bytes: Uint8Array) => {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) return bytes

    const chunks: Array<{ type: string; bytes: Uint8Array; data: Uint8Array }> = []
    const metadataChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf'])
    let offset = 8
    while (offset + 12 <= bytes.length) {
        const length = readUint32BE(bytes, offset)
        const end = offset + 12 + length
        if (end > bytes.length) return bytes
        chunks.push({
            type: fourCC(bytes, offset + 4),
            bytes: bytes.slice(offset, end),
            data: bytes.slice(offset + 8, end - 4),
        })
        offset = end
    }
    if (offset !== bytes.length) return bytes

    const strippedParts = () => concatBytes([
        bytes.slice(0, 8),
        ...chunks.filter(chunk => !metadataChunks.has(chunk.type)).map(chunk => chunk.bytes),
    ])
    const ihdr = chunks.find(chunk => chunk.type === 'IHDR')?.data
    const idatChunks = chunks.filter(chunk => chunk.type === 'IDAT')
    if (!ihdr || ihdr.length !== 13 || idatChunks.length === 0) return strippedParts()

    const width = readUint32BE(ihdr, 0)
    const height = readUint32BE(ihdr, 4)
    const bitDepth = ihdr[8]
    const colorType = ihdr[9]
    const interlace = ihdr[12]
    const bytesPerPixel = colorType === 6 ? 4 : colorType === 4 ? 2 : 0
    const alphaOffset = colorType === 6 ? 3 : colorType === 4 ? 1 : -1
    if (bitDepth !== 8 || interlace !== 0 || bytesPerPixel === 0) return strippedParts()

    try {
        const { deflate, inflate } = await import('pako')
        const decoded = unfilterPngRows(inflate(concatBytes(idatChunks.map(chunk => chunk.data))), width, height, bytesPerPixel)
        if (!decoded || !clearStealthAlphaPayload(decoded.rows, width, height, bytesPerPixel, alphaOffset)) return strippedParts()

        const replacementIdat = createPngChunk('IDAT', deflate(filterPngRows(decoded.rows, decoded.filters, bytesPerPixel)))
        const parts: Uint8Array[] = [bytes.slice(0, 8)]
        let idatWritten = false
        for (const chunk of chunks) {
            if (metadataChunks.has(chunk.type)) continue
            if (chunk.type === 'IDAT') {
                if (!idatWritten) parts.push(replacementIdat)
                idatWritten = true
                continue
            }
            parts.push(chunk.bytes)
        }
        return concatBytes(parts)
    } catch {
        return strippedParts()
    }
}

const stripJpegMetadata = (bytes: Uint8Array) => {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes

    const parts: Uint8Array[] = [bytes.slice(0, 2)]
    const removableMarkers = new Set([0xe1, 0xed, 0xfe]) // EXIF/XMP, IPTC, comment
    let offset = 2
    while (offset < bytes.length) {
        const markerStart = offset
        if (bytes[offset] !== 0xff) return bytes
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
        if (offset >= bytes.length) return bytes
        const marker = bytes[offset]
        offset += 1

        if (marker === 0xda) {
            parts.push(bytes.slice(markerStart))
            return concatBytes(parts)
        }
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
            parts.push(bytes.slice(markerStart, offset))
            continue
        }
        if (offset + 2 > bytes.length) return bytes
        const length = (bytes[offset] << 8) | bytes[offset + 1]
        const end = offset + length
        if (length < 2 || end > bytes.length) return bytes
        if (!removableMarkers.has(marker)) parts.push(bytes.slice(markerStart, end))
        offset = end
    }
    return concatBytes(parts)
}

const stripWebpMetadata = (bytes: Uint8Array) => {
    if (bytes.length < 12 || fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') return bytes

    const parts: Uint8Array[] = [bytes.slice(0, 12)]
    let offset = 12
    while (offset + 8 <= bytes.length) {
        const size = readUint32LE(bytes, offset + 4)
        const paddedSize = size + (size % 2)
        const end = offset + 8 + paddedSize
        if (end > bytes.length) return bytes
        const type = fourCC(bytes, offset)
        if (type !== 'EXIF' && type !== 'XMP ') parts.push(bytes.slice(offset, end))
        offset = end
    }
    if (offset !== bytes.length) return bytes

    const result = concatBytes(parts)
    writeUint32LE(result, 4, result.length - 8)
    return result
}

const readUint32LE = (bytes: Uint8Array, offset: number) =>
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0

const stripLosslessly = async (bytes: Uint8Array, mimeType: ImageMimeType) => {
    if (mimeType === 'image/png') return stripPngMetadataBytes(bytes)
    if (mimeType === 'image/jpeg') return stripJpegMetadata(bytes)
    return stripWebpMetadata(bytes)
}

const loadDimensions = (source: string) => new Promise<{ width: number, height: number }>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
        const dimensions = { width: image.naturalWidth, height: image.naturalHeight }
        image.src = ''
        resolve(dimensions)
    }
    image.onerror = () => reject(new Error('Failed to decode image'))
    image.src = source
})

export const stripImageMetadata = async (source: string, outputFormat: ExifOutputFormat): Promise<StrippedImage> => {
    const format = outputType(outputFormat)
    const sourceMime = sourceMimeType(source)
    const { width, height } = await loadDimensions(source)

    // Keeping the source format lets us remove only metadata chunks, preserving every pixel and color profile.
    if (sourceMime === format.mimeType) {
        const cleanBytes = await stripLosslessly(dataUrlBytes(source), sourceMime)
        return {
            blob: new Blob([Uint8Array.from(cleanBytes).buffer], { type: format.mimeType }),
            ...format,
            width,
            height,
        }
    }

    // A format conversion must re-encode the image, but it should never resample it first.
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Failed to decode image'))
        image.src = source
    })

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(image, 0, 0)
    image.src = ''

    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            result => result ? resolve(result) : reject(new Error('Failed to encode image')),
            format.mimeType,
            1
        )
    })
    canvas.width = 0
    canvas.height = 0

    return { blob, ...format, width, height }
}
