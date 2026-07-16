import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { saveReferenceImage, loadReferenceImage, deleteReferenceImage, saveEncodedVibe, loadEncodedVibe } from '@/lib/image-utils'
import { invoke } from '@tauri-apps/api/core'

// 참조 레퍼런스 타입 (NovelAI 2026년 2월 업데이트)
export type PreciseReferenceType = 'character' | 'style' | 'character&style'
export type ReferenceMode = 'character' | 'vibe'

export interface ReferenceFolder {
    id: string
    name: string
    mode: ReferenceMode
}

export interface ReferenceImage {
    id: string
    name?: string
    base64: string              // Runtime only - NOT persisted (loaded from filePath on demand)
    filePath?: string           // Persisted file path (AppData/NAIS2/references/xxx.bin)
    thumbnail?: string          // Small JPEG preview for UI (~10-30KB) - persisted
    thumbnailVersion?: number
    enabled: boolean
    encodedVibe?: string        // Runtime only - loaded from encodedVibePath
    encodedVibePath?: string    // Persisted file path for encoded vibe data
    informationExtracted: number
    strength: number
    fidelity: number
    referenceType: PreciseReferenceType
    cacheKey?: string
    folderId?: string
}

interface CharacterState {
    characterImages: ReferenceImage[]
    vibeImages: ReferenceImage[]
    referenceFolders: ReferenceFolder[]
    _imagesLoaded: boolean      // Runtime flag: are base64 loaded from files?

    // Actions
    addCharacterImage: (base64: string, name?: string) => Promise<void>
    updateCharacterImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeCharacterImage: (id: string) => void

    addVibeImage: (base64: string, encodedVibe?: string, informationExtracted?: number, strength?: number, name?: string) => Promise<void>
    updateVibeImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeVibeImage: (id: string) => void

    addReferenceFolder: (mode: ReferenceMode, name: string) => string
    renameReferenceFolder: (id: string, name: string) => void
    removeReferenceFolder: (id: string) => void
    reorderReferenceFolders: (mode: ReferenceMode, activeId: string, overId: string) => void
    moveReferenceImage: (mode: ReferenceMode, imageId: string, folderId?: string, beforeImageId?: string) => void
    disableAllReferenceImages: (mode: ReferenceMode) => void

    clearAll: () => void

    /** Load base64 data from files for all images (call before generation) */
    ensureImagesLoaded: (requiredIds?: string[]) => Promise<void>

    /** Release base64 data from memory (call after generation to free ~30-60MB) */
    releaseImageData: (force?: boolean) => void

    /** Upgrade old low-resolution thumbnails without retaining originals in memory. */
    ensureHighQualityThumbnails: () => Promise<void>
}

export const MAX_ACTIVE_REFERENCE_IMAGES = 10
const THUMBNAIL_VERSION = 4
const REFERENCE_CACHE_LIMIT_BYTES = 64 * 1024 * 1024
const referenceAccessOrder = new Map<string, number>()
let referenceAccessCounter = 0
let thumbnailRefreshPromise: Promise<void> | null = null

const yieldToUI = () => new Promise<void>(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => resolve(), { timeout: 100 })
        return
    }
    window.setTimeout(resolve, 0)
})

const estimateRuntimeBytes = (image: ReferenceImage) =>
    ((image.base64?.length || 0) + (image.encodedVibe?.length || 0)) * 2

async function makeThumbnailWithCanvas(base64: string, width: number, height: number): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            let canvas: HTMLCanvasElement | null = null
            try {
                canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')
                if (!ctx) { resolve(''); return }
                const targetRatio = width / height
                const sourceRatio = img.width / img.height
                const sourceWidth = sourceRatio > targetRatio ? img.height * targetRatio : img.width
                const sourceHeight = sourceRatio > targetRatio ? img.height : img.width / targetRatio
                const sourceX = (img.width - sourceWidth) / 2
                const sourceY = (img.height - sourceHeight) / 2
                canvas.width = width
                canvas.height = height
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = 'high'
                ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
                resolve(canvas.toDataURL('image/webp', 0.82))
            } catch { resolve('') }
            finally {
                if (canvas) { canvas.width = 0; canvas.height = 0 }
                img.src = ''
            }
        }
        img.onerror = () => { img.src = ''; resolve('') }
        img.src = base64
    })
}

/** Keep image decoding and resizing outside the WebView renderer. */
async function makeThumbnail(base64?: string, filePath?: string, width = 384, height = 264): Promise<string> {
    try {
        return await invoke<string>('create_reference_thumbnail', {
            sourceBase64: filePath ? null : base64 || null,
            filePath: filePath || null,
            width,
            height,
            quality: 82,
        })
    } catch (error) {
        console.warn('[CharacterStore] Rust thumbnail generation failed, using Canvas fallback:', error)
        const fallbackSource = base64 || (filePath ? await loadReferenceImage(filePath) : null)
        return fallbackSource ? makeThumbnailWithCanvas(fallbackSource, width, height) : ''
    }
}

/** Save image to file async, then update store with filePath */
async function persistImageToFile(id: string, base64: string, store: typeof useCharacterStore, field: 'characterImages' | 'vibeImages') {
    try {
        const filePath = await saveReferenceImage(id, base64)
        const thumbnail = await makeThumbnail(undefined, filePath)
        store.getState()[field === 'characterImages' ? 'updateCharacterImage' : 'updateVibeImage'](id, {
            filePath,
            thumbnail,
            thumbnailVersion: THUMBNAIL_VERSION,
            base64: '',
        })
        console.log('[CharacterStore] Saved ' + field + ' ' + id + ' to file')
    } catch (e) {
        console.error('[CharacterStore] Failed to save ' + id + ' to file:', e)
    }
}

/** Save encoded vibe to file async */
async function persistVibeToFile(id: string, encodedVibe: string, store: typeof useCharacterStore) {
    try {
        const encodedVibePath = await saveEncodedVibe(id, encodedVibe)
        store.getState().updateVibeImage(id, { encodedVibePath, encodedVibe: undefined })
        console.log('[CharacterStore] Saved encoded vibe ' + id + ' to file')
    } catch (e) {
        console.error('[CharacterStore] Failed to save encoded vibe ' + id + ':', e)
    }
}

export const useCharacterStore = create<CharacterState>()(
    persist(
        (set, get) => ({
            characterImages: [],
            vibeImages: [],
            referenceFolders: [],
            _imagesLoaded: false,

            addCharacterImage: async (base64, name) => {
                const id = Date.now().toString()
                set((state) => {
                    const newImages = [
                        ...state.characterImages,
                        {
                            id, name, base64,
                            enabled: !state.vibeImages.some(image => image.enabled !== false)
                                && state.characterImages.filter(image => image.enabled !== false).length < MAX_ACTIVE_REFERENCE_IMAGES,
                            informationExtracted: 1.0, strength: 0.6, fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    return { characterImages: newImages }
                })
                // Async: save to file
                await persistImageToFile(id, base64, useCharacterStore, 'characterImages')
            },

            updateCharacterImage: (id, updates) => set((state) => {
                const enableBlocked = updates.enabled === true && (
                    state.vibeImages.some(image => image.enabled !== false)
                    || state.characterImages.filter(image => image.id !== id && image.enabled !== false).length >= MAX_ACTIVE_REFERENCE_IMAGES
                )
                const safeUpdates = enableBlocked
                    ? { ...updates, enabled: false }
                    : updates
                return {
                    characterImages: state.characterImages.map(img =>
                        img.id === id ? { ...img, ...safeUpdates } : img
                    )
                }
            }),

            removeCharacterImage: (id) => {
                const img = get().characterImages.find(i => i.id === id)
                if (img?.filePath) deleteReferenceImage(img.filePath)
                set((state) => ({
                    characterImages: state.characterImages.filter(i => i.id !== id)
                }))
            },

            addVibeImage: async (base64, encodedVibe, informationExtracted, strength, name) => {
                const id = Date.now().toString()
                set((state) => {
                    const newImages = [
                        ...state.vibeImages,
                        {
                            id, name, base64,
                            enabled: !state.characterImages.some(image => image.enabled !== false)
                                && state.vibeImages.filter(image => image.enabled !== false).length < MAX_ACTIVE_REFERENCE_IMAGES,
                            encodedVibe,
                            informationExtracted: informationExtracted ?? 1.0,
                            strength: strength ?? 0.6, fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    return { vibeImages: newImages }
                })
                // Async: save to files
                await persistImageToFile(id, base64, useCharacterStore, 'vibeImages')
                if (encodedVibe) {
                    await persistVibeToFile(id, encodedVibe, useCharacterStore)
                }
            },

            updateVibeImage: (id, updates) => {
                set((state) => {
                    const enableBlocked = updates.enabled === true && (
                        state.characterImages.some(image => image.enabled !== false)
                        || state.vibeImages.filter(image => image.id !== id && image.enabled !== false).length >= MAX_ACTIVE_REFERENCE_IMAGES
                    )
                    const safeUpdates = enableBlocked
                        ? { ...updates, enabled: false }
                        : updates
                    return {
                        vibeImages: state.vibeImages.map(img =>
                            img.id === id ? { ...img, ...safeUpdates } : img
                        )
                    }
                })
                // If encodedVibe was updated and no path yet, save to file
                if (updates.encodedVibe && !get().vibeImages.find(v => v.id === id)?.encodedVibePath) {
                    persistVibeToFile(id, updates.encodedVibe, useCharacterStore)
                }
            },

            removeVibeImage: (id) => {
                const img = get().vibeImages.find(i => i.id === id)
                if (img?.filePath) deleteReferenceImage(img.filePath)
                if (img?.encodedVibePath) deleteReferenceImage(img.encodedVibePath)
                set((state) => ({
                    vibeImages: state.vibeImages.filter(i => i.id !== id)
                }))
            },

            addReferenceFolder: (mode, name) => {
                const id = `reference-folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
                set(state => ({ referenceFolders: [...state.referenceFolders, { id, name, mode }] }))
                return id
            },

            renameReferenceFolder: (id, name) => set(state => ({
                referenceFolders: state.referenceFolders.map(folder => folder.id === id ? { ...folder, name } : folder),
            })),

            removeReferenceFolder: (id) => set(state => ({
                referenceFolders: state.referenceFolders.filter(folder => folder.id !== id),
                characterImages: state.characterImages.map(image => image.folderId === id ? { ...image, folderId: undefined } : image),
                vibeImages: state.vibeImages.map(image => image.folderId === id ? { ...image, folderId: undefined } : image),
            })),

            reorderReferenceFolders: (mode, activeId, overId) => set(state => {
                if (activeId === overId) return state
                const modeFolders = state.referenceFolders.filter(folder => folder.mode === mode)
                const from = modeFolders.findIndex(folder => folder.id === activeId)
                const to = modeFolders.findIndex(folder => folder.id === overId)
                if (from < 0 || to < 0) return state
                const reordered = [...modeFolders]
                const [moved] = reordered.splice(from, 1)
                reordered.splice(to, 0, moved)
                let index = 0
                return {
                    referenceFolders: state.referenceFolders.map(folder => folder.mode === mode ? reordered[index++] : folder),
                }
            }),

            moveReferenceImage: (mode, imageId, folderId, beforeImageId) => set(state => {
                const field = mode === 'character' ? 'characterImages' : 'vibeImages'
                const source = state[field]
                const sourceIndex = source.findIndex(item => item.id === imageId)
                const image = source.find(item => item.id === imageId)
                if (!image) return state
                const moved = { ...image, folderId }
                const next = source.filter(item => item.id !== imageId)
                let targetIndex = beforeImageId ? next.findIndex(item => item.id === beforeImageId) : -1
                const overSourceIndex = beforeImageId ? source.findIndex(item => item.id === beforeImageId) : -1
                if (image.folderId === folderId && sourceIndex >= 0 && sourceIndex < overSourceIndex) targetIndex += 1
                if (targetIndex >= 0) next.splice(targetIndex, 0, moved)
                else next.push(moved)
                return { [field]: next }
            }),

            disableAllReferenceImages: (mode) => set(state => {
                const field = mode === 'character' ? 'characterImages' : 'vibeImages'
                return { [field]: state[field].map(image => image.enabled === false ? image : { ...image, enabled: false }) }
            }),

            clearAll: () => {
                const state = get()
                for (const img of [...state.characterImages, ...state.vibeImages]) {
                    if (img.filePath) deleteReferenceImage(img.filePath)
                    if (img.encodedVibePath) deleteReferenceImage(img.encodedVibePath)
                }
                set({ characterImages: [], vibeImages: [], referenceFolders: [], _imagesLoaded: false })
            },

            ensureImagesLoaded: async (requiredIds) => {
                console.log('[CharacterStore] Loading images from files...')
                const state = get()
                const required = requiredIds ? new Set(requiredIds) : null

                const loadImage = async (img: ReferenceImage, kind: 'character' | 'vibe'): Promise<ReferenceImage> => {
                    if (required && !required.has(img.id)) return img
                    referenceAccessOrder.set(img.id, ++referenceAccessCounter)
                    const updates: Partial<ReferenceImage> = {}
                    let encodedVibe = img.encodedVibe
                    if (!img.encodedVibe && img.encodedVibePath) {
                        const data = await loadEncodedVibe(img.encodedVibePath)
                        if (data) {
                            updates.encodedVibe = data
                            encodedVibe = data
                        }
                    }
                    const needsOriginal = kind === 'character' ? !img.cacheKey : !encodedVibe
                    if (needsOriginal && !img.base64 && img.filePath) {
                        const data = await loadReferenceImage(img.filePath)
                        if (data) updates.base64 = data
                    }
                    return Object.keys(updates).length > 0 ? { ...img, ...updates } : img
                }

                const charImages: ReferenceImage[] = []
                for (const image of state.characterImages) charImages.push(await loadImage(image, 'character'))
                const vibeImgs: ReferenceImage[] = []
                for (const image of state.vibeImages) vibeImgs.push(await loadImage(image, 'vibe'))

                set({
                    characterImages: charImages,
                    vibeImages: vibeImgs,
                    _imagesLoaded: true,
                })
                console.log('[CharacterStore] Loaded ' + charImages.length + ' char + ' + vibeImgs.length + ' vibe images')
            },

            releaseImageData: (force = false) => {
                const state = get()
                // Only release if images have file paths (can be reloaded)
                const hasFilePaths = [...state.characterImages, ...state.vibeImages].every(img => img.filePath || !img.base64)
                if (!hasFilePaths) {
                    console.log('[CharacterStore] Skipping release - some images have no file path')
                    return
                }
                const loaded = [...state.characterImages, ...state.vibeImages]
                    .filter(image => image.base64 || image.encodedVibe)
                    .sort((a, b) => (referenceAccessOrder.get(b.id) || 0) - (referenceAccessOrder.get(a.id) || 0))
                const retained = new Set<string>()
                let retainedBytes = 0
                if (!force) {
                    for (const image of loaded) {
                        const bytes = estimateRuntimeBytes(image)
                        if (retainedBytes + bytes > REFERENCE_CACHE_LIMIT_BYTES) continue
                        retained.add(image.id)
                        retainedBytes += bytes
                    }
                }
                const evict = (image: ReferenceImage): ReferenceImage => {
                    if (retained.has(image.id)) return image
                    referenceAccessOrder.delete(image.id)
                    return {
                        ...image,
                        base64: image.filePath ? '' : image.base64,
                        encodedVibe: image.encodedVibePath ? undefined : image.encodedVibe,
                    }
                }
                set({
                    characterImages: state.characterImages.map(evict),
                    vibeImages: state.vibeImages.map(evict),
                    _imagesLoaded: false,
                })
                console.log(`[CharacterStore] Reference cache retained ${Math.round(retainedBytes / 1024 / 1024)}MB`)
            },

            ensureHighQualityThumbnails: async () => {
                if (thumbnailRefreshPromise) return thumbnailRefreshPromise
                thumbnailRefreshPromise = (async () => {
                    const fields = ['characterImages', 'vibeImages'] as const
                    const refreshed = new Map<string, string>()
                    for (const field of fields) {
                        const snapshot = get()[field]
                        for (const image of snapshot) {
                            if (image.thumbnail && image.thumbnailVersion === THUMBNAIL_VERSION) continue
                            if (!image.filePath && !image.base64) continue
                            await yieldToUI()
                            const thumbnail = await makeThumbnail(image.base64 || undefined, image.filePath)
                            if (thumbnail) refreshed.set(image.id, thumbnail)
                        }
                    }
                    if (refreshed.size > 0) {
                        const applyRefresh = (image: ReferenceImage) => {
                            const thumbnail = refreshed.get(image.id)
                            return thumbnail ? { ...image, thumbnail, thumbnailVersion: THUMBNAIL_VERSION } : image
                        }
                        set(state => ({
                            characterImages: state.characterImages.map(applyRefresh),
                            vibeImages: state.vibeImages.map(applyRefresh),
                        }))
                    }
                })()
                try {
                    await thumbnailRefreshPromise
                } finally {
                    thumbnailRefreshPromise = null
                }
            },
        }),
        {
            name: 'nais2-forge-character-store',
            storage: createJSONStorage(() => indexedDBStorage),
            // MEMORY OPTIMIZATION: Only persist filePath + thumbnail + settings, NOT base64
            partialize: (state) => ({
                characterImages: state.characterImages.map(img => ({
                    id: img.id,
                    name: img.name,
                    base64: '',
                    filePath: img.filePath,
                    thumbnail: img.thumbnail,
                    thumbnailVersion: img.thumbnailVersion,
                    enabled: img.enabled,
                    encodedVibePath: img.encodedVibePath,
                    informationExtracted: img.informationExtracted,
                    strength: img.strength,
                    fidelity: img.fidelity,
                    referenceType: img.referenceType,
                    cacheKey: img.cacheKey,
                    folderId: img.folderId,
                })),
                vibeImages: state.vibeImages.map(img => ({
                    id: img.id,
                    name: img.name,
                    base64: '',
                    filePath: img.filePath,
                    thumbnail: img.thumbnail,
                    thumbnailVersion: img.thumbnailVersion,
                    enabled: img.enabled,
                    encodedVibePath: img.encodedVibePath,
                    informationExtracted: img.informationExtracted,
                    strength: img.strength,
                    fidelity: img.fidelity,
                    referenceType: img.referenceType,
                    cacheKey: img.cacheKey,
                    folderId: img.folderId,
                })),
                referenceFolders: state.referenceFolders,
            }),
        }
    )
)
