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

const writeUint32LE = (bytes: Uint8Array, offset: number, value: number) => {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >>> 8) & 0xff
    bytes[offset + 2] = (value >>> 16) & 0xff
    bytes[offset + 3] = (value >>> 24) & 0xff
}

const fourCC = (bytes: Uint8Array, offset: number) =>
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

const stripPngMetadata = (bytes: Uint8Array) => {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < signature.length || signature.some((value, index) => bytes[index] !== value)) return bytes

    const parts: Uint8Array[] = [bytes.slice(0, 8)]
    const metadataChunks = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf'])
    let offset = 8
    while (offset + 12 <= bytes.length) {
        const length = readUint32BE(bytes, offset)
        const end = offset + 12 + length
        if (end > bytes.length) return bytes
        if (!metadataChunks.has(fourCC(bytes, offset + 4))) parts.push(bytes.slice(offset, end))
        offset = end
    }
    return offset === bytes.length ? concatBytes(parts) : bytes
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

const stripLosslessly = (bytes: Uint8Array, mimeType: ImageMimeType) => {
    if (mimeType === 'image/png') return stripPngMetadata(bytes)
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
        const cleanBytes = stripLosslessly(dataUrlBytes(source), sourceMime)
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
