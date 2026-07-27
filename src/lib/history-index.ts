import { indexedDBStorage } from '@/lib/indexed-db'
import { readNativeState, writeNativeState } from '@/lib/native-state'

const HISTORY_INDEX_KEY = 'nais2-forge-history-index'
const HISTORY_INDEX_VERSION = 1
const HISTORY_INDEX_LIMIT = 200

export type HistoryImageType =
    | 'main'
    | 'i2i'
    | 'inpaint'
    | 'upscale'
    | 'scene'
    | 'lineart'
    | 'sketch'
    | 'colorize'
    | 'emotion'
    | 'declutter'

export interface HistoryIndexEntry {
    name: string
    path: string
    timestamp: number
    type: HistoryImageType
}

interface HistoryIndexPayload {
    version: number
    scope: string
    images: HistoryIndexEntry[]
}

const historyImageTypes = new Set<HistoryImageType>([
    'main',
    'i2i',
    'inpaint',
    'upscale',
    'scene',
    'lineart',
    'sketch',
    'colorize',
    'emotion',
    'declutter',
])

let lastSerializedIndex = ''
let legacyIndexCleanupDone = false

function parseHistoryIndex(stored: string, scope: string): HistoryIndexEntry[] | null {
    const payload = JSON.parse(stored) as Partial<HistoryIndexPayload>
    if (
        payload.version !== HISTORY_INDEX_VERSION ||
        payload.scope !== scope ||
        !Array.isArray(payload.images)
    ) {
        return null
    }

    return payload.images.filter((image): image is HistoryIndexEntry =>
        !!image &&
        typeof image.name === 'string' &&
        typeof image.path === 'string' &&
        typeof image.timestamp === 'number' &&
        Number.isFinite(image.timestamp) &&
        historyImageTypes.has(image.type as HistoryImageType)
    ).slice(0, HISTORY_INDEX_LIMIT)
}

export function createHistoryIndexScope(useAbsolutePath: boolean, savePath: string) {
    if (!useAbsolutePath || !savePath.trim()) return 'default'

    const normalizedPath = savePath
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/, '')
        .toLocaleLowerCase()

    return `absolute:${normalizedPath}`
}

export function replaceHistoryPathPrefix(path: string, oldFolder: string, newFolder: string) {
    const normalizedPath = path.toLocaleLowerCase()
    const normalizedFolder = oldFolder.toLocaleLowerCase()
    if (normalizedPath !== normalizedFolder
        && !normalizedPath.startsWith(normalizedFolder + '\\')
        && !normalizedPath.startsWith(normalizedFolder + '/')) {
        return path
    }

    return newFolder + path.slice(oldFolder.length)
}

export async function loadHistoryIndex(scope: string): Promise<HistoryIndexEntry[] | null> {
    try {
        const native = await readNativeState(HISTORY_INDEX_KEY)
        if (native.value) {
            try {
                const images = parseHistoryIndex(native.value, scope)
                if (images) {
                    lastSerializedIndex = native.value
                    return images
                }
            } catch (error) {
                console.warn('[HistoryIndex] Invalid SQLite index, checking IndexedDB fallback:', error)
            }
        }

        const legacy = await indexedDBStorage.getItem(HISTORY_INDEX_KEY)
        if (!legacy) return null
        const images = parseHistoryIndex(legacy, scope)
        if (!images) return null

        if (native.available && await writeNativeState(HISTORY_INDEX_KEY, legacy)) {
            const verified = await readNativeState(HISTORY_INDEX_KEY)
            if (verified.value === legacy) {
                await indexedDBStorage.removeItem(HISTORY_INDEX_KEY)
                legacyIndexCleanupDone = true
                console.log('[HistoryIndex] Migrated IndexedDB index to SQLite')
            }
        }

        lastSerializedIndex = legacy
        return images
    } catch (error) {
        console.warn('[HistoryIndex] Failed to load index:', error)
        return null
    }
}

export async function saveHistoryIndex(scope: string, images: HistoryIndexEntry[]): Promise<void> {
    const payload: HistoryIndexPayload = {
        version: HISTORY_INDEX_VERSION,
        scope,
        images: images.slice(0, HISTORY_INDEX_LIMIT).map(image => ({
            name: image.name,
            path: image.path,
            timestamp: image.timestamp,
            type: image.type,
        })),
    }
    const serialized = JSON.stringify(payload)
    if (serialized === lastSerializedIndex) return

    if (await writeNativeState(HISTORY_INDEX_KEY, serialized)) {
        lastSerializedIndex = serialized
        if (!legacyIndexCleanupDone) {
            await indexedDBStorage.removeItem(HISTORY_INDEX_KEY)
            legacyIndexCleanupDone = true
        }
        return
    }

    await indexedDBStorage.setItem(HISTORY_INDEX_KEY, serialized)
    lastSerializedIndex = serialized
}

export async function moveHistoryIndexPathPrefix(scope: string, oldFolder: string, newFolder: string) {
    const images = await loadHistoryIndex(scope)
    if (!images) return

    let changed = false
    const updated = images.map(image => {
        const path = replaceHistoryPathPrefix(image.path, oldFolder, newFolder)
        if (path === image.path) return image
        changed = true
        return { ...image, path }
    })

    if (changed) await saveHistoryIndex(scope, updated)
}
