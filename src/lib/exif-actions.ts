import { exists, mkdir, readDir, writeFile } from '@tauri-apps/plugin-fs'
import { join, pictureDir } from '@tauri-apps/api/path'
import { useSettingsStore } from '@/stores/settings-store'
import { ExifOutputFormat, StrippedImage, stripImageMetadata } from '@/lib/exif-stripper'

const isAbsolutePath = (path: string) => /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')
const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*]/g, '_').trim()

export const exifFormatExtension = (format: ExifOutputFormat) =>
    format === 'jpeg' ? 'jpg' : format

export const replaceImageExtension = (name: string, extension: string) => {
    const baseName = name.replace(/\.[^.]+$/g, '') || name
    return `${baseName}.${extension}`
}

export const getExifOutputName = (sourceName: string, extension: StrippedImage['extension']) => {
    const configuredName = useSettingsStore.getState().exifAutoSaveName
    const fallback = sourceName.replace(/\.[^.]+$/g, '') || 'exif_cleaned'
    const requested = safeFileName(configuredName.replace(/\.[^.]+$/g, '') || `${fallback}_clean`)
    return `${requested}.${extension}`
}

const getAvailableFilePath = async (directory: string, fileName: string) => {
    const existingNames = new Set((await readDir(directory)).map(entry => entry.name.toLowerCase()))
    if (!existingNames.has(fileName.toLowerCase())) return join(directory, fileName)

    const extensionIndex = fileName.lastIndexOf('.')
    const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''
    let index = 1
    let candidateName: string
    do {
        candidateName = `${baseName} (${index})${extension}`
        index++
    } while (existingNames.has(candidateName.toLowerCase()))
    return join(directory, candidateName)
}

export const writeExifBlob = async (image: StrippedImage, path: string) => {
    await writeFile(path, new Uint8Array(await image.blob.arrayBuffer()))
}

export const saveStrippedExifImage = async (image: StrippedImage, sourceName: string) => {
    const configuredPath = useSettingsStore.getState().exifAutoSavePath.trim()
    const directory = isAbsolutePath(configuredPath)
        ? configuredPath
        : await join(await pictureDir(), configuredPath || 'NAIS_EXIF')
    if (!(await exists(directory))) await mkdir(directory, { recursive: true })
    const filePath = await getAvailableFilePath(directory, getExifOutputName(sourceName, image.extension))
    await writeExifBlob(image, filePath)
    return filePath
}

export const processAndSaveExifImage = async (source: string, sourceName: string) => {
    const format = useSettingsStore.getState().exifOutputFormat
    const image = await stripImageMetadata(source, format)
    return saveStrippedExifImage(image, sourceName)
}

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('Failed to read processed image'))
    reader.readAsDataURL(blob)
})

export const stripExifForUpload = async (source: string) => {
    const format = useSettingsStore.getState().exifOutputFormat
    const image = await stripImageMetadata(source, format)
    return {
        contentBase64: await blobToBase64(image.blob),
        contentType: image.mimeType,
        extension: image.extension,
    }
}
