import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export interface LibraryItem {
    id: string
    name: string
    path: string
    width: number
    height: number
    createdAt: number
    thumbnailPath?: string
    thumbnailVersion?: number
    // Stack support
    isStack?: boolean
    stackItems?: LibraryItem[]  // Items inside this stack (only if isStack=true)
}

interface LibraryState {
    items: LibraryItem[]
    draggedSource: { name: string, path: string } | null
    gridColumns: number

    // Edit Mode (Multi-Select)
    isEditMode: boolean
    selectedItemIds: string[]
    lastSelectedItemId: string | null

    setGridColumns: (columns: number) => void

    addItem: (item: LibraryItem) => void
    removeItem: (id: string) => void
    removeItems: (ids: string[]) => void
    setItems: (items: LibraryItem[]) => void
    updateItem: (id: string, updates: Partial<LibraryItem>) => void
    setDraggedSource: (source: { name: string, path: string } | null) => void

    // Edit Mode Actions
    setEditMode: (isEdit: boolean) => void
    toggleItemSelection: (itemId: string, clearOthers?: boolean) => void
    selectItemRange: (fromId: string, toId: string) => void
    selectAllItems: () => void
    clearSelection: () => void
    deleteSelectedItems: () => void
    setLastSelectedItemId: (id: string | null) => void

    // Stack Actions
    createStackFromSelected: () => void
    moveItemToStack: (itemId: string, stackId: string) => void
    reorderItems: (activeId: string, overId: string) => void
    unstack: (stackId: string) => void
    getStackItems: (stackId: string) => LibraryItem[]

    // Current Stack View (for navigation into a stack)
    currentStackId: string | null
    setCurrentStackId: (id: string | null) => void
}

export const useLibraryStore = create<LibraryState>()(
    persist(
        (set, get) => ({
            items: [],
            draggedSource: null,
            gridColumns: 4,

            // Edit Mode State
            isEditMode: false,
            selectedItemIds: [],
            lastSelectedItemId: null,

            // Current Stack View
            currentStackId: null,

            setGridColumns: (columns) => set({ gridColumns: columns }),

            addItem: (item) => set((state) => ({
                items: state.currentStackId
                    ? state.items.map(stack => stack.id === state.currentStackId
                        ? { ...stack, stackItems: [...(stack.stackItems || []), item] }
                        : stack)
                    : [item, ...state.items]
            })),

            removeItem: (id) => set((state) => ({
                items: state.items.flatMap((item) => {
                    if (item.id === id) return []
                    if (!item.isStack || !item.stackItems) return [item]

                    const stackItems = item.stackItems.filter(stackItem => stackItem.id !== id)
                    if (stackItems.length === item.stackItems.length) return [item]
                    if (stackItems.length === 0) return []

                    const thumbnail = stackItems[0]
                    return [{
                        ...item,
                        path: thumbnail.path,
                        width: thumbnail.width,
                        height: thumbnail.height,
                        thumbnailPath: thumbnail.thumbnailPath,
                        thumbnailVersion: thumbnail.thumbnailVersion,
                        stackItems,
                    }]
                })
            })),

            removeItems: (ids) => set((state) => ({
                items: state.items.filter((item) => !ids.includes(item.id))
            })),

            setItems: (items) => set({ items }),

            updateItem: (id, updates) => set((state) => ({
                items: state.items.map((item) => {
                    if (item.id === id) return { ...item, ...updates }
                    if (!item.isStack || !item.stackItems) return item

                    const stackItems = item.stackItems.map(stackItem =>
                        stackItem.id === id ? { ...stackItem, ...updates } : stackItem
                    )
                    const changed = stackItems.some((stackItem, index) => stackItem !== item.stackItems?.[index])
                    if (!changed) return item

                    const firstItem = stackItems[0]
                    const updatesThumbnail = 'thumbnailPath' in updates || 'thumbnailVersion' in updates
                    return firstItem?.id === id && updatesThumbnail
                        ? {
                            ...item,
                            thumbnailPath: firstItem.thumbnailPath,
                            thumbnailVersion: firstItem.thumbnailVersion,
                            stackItems,
                        }
                        : { ...item, stackItems }
                })
            })),

            setDraggedSource: (source) => set({ draggedSource: source }),

            // Edit Mode Actions
            setEditMode: (isEdit) => set({
                isEditMode: isEdit,
                selectedItemIds: isEdit ? [] : [],
                lastSelectedItemId: null
            }),

            toggleItemSelection: (itemId, clearOthers = false) => {
                const { selectedItemIds } = get()
                if (clearOthers) {
                    // Single select - toggle only this one
                    set({
                        selectedItemIds: selectedItemIds.includes(itemId) ? [] : [itemId],
                        lastSelectedItemId: itemId
                    })
                } else {
                    // Multi-select toggle
                    set({
                        selectedItemIds: selectedItemIds.includes(itemId)
                            ? selectedItemIds.filter(id => id !== itemId)
                            : [...selectedItemIds, itemId],
                        lastSelectedItemId: itemId
                    })
                }
            },

            selectItemRange: (fromId, toId) => {
                const { items, currentStackId } = get()
                // Get current view items (either main or inside stack)
                const viewItems = currentStackId
                    ? items.find(i => i.id === currentStackId)?.stackItems || []
                    : items

                const fromIndex = viewItems.findIndex(i => i.id === fromId)
                const toIndex = viewItems.findIndex(i => i.id === toId)
                if (fromIndex === -1 || toIndex === -1) return

                const start = Math.min(fromIndex, toIndex)
                const end = Math.max(fromIndex, toIndex)
                const rangeIds = viewItems.slice(start, end + 1).map(i => i.id)

                set({ selectedItemIds: rangeIds, lastSelectedItemId: toId })
            },

            selectAllItems: () => {
                const { items, currentStackId } = get()
                const viewItems = currentStackId
                    ? items.find(i => i.id === currentStackId)?.stackItems || []
                    : items.filter(i => !i.isStack) // Exclude stacks from selection
                set({ selectedItemIds: viewItems.map(i => i.id) })
            },

            clearSelection: () => set({ selectedItemIds: [], lastSelectedItemId: null }),

            deleteSelectedItems: () => {
                const { items, selectedItemIds, currentStackId } = get()
                
                if (currentStackId) {
                    // Delete from inside a stack
                    set({
                        items: items.map(item =>
                            item.id === currentStackId
                                ? {
                                    ...item,
                                    stackItems: (item.stackItems || []).filter(si => !selectedItemIds.includes(si.id))
                                }
                                : item
                        ),
                        selectedItemIds: [],
                        isEditMode: false
                    })
                } else {
                    // Delete from main library
                    set({
                        items: items.filter(item => !selectedItemIds.includes(item.id)),
                        selectedItemIds: [],
                        isEditMode: false
                    })
                }
            },

            setLastSelectedItemId: (id) => set({ lastSelectedItemId: id }),

            // Stack Actions
            createStackFromSelected: () => {
                const { items, selectedItemIds } = get()
                if (selectedItemIds.length < 2) return

                // Get the selected items in order
                const selectedItems = items.filter(i => selectedItemIds.includes(i.id))
                const firstSelected = selectedItems[0]

                // Create a new stack item
                // Note: Stack name uses first item's name + count format
                // The display format will be handled by UI components with i18n
                const stackItem: LibraryItem = {
                    id: crypto.randomUUID(),
                    name: firstSelected.name,
                    path: firstSelected.path, // Use first item's path as thumbnail
                    width: firstSelected.width,
                    height: firstSelected.height,
                    createdAt: Date.now(),
                    thumbnailPath: firstSelected.thumbnailPath,
                    thumbnailVersion: firstSelected.thumbnailVersion,
                    isStack: true,
                    stackItems: selectedItems
                }

                // Find the position of the first selected item
                const firstIndex = items.findIndex(i => i.id === selectedItemIds[0])

                // Remove selected items and insert stack at the first item's position
                const remainingItems = items.filter(i => !selectedItemIds.includes(i.id))
                const newItems = [
                    ...remainingItems.slice(0, firstIndex),
                    stackItem,
                    ...remainingItems.slice(firstIndex)
                ]

                set({
                    items: newItems,
                    selectedItemIds: [],
                    isEditMode: false
                })
            },

            moveItemToStack: (itemId, stackId) => {
                const { items } = get()
                const item = items.find(candidate => candidate.id === itemId)
                const stack = items.find(candidate => candidate.id === stackId)
                if (!item || item.isStack || !stack?.isStack || itemId === stackId) return

                set({
                    items: items
                        .filter(candidate => candidate.id !== itemId)
                        .map(candidate => candidate.id === stackId
                            ? { ...candidate, stackItems: [...(candidate.stackItems || []), item] }
                            : candidate)
                })
            },

            reorderItems: (activeId, overId) => {
                const { items, currentStackId } = get()
                const move = (source: LibraryItem[]) => {
                    const from = source.findIndex(item => item.id === activeId)
                    const to = source.findIndex(item => item.id === overId)
                    if (from < 0 || to < 0 || from === to) return source
                    const reordered = [...source]
                    const [moved] = reordered.splice(from, 1)
                    reordered.splice(to, 0, moved)
                    return reordered
                }

                if (currentStackId) {
                    set({
                        items: items.map(item => {
                            if (item.id !== currentStackId) return item
                            const stackItems = move(item.stackItems || [])
                            const thumbnail = stackItems[0]
                            return thumbnail
                                ? {
                                    ...item,
                                    path: thumbnail.path,
                                    width: thumbnail.width,
                                    height: thumbnail.height,
                                    thumbnailPath: thumbnail.thumbnailPath,
                                    thumbnailVersion: thumbnail.thumbnailVersion,
                                    stackItems,
                                }
                                : item
                        })
                    })
                } else {
                    set({ items: move(items) })
                }
            },

            unstack: (stackId) => {
                const { items } = get()
                const stackItem = items.find(i => i.id === stackId)
                if (!stackItem || !stackItem.isStack || !stackItem.stackItems) return

                const stackIndex = items.findIndex(i => i.id === stackId)
                const newItems = [
                    ...items.slice(0, stackIndex),
                    ...stackItem.stackItems,
                    ...items.slice(stackIndex + 1)
                ]

                set({ items: newItems, currentStackId: null })
            },

            getStackItems: (stackId) => {
                const stack = get().items.find(i => i.id === stackId)
                return stack?.stackItems || []
            },

            setCurrentStackId: (id) => set({
                currentStackId: id,
                isEditMode: false,
                selectedItemIds: []
            }),
        }),
        {
            name: 'nais2-forge-library',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({ items: state.items, gridColumns: state.gridColumns }), // Don't persist draggedSource, editMode, selection
        }
    )
)
