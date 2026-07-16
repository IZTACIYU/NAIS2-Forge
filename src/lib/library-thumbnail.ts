import { invoke } from '@tauri-apps/api/core'
import { exists } from '@tauri-apps/plugin-fs'
import { dirname, join } from '@tauri-apps/api/path'

export const LIBRARY_THUMBNAIL_VERSION = 1

const THUMBNAIL_DIRECTORY = '.thumbnails'
const MAX_THUMBNAIL_EDGE = 960
const WEBP_QUALITY = 88

const pending = new Map<string, Promise<string>>()
let queueTail: Promise<void> = Promise.resolve()

const waitForIdle = (): Promise<void> =>
    new Promise(resolve => {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => resolve())
        } else {
            setTimeout(resolve, 100)
        }
    })

async function createThumbnail(itemId: string, originalPath: string): Promise<string> {
    const libraryDir = await dirname(originalPath)
    const thumbnailDir = await join(libraryDir, THUMBNAIL_DIRECTORY)
    const thumbnailPath = await join(thumbnailDir, itemId + '-v' + LIBRARY_THUMBNAIL_VERSION + '.webp')

    if (await exists(thumbnailPath)) return thumbnailPath
    return invoke<string>('create_library_thumbnail', {
        filePath: originalPath,
        outputPath: thumbnailPath,
        maxEdge: MAX_THUMBNAIL_EDGE,
        quality: WEBP_QUALITY,
    })
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
        () => pending.delete(key),
    )
    return job
}
