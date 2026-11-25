import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { useCharacterStore, type ReferenceFolder } from '@/stores/character-store'
import { useV5ReferenceStore } from '@/stores/v5-reference-store'

interface V5ReferenceFolderState {
    referenceFolders: ReferenceFolder[]
    addReferenceFolder: (name: string) => string
    renameReferenceFolder: (id: string, name: string) => void
    setReferenceFolderColor: (id: string, colorIndex: number) => void
    removeReferenceFolder: (id: string) => void
    reorderReferenceFolders: (activeId: string, overId: string) => void
}

export const useV5ReferenceFolderStore = create<V5ReferenceFolderState>()(
    persist(
        set => ({
            referenceFolders: [],

            addReferenceFolder: name => {
                const id = `reference-folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
                set(state => ({
                    referenceFolders: [...state.referenceFolders, { id, name, mode: 'character', colorIndex: 0 }],
                }))
                return id
            },

            renameReferenceFolder: (id, name) => set(state => ({
                referenceFolders: state.referenceFolders.map(folder => folder.id === id ? { ...folder, name } : folder),
            })),

            setReferenceFolderColor: (id, colorIndex) => set(state => ({
                referenceFolders: state.referenceFolders.map(folder => folder.id === id ? { ...folder, colorIndex } : folder),
            })),

            removeReferenceFolder: id => set(state => ({
                referenceFolders: state.referenceFolders.filter(folder => folder.id !== id),
            })),

            reorderReferenceFolders: (activeId, overId) => set(state => {
                if (activeId === overId) return state
                const from = state.referenceFolders.findIndex(folder => folder.id === activeId)
                const to = state.referenceFolders.findIndex(folder => folder.id === overId)
                if (from < 0 || to < 0) return state
                const reordered = [...state.referenceFolders]
                const [moved] = reordered.splice(from, 1)
                reordered.splice(to, 0, moved)
                return { referenceFolders: reordered }
            }),
        }),
        {
            name: 'nais2-forge-v5-reference-folders',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: state => ({ referenceFolders: state.referenceFolders }),
        },
    ),
)

/** Copy only legacy character folders that are currently referenced by V5 images. */
export function copyReferencedCharacterFoldersToV5(): void {
    if (
        !useCharacterStore.persist.hasHydrated()
        || !useV5ReferenceStore.persist.hasHydrated()
        || !useV5ReferenceFolderStore.persist.hasHydrated()
    ) return

    const usedFolderIds = new Set(
        useV5ReferenceStore.getState().characterImages
            .map(image => image.folderId)
            .filter((id): id is string => Boolean(id)),
    )
    if (usedFolderIds.size === 0) return

    const currentFolders = useV5ReferenceFolderStore.getState().referenceFolders
    const existingIds = new Set(currentFolders.map(folder => folder.id))
    const foldersToCopy = useCharacterStore.getState().referenceFolders.filter(folder =>
        folder.mode === 'character' && usedFolderIds.has(folder.id) && !existingIds.has(folder.id),
    ).map(folder => ({ ...folder }))
    if (foldersToCopy.length === 0) return

    useV5ReferenceFolderStore.setState(state => ({
        referenceFolders: [...state.referenceFolders, ...foldersToCopy.filter(folder =>
            !state.referenceFolders.some(existing => existing.id === folder.id),
        )],
    }))

    const destinationIds = new Set(useV5ReferenceFolderStore.getState().referenceFolders.map(folder => folder.id))
    if (foldersToCopy.some(folder => !destinationIds.has(folder.id))) {
        throw new Error('V5 reference folder copy could not be verified')
    }
}
