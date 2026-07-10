import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { saveReferenceImage, loadReferenceImage, deleteReferenceImage, saveEncodedVibe, loadEncodedVibe } from '@/lib/image-utils'

// 참조 레퍼런스 타입 (NovelAI 2026년 2월 업데이트)
export type PreciseReferenceType = 'character' | 'style' | 'character&style'

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
}

interface CharacterState {
    characterImages: ReferenceImage[]
    vibeImages: ReferenceImage[]
    _imagesLoaded: boolean      // Runtime flag: are base64 loaded from files?

    // Actions
    addCharacterImage: (base64: string, name?: string) => Promise<void>
    updateCharacterImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeCharacterImage: (id: string) => void

    addVibeImage: (base64: string, encodedVibe?: string, informationExtracted?: number, strength?: number, name?: string) => Promise<void>
    updateVibeImage: (id: string, updates: Partial<ReferenceImage>) => void
    removeVibeImage: (id: string) => void

    clearAll: () => void

    /** Load base64 data from files for all images (call before generation) */
    ensureImagesLoaded: () => Promise<void>

    /** Release base64 data from memory (call after generation to free ~30-60MB) */
    releaseImageData: () => void

    /** Upgrade old low-resolution thumbnails without retaining originals in memory. */
    ensureHighQualityThumbnails: () => Promise<void>
}

const MAX_CHARACTER_IMAGES = 10
const MAX_VIBE_IMAGES = 10
const THUMBNAIL_VERSION = 2
let thumbnailRefreshPromise: Promise<void> | null = null

/** Create a tiny thumbnail for UI display (~10-30KB instead of 2-5MB) */
async function makeThumbnail(base64: string, size = 384): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
            let canvas: HTMLCanvasElement | null = null
            try {
                canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')
                if (!ctx) { resolve(''); return }
                const cropSize = Math.min(img.width, img.height)
                const sourceX = (img.width - cropSize) / 2
                const sourceY = (img.height - cropSize) / 2
                canvas.width = size
                canvas.height = size
                ctx.imageSmoothingEnabled = true
                ctx.imageSmoothingQuality = 'high'
                ctx.drawImage(img, sourceX, sourceY, cropSize, cropSize, 0, 0, size, size)
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

/** Save image to file async, then update store with filePath */
async function persistImageToFile(id: string, base64: string, store: typeof useCharacterStore, field: 'characterImages' | 'vibeImages') {
    try {
        const filePath = await saveReferenceImage(id, base64)
        const thumbnail = await makeThumbnail(base64)
        store.getState()[field === 'characterImages' ? 'updateCharacterImage' : 'updateVibeImage'](id, {
            filePath,
            thumbnail,
            thumbnailVersion: THUMBNAIL_VERSION,
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
        store.getState().updateVibeImage(id, { encodedVibePath })
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
            _imagesLoaded: false,

            addCharacterImage: async (base64, name) => {
                const id = Date.now().toString()
                set((state) => {
                    const newImages = [
                        ...state.characterImages,
                        {
                            id, name, base64, enabled: true,
                            informationExtracted: 1.0, strength: 0.6, fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    if (newImages.length > MAX_CHARACTER_IMAGES) {
                        const removed = newImages[0]
                        if (removed.filePath) deleteReferenceImage(removed.filePath)
                        return { characterImages: newImages.slice(-MAX_CHARACTER_IMAGES) }
                    }
                    return { characterImages: newImages }
                })
                // Async: save to file
                await persistImageToFile(id, base64, useCharacterStore, 'characterImages')
            },

            updateCharacterImage: (id, updates) => set((state) => ({
                characterImages: state.characterImages.map(img =>
                    img.id === id ? { ...img, ...updates } : img
                )
            })),

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
                            id, name, base64, enabled: true, encodedVibe,
                            informationExtracted: informationExtracted ?? 1.0,
                            strength: strength ?? 0.6, fidelity: 0.6,
                            referenceType: 'character&style' as PreciseReferenceType
                        }
                    ]
                    if (newImages.length > MAX_VIBE_IMAGES) {
                        const removed = newImages[0]
                        if (removed.filePath) deleteReferenceImage(removed.filePath)
                        if (removed.encodedVibePath) deleteReferenceImage(removed.encodedVibePath)
                        return { vibeImages: newImages.slice(-MAX_VIBE_IMAGES) }
                    }
                    return { vibeImages: newImages }
                })
                // Async: save to files
                await persistImageToFile(id, base64, useCharacterStore, 'vibeImages')
                if (encodedVibe) {
                    await persistVibeToFile(id, encodedVibe, useCharacterStore)
                }
            },

            updateVibeImage: (id, updates) => {
                set((state) => ({
                    vibeImages: state.vibeImages.map(img =>
                        img.id === id ? { ...img, ...updates } : img
                    )
                }))
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

            clearAll: () => {
                const state = get()
                for (const img of [...state.characterImages, ...state.vibeImages]) {
                    if (img.filePath) deleteReferenceImage(img.filePath)
                    if (img.encodedVibePath) deleteReferenceImage(img.encodedVibePath)
                }
                set({ characterImages: [], vibeImages: [], _imagesLoaded: false })
            },

            ensureImagesLoaded: async () => {
                if (get()._imagesLoaded) return
                console.log('[CharacterStore] Loading images from files...')
                const state = get()

                const loadImage = async (img: ReferenceImage): Promise<ReferenceImage> => {
                    const updates: Partial<ReferenceImage> = {}
                    // Load base64 from file if missing
                    if (!img.base64 && img.filePath) {
                        const data = await loadReferenceImage(img.filePath)
                        if (data) updates.base64 = data
                    }
                    // Load encodedVibe from file if missing
                    if (!img.encodedVibe && img.encodedVibePath) {
                        const data = await loadEncodedVibe(img.encodedVibePath)
                        if (data) updates.encodedVibe = data
                    }
                    return Object.keys(updates).length > 0 ? { ...img, ...updates } : img
                }

                const [charImages, vibeImgs] = await Promise.all([
                    Promise.all(state.characterImages.map(loadImage)),
                    Promise.all(state.vibeImages.map(loadImage)),
                ])

                set({
                    characterImages: charImages,
                    vibeImages: vibeImgs,
                    _imagesLoaded: true,
                })
                console.log('[CharacterStore] Loaded ' + charImages.length + ' char + ' + vibeImgs.length + ' vibe images')
            },

            releaseImageData: () => {
                const state = get()
                // Only release if images have file paths (can be reloaded)
                const hasFilePaths = [...state.characterImages, ...state.vibeImages].every(img => img.filePath || !img.base64)
                if (!hasFilePaths) {
                    console.log('[CharacterStore] Skipping release - some images have no file path')
                    return
                }
                set({
                    characterImages: state.characterImages.map(img =>
                        img.filePath ? { ...img, base64: '', encodedVibe: undefined } : img
                    ),
                    vibeImages: state.vibeImages.map(img =>
                        img.filePath ? { ...img, base64: '', encodedVibe: undefined } : img
                    ),
                    _imagesLoaded: false,
                })
                console.log('[CharacterStore] Released base64 data from memory')
            },

            ensureHighQualityThumbnails: async () => {
                if (thumbnailRefreshPromise) return thumbnailRefreshPromise
                thumbnailRefreshPromise = (async () => {
                    const fields = ['characterImages', 'vibeImages'] as const
                    for (const field of fields) {
                        const snapshot = get()[field]
                        for (const image of snapshot) {
                            if (image.thumbnail && image.thumbnailVersion === THUMBNAIL_VERSION) continue
                            if (!image.filePath && !image.base64) continue
                            const base64 = image.base64 || await loadReferenceImage(image.filePath!)
                            if (!base64) continue
                            const thumbnail = await makeThumbnail(base64)
                            set(state => ({
                                [field]: state[field].map(item => item.id === image.id
                                    ? { ...item, thumbnail, thumbnailVersion: THUMBNAIL_VERSION }
                                    : item),
                            }))
                        }
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
                })),
            }),
        }
    )
)
