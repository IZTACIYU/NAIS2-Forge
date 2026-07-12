import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { dirname, join } from '@tauri-apps/api/path'

export const LIBRARY_THUMBNAIL_VERSION = 1

const THUMBNAIL_DIRECTORY = '.thumbnails'
const MAX_THUMBNAIL_EDGE = 960
const WEBP_QUALITY = 0.88

const pending = new Map<string, Promise<string>>()
let queueTail: Promise<void> = Promise.resolve()

const waitForIdle = (): Promise<void> =>
    new Promise(resolve => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => resolve(), { timeout: 1000 })
        } else {
            setTimeout(resolve, 100)
        }
    })

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Failed to encode library thumbnail')),
            'image/webp',
            WEBP_QUALITY
        )
    })

async function createThumbnail(itemId: string, originalPath: string): Promise<string> {
    const libraryDir = await dirname(originalPath)
    const thumbnailDir = await join(libraryDir, THUMBNAIL_DIRECTORY)
    const thumbnailPath = await join(thumbnailDir, itemId + '-v' + LIBRARY_THUMBNAIL_VERSION + '.webp')

    if (await exists(thumbnailPath)) return thumbnailPath
    if (!(await exists(thumbnailDir))) {
        await mkdir(thumbnailDir, { recursive: true })
    }

    const bytes = await readFile(originalPath)
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const bitmap = await createImageBitmap(new Blob([source]))

    try {
        const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height))
        const width = Math.max(1, Math.round(bitmap.width * scale))
        const height = Math.max(1, Math.round(bitmap.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height

        const context = canvas.getContext('2d')
        if (!context) throw new Error('Failed to create thumbnail canvas')

        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        context.drawImage(bitmap, 0, 0, width, height)

        const encoded = new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer())
        if (!(await exists(originalPath))) throw new Error('Original image was removed')
        await writeFile(thumbnailPath, encoded)
        return thumbnailPath
    } finally {
        bitmap.close()
    }
}

export function ensureLibraryThumbnail(itemId: string, originalPath: string): Promise<string> {
    const key = itemId + ':' + originalPath
    const existing = pending.get(key)
    if (existing) return existing

    const job = queueTail
        .catch(() => undefined)
        .then(waitForIdle)
        .then(() => createThumbnail(itemId, originalPath))

    pending.set(key, job)
    queueTail = job.then(() => undefined, () => undefined)
    void job.then(
        () => pending.delete(key),
        () => pending.delete(key)
    )
    return job
}
