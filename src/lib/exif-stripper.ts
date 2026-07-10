export interface StrippedImage {
    blob: Blob
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    extension: 'png' | 'jpg' | 'webp'
    width: number
    height: number
}

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

const outputType = (source: string): Pick<StrippedImage, 'mimeType' | 'extension'> => {
    const mimeType = source.match(/^data:(image\/(?:png|jpeg|webp));/i)?.[1]?.toLowerCase()
    if (mimeType === 'image/jpeg') return { mimeType, extension: 'jpg' }
    if (mimeType === 'image/webp') return { mimeType, extension: 'webp' }
    return { mimeType: 'image/png', extension: 'png' }
}

export const stripImageMetadata = async (source: string): Promise<StrippedImage> => {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Failed to decode image'))
        image.src = source
    })

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(image, 0, 0)
    image.src = ''

    const format = outputType(source)
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            result => result ? resolve(result) : reject(new Error('Failed to encode image')),
            format.mimeType,
            1
        )
    })
    const width = canvas.width
    const height = canvas.height
    canvas.width = 0
    canvas.height = 0

    return { blob, ...format, width, height }
}
