export interface StrippedImage {
    blob: Blob
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    extension: 'png' | 'jpg' | 'webp'
    width: number
    height: number
}

export type ExifOutputFormat = 'jpeg' | 'png' | 'webp'

export const imageMimeFromName = (name: string) => {
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

export const stripImageMetadata = async (source: string, outputFormat: ExifOutputFormat): Promise<StrippedImage> => {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Failed to decode image'))
        image.src = source
    })

    const width = image.naturalWidth
    const height = image.naturalHeight
    const shrinkCanvas = document.createElement('canvas')
    shrinkCanvas.width = Math.max(1, width - 1)
    shrinkCanvas.height = Math.max(1, height - 1)
    const shrinkContext = shrinkCanvas.getContext('2d')
    if (!shrinkContext) throw new Error('Shrink canvas is not available')
    shrinkContext.drawImage(image, 0, 0, shrinkCanvas.width, shrinkCanvas.height)
    image.src = ''

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Final canvas is not available')
    context.imageSmoothingEnabled = false
    context.drawImage(shrinkCanvas, 0, 0, width, height)

    const format = outputType(outputFormat)
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            result => result ? resolve(result) : reject(new Error('Failed to encode image')),
            format.mimeType,
            1
        )
    })
    shrinkCanvas.width = 0
    shrinkCanvas.height = 0
    canvas.width = 0
    canvas.height = 0

    return { blob, ...format, width, height }
}
