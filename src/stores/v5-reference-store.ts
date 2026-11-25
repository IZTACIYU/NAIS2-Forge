import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { deleteReferenceImage, saveReferenceImage } from '@/lib/image-utils'
import { indexedDBStorage } from '@/lib/indexed-db'
import { makeReferenceThumbnail, THUMBNAIL_VERSION, type ReferenceImage } from '@/stores/character-store'

export type V5ReferenceType = 'character&style' | 'character' | 'style' | 'outfit'
export type V5ReferenceImage = Omit<ReferenceImage, 'referenceType'> & {
    referenceType: V5ReferenceType
    preferSameOutfit: boolean
}

interface V5ReferenceState {
    characterImages: V5ReferenceImage[]
    addCharacterImage: (base64: string, name?: string, folderId?: string) => Promise<string>
    updateCharacterImage: (id: string, updates: Partial<V5ReferenceImage>) => void
    removeCharacterImage: (id: string) => void
    moveReferenceImage: (imageId: string, folderId?: string, beforeImageId?: string) => void
    unfileImagesFromFolder: (folderId: string) => void
    disableAllReferenceImages: () => void
    releaseImageData: () => void
    ensureHighQualityThumbnails: () => Promise<void>
}

let thumbnailRefreshPromise: Promise<void> | null = null

const createReferenceId = () => `v5-${crypto.randomUUID()}`

export const useV5ReferenceStore = create<V5ReferenceState>()(
    persist(
        (set, get) => ({
            characterImages: [],

            addCharacterImage: async (base64, name, folderId) => {
                const id = createReferenceId()
                const filePath = await saveReferenceImage(id, base64)
                const thumbnail = await makeReferenceThumbnail(base64, filePath)
                set(state => ({
                    characterImages: [...state.characterImages, {
                        id,
                        name,
                        base64: '',
                        filePath,
                        thumbnail,
                        thumbnailVersion: THUMBNAIL_VERSION,
                        enabled: true,
                        informationExtracted: 1,
                        strength: 1,
                        fidelity: 1,
                        referenceType: 'character&style',
                        preferSameOutfit: true,
                        folderId,
                    }],
                }))
                return id
            },

            updateCharacterImage: (id, updates) => set(state => ({
                characterImages: state.characterImages.map(image => image.id === id ? { ...image, ...updates } : image),
            })),

            removeCharacterImage: id => {
                const image = get().characterImages.find(item => item.id === id)
                if (image?.filePath) void deleteReferenceImage(image.filePath)
                set(state => ({ characterImages: state.characterImages.filter(item => item.id !== id) }))
            },

            moveReferenceImage: (imageId, folderId, beforeImageId) => set(state => {
                const source = state.characterImages
                const sourceIndex = source.findIndex(image => image.id === imageId)
                const image = source[sourceIndex]
                if (!image) return state
                const next = source.filter(item => item.id !== imageId)
                let targetIndex = beforeImageId ? next.findIndex(item => item.id === beforeImageId) : -1
                const overSourceIndex = beforeImageId ? source.findIndex(item => item.id === beforeImageId) : -1
                if (image.folderId === folderId && sourceIndex >= 0 && sourceIndex < overSourceIndex) targetIndex += 1
                const moved = { ...image, folderId }
                if (targetIndex >= 0) next.splice(targetIndex, 0, moved)
                else next.push(moved)
                return { characterImages: next }
            }),

            unfileImagesFromFolder: folderId => set(state => {
                if (!state.characterImages.some(image => image.folderId === folderId)) return state
                return {
                    characterImages: state.characterImages.map(image =>
                        image.folderId === folderId ? { ...image, folderId: undefined } : image,
                    ),
                }
            }),

            disableAllReferenceImages: () => set(state => ({
                characterImages: state.characterImages.map(image => image.enabled === false ? image : { ...image, enabled: false }),
            })),

            releaseImageData: () => {
                const images = get().characterImages
                if (!images.some(image => image.filePath && image.base64)) return
                set(state => ({
                    characterImages: state.characterImages.map(image => image.filePath && image.base64 ? { ...image, base64: '' } : image),
                }))
            },

            ensureHighQualityThumbnails: async () => {
                if (thumbnailRefreshPromise) return thumbnailRefreshPromise
                thumbnailRefreshPromise = (async () => {
                    const refreshed = new Map<string, string>()
                    for (const image of get().characterImages) {
                        if (image.thumbnail && image.thumbnailVersion === THUMBNAIL_VERSION) continue
                        if (!image.filePath && !image.base64) continue
                        const thumbnail = await makeReferenceThumbnail(image.base64 || undefined, image.filePath)
                        if (thumbnail) refreshed.set(image.id, thumbnail)
                    }
                    if (refreshed.size > 0) {
                        set(state => ({
                            characterImages: state.characterImages.map(image => {
                                const thumbnail = refreshed.get(image.id)
                                return thumbnail ? { ...image, thumbnail, thumbnailVersion: THUMBNAIL_VERSION } : image
                            }),
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
            name: 'nais2-forge-v5-reference-store',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: state => ({
                characterImages: state.characterImages.map(image => ({
                    id: image.id,
                    name: image.name,
                    base64: '',
                    filePath: image.filePath,
                    thumbnail: image.thumbnail,
                    thumbnailVersion: image.thumbnailVersion,
                    enabled: image.enabled,
                    informationExtracted: image.informationExtracted,
                    strength: image.strength,
                    fidelity: image.fidelity,
                    referenceType: image.referenceType,
                    preferSameOutfit: image.preferSameOutfit,
                    folderId: image.folderId,
                })),
            }),
        },
    ),
)
