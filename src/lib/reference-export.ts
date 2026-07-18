import JSZip from 'jszip'
import { save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import type { ReferenceImage } from '@/stores/character-store'

interface ReferenceFile {
    bytes: Uint8Array
    extension: string
}

const sanitizeFileName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'image'

const decodeBase64 = (value: string) => {
    const raw = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
    return Uint8Array.from(atob(raw), character => character.charCodeAt(0))
}

const detectExtension = (bytes: Uint8Array) => {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
    if (
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return 'webp'
    return 'png'
}

async function readReferenceFile(image: ReferenceImage): Promise<ReferenceFile> {
    const bytes = image.filePath ? await readFile(image.filePath) : decodeBase64(image.base64)
    if (bytes.length === 0) throw new Error('Reference image data is empty')
    return { bytes, extension: detectExtension(bytes) }
}

export async function downloadReferenceImage(image: ReferenceImage, fallbackName: string): Promise<boolean> {
    const file = await readReferenceFile(image)
    const name = sanitizeFileName(image.name || fallbackName)
    const path = await save({
        defaultPath: `${name}.${file.extension}`,
        filters: [{ name: 'Image', extensions: [file.extension] }],
    })
    if (!path) return false
    await writeFile(path, file.bytes)
    return true
}

export async function downloadReferenceFolder(folderName: string, images: ReferenceImage[]): Promise<boolean> {
    const path = await save({
        defaultPath: `${sanitizeFileName(folderName)}.zip`,
        filters: [{ name: 'ZIP File', extensions: ['zip'] }],
    })
    if (!path) return false

    const zip = new JSZip()
    const usedNames = new Set<string>()
    for (let index = 0; index < images.length; index++) {
        const file = await readReferenceFile(images[index])
        const baseName = sanitizeFileName(images[index].name || `image_${index + 1}`)
        let fileName = `${baseName}.${file.extension}`
        let suffix = 2
        while (usedNames.has(fileName.toLocaleLowerCase())) {
            fileName = `${baseName}_${suffix++}.${file.extension}`
        }
        usedNames.add(fileName.toLocaleLowerCase())
        zip.file(fileName, file.bytes)
    }

    await writeFile(path, await zip.generateAsync({ type: 'uint8array' }))
    return true
}
