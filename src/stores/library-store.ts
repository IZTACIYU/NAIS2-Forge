import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createNativeDeferredJSONStorage } from '@/lib/indexed-db'

export interface LibraryItem {
    id: string
    name: string
    path: string
    width: number
    height: number
    createdAt: number
    thumbnailPath?: string
    thumbnailVersion?: number
    isStack?: boolean
    stackItems?: LibraryItem[]
    folderId?: string
}

export interface LibraryFolder {
    id: string
    name: string
    parentId?: string
    collapsed?: boolean
    colorIndex?: number
}

export function getLibraryFolderDescendantIds(folders: LibraryFolder[], folderId: string): Set<string> {
    const descendants = new Set<string>()
    const pending = [folderId]
    while (pending.length > 0) {
        const currentId = pending.pop()!
        for (const folder of folders) {
            if (folder.parentId === currentId && !descendants.has(folder.id)) {
                descendants.add(folder.id)
                pending.push(folder.id)
            }
        }
    }
    return descendants
}

export function findLibraryItem(items: LibraryItem[], id: string): LibraryItem | undefined {
    for (const item of items) {
        if (item.id === id) return item
        if (item.isStack && item.stackItems) {
            const nested = findLibraryItem(item.stackItems, id)
            if (nested) return nested
        }
    }
    return undefined
}

export function findLibraryParentStackId(
    items: LibraryItem[],
    id: string,
    parentStackId: string | null = null
): string | null {
    for (const item of items) {
        if (item.id === id) return parentStackId
        if (item.isStack && item.stackItems) {
            const parent = findLibraryParentStackId(item.stackItems, id, item.id)
            if (parent !== null || item.stackItems.some(child => child.id === id)) return parent
        }
    }
    return null
}

export function flattenLibraryLeaves(items: LibraryItem[]): LibraryItem[] {
    return items.flatMap(item => item.isStack
        ? flattenLibraryLeaves(item.stackItems || [])
        : [item]
    )
}

export function flattenLibraryItems(items: LibraryItem[]): LibraryItem[] {
    return items.flatMap(item => [item, ...flattenLibraryItems(item.stackItems || [])])
}

export function getFirstLibraryLeaf(item: LibraryItem): LibraryItem {
    let current = item
    while (current.isStack && current.stackItems?.length) {
        current = current.stackItems[0]
    }
    return current
}

function containsLibraryItem(item: LibraryItem, id: string): boolean {
    return item.id === id || Boolean(item.stackItems?.some(child => containsLibraryItem(child, id)))
}

function refreshStack(stack: LibraryItem, stackItems: LibraryItem[]): LibraryItem {
    const thumbnail = getFirstLibraryLeaf(stackItems[0])
    return {
        ...stack,
        path: thumbnail.path,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailPath: thumbnail.thumbnailPath,
        thumbnailVersion: thumbnail.thumbnailVersion,
        stackItems,
    }
}

function assignFolderToTree(item: LibraryItem, folderId?: string): LibraryItem {
    if (!item.isStack || !item.stackItems) return { ...item, folderId }
    return {
        ...item,
        folderId,
        stackItems: item.stackItems.map(child => assignFolderToTree(child, folderId)),
    }
}

function updateTree(
    items: LibraryItem[],
    id: string,
    updater: (item: LibraryItem) => LibraryItem | null
): { items: LibraryItem[], changed: boolean } {
    let changed = false
    const nextItems: LibraryItem[] = []

    for (const item of items) {
        if (item.id === id) {
            const updated = updater(item)
            if (updated) nextItems.push(updated)
            changed = true
            continue
        }

        if (item.isStack && item.stackItems) {
            const nested = updateTree(item.stackItems, id, updater)
            if (nested.changed) {
                changed = true
                if (nested.items.length > 0) nextItems.push(refreshStack(item, nested.items))
                continue
            }
        }

        nextItems.push(item)
    }

    return { items: changed ? nextItems : items, changed }
}

function replaceTreeItem(
    items: LibraryItem[],
    id: string,
    replacements: LibraryItem[]
): { items: LibraryItem[], changed: boolean } {
    let changed = false
    const nextItems: LibraryItem[] = []

    for (const item of items) {
        if (item.id === id) {
            nextItems.push(...replacements)
            changed = true
            continue
        }

        if (item.isStack && item.stackItems) {
            const nested = replaceTreeItem(item.stackItems, id, replacements)
            if (nested.changed) {
                changed = true
                if (nested.items.length > 0) nextItems.push(refreshStack(item, nested.items))
                continue
            }
        }

        nextItems.push(item)
    }

    return { items: changed ? nextItems : items, changed }
}

function removeIdsFromTree(items: LibraryItem[], ids: Set<string>): LibraryItem[] {
    const nextItems: LibraryItem[] = []
    for (const item of items) {
        if (ids.has(item.id)) continue
        if (item.isStack && item.stackItems) {
            const stackItems = removeIdsFromTree(item.stackItems, ids)
            if (stackItems.length === 0) continue
            nextItems.push(stackItems === item.stackItems ? item : refreshStack(item, stackItems))
        } else {
            nextItems.push(item)
        }
    }
    return nextItems
}

function createStackItem(selectedItems: LibraryItem[]): LibraryItem {
    const thumbnail = getFirstLibraryLeaf(selectedItems[0])
    const folderId = selectedItems[0].folderId
    return {
        id: crypto.randomUUID(),
        name: selectedItems[0].name,
        path: thumbnail.path,
        width: thumbnail.width,
        height: thumbnail.height,
        createdAt: Date.now(),
        thumbnailPath: thumbnail.thumbnailPath,
        thumbnailVersion: thumbnail.thumbnailVersion,
        folderId,
        isStack: true,
        stackItems: selectedItems.map(item => assignFolderToTree(item, folderId)),
    }
}

function stackSelectedItems(source: LibraryItem[], selectedIds: Set<string>): LibraryItem[] {
    const selectedItems = source.filter(item => selectedIds.has(item.id))
    if (selectedItems.length < 2) return source

    const firstIndex = source.findIndex(item => selectedIds.has(item.id))
    const remaining = source.filter(item => !selectedIds.has(item.id))
    remaining.splice(firstIndex, 0, createStackItem(selectedItems))
    return remaining
}

function reorder(source: LibraryItem[], activeId: string, overId: string): LibraryItem[] {
    const from = source.findIndex(item => item.id === activeId)
    const to = source.findIndex(item => item.id === overId)
    if (from < 0 || to < 0 || from === to) return source

    const reordered = [...source]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    return reordered
}

interface LibraryState {
    items: LibraryItem[]
    folders: LibraryFolder[]
    draggedSource: { name: string, path: string } | null
    gridColumns: number
    isEditMode: boolean
    selectedItemIds: string[]
    lastSelectedItemId: string | null
    currentStackId: string | null

    setGridColumns: (columns: number) => void
    addItem: (item: LibraryItem) => void
    removeItem: (id: string) => void
    removeItems: (ids: string[]) => void
    setItems: (items: LibraryItem[]) => void
    updateItem: (id: string, updates: Partial<LibraryItem>) => void
    setDraggedSource: (source: { name: string, path: string } | null) => void
    setEditMode: (isEdit: boolean) => void
    toggleItemSelection: (itemId: string, clearOthers?: boolean) => void
    selectItemRange: (fromId: string, toId: string, visibleIds?: string[]) => void
    selectAllItems: (visibleIds?: string[]) => void
    clearSelection: () => void
    deleteSelectedItems: () => void
    setLastSelectedItemId: (id: string | null) => void
    createStackFromSelected: () => void
    moveItemToStack: (itemId: string, stackId: string) => void
    reorderItems: (activeId: string, overId: string) => void
    unstack: (stackId: string) => void
    getStackItems: (stackId: string) => LibraryItem[]
    setCurrentStackId: (id: string | null) => void
    addFolder: (name: string, parentId?: string) => string
    updateFolder: (id: string, updates: Partial<Omit<LibraryFolder, 'id'>>) => void
    deleteFolder: (id: string) => void
    moveFolder: (id: string, parentId?: string) => void
    reorderFolder: (id: string, direction: 'up' | 'down') => void
    toggleFolderCollapsed: (id: string) => void
    moveItemToFolder: (itemId: string, folderId?: string) => void
}

export const useLibraryStore = create<LibraryState>()(
    persist(
        (set, get) => ({
            items: [],
            folders: [],
            draggedSource: null,
            gridColumns: 4,
            isEditMode: false,
            selectedItemIds: [],
            lastSelectedItemId: null,
            currentStackId: null,

            setGridColumns: (columns) => set({ gridColumns: columns }),

            addItem: (item) => set(state => {
                if (!state.currentStackId) return { items: [item, ...state.items] }
                const updated = updateTree(state.items, state.currentStackId, stack =>
                    stack.isStack ? refreshStack(stack, [...(stack.stackItems || []), item]) : stack
                )
                return { items: updated.changed ? updated.items : [item, ...state.items] }
            }),

            removeItem: (id) => set(state => {
                const parentId = state.currentStackId
                    ? findLibraryParentStackId(state.items, state.currentStackId)
                    : null
                const updated = updateTree(state.items, id, () => null)
                const currentStackExists = state.currentStackId
                    ? Boolean(findLibraryItem(updated.items, state.currentStackId))
                    : true
                return {
                    items: updated.items,
                    currentStackId: currentStackExists ? state.currentStackId : parentId,
                }
            }),

            removeItems: (ids) => set(state => ({
                items: removeIdsFromTree(state.items, new Set(ids))
            })),

            setItems: (items) => set({ items }),

            updateItem: (id, updates) => set(state => ({
                items: updateTree(state.items, id, item => ({ ...item, ...updates })).items
            })),

            setDraggedSource: (source) => set({ draggedSource: source }),

            setEditMode: (isEdit) => set({
                isEditMode: isEdit,
                selectedItemIds: [],
                lastSelectedItemId: null,
            }),

            toggleItemSelection: (itemId, clearOthers = false) => {
                const { selectedItemIds } = get()
                if (clearOthers) {
                    set({
                        selectedItemIds: selectedItemIds.includes(itemId) ? [] : [itemId],
                        lastSelectedItemId: itemId,
                    })
                    return
                }
                set({
                    selectedItemIds: selectedItemIds.includes(itemId)
                        ? selectedItemIds.filter(id => id !== itemId)
                        : [...selectedItemIds, itemId],
                    lastSelectedItemId: itemId,
                })
            },

            selectItemRange: (fromId, toId, visibleIds) => {
                const { items, currentStackId } = get()
                const viewItems = currentStackId
                    ? findLibraryItem(items, currentStackId)?.stackItems || []
                    : items
                const selectableItems = visibleIds
                    ? visibleIds.map(id => viewItems.find(item => item.id === id)).filter((item): item is LibraryItem => Boolean(item))
                    : viewItems
                const fromIndex = selectableItems.findIndex(item => item.id === fromId)
                const toIndex = selectableItems.findIndex(item => item.id === toId)
                if (fromIndex === -1 || toIndex === -1) return

                const start = Math.min(fromIndex, toIndex)
                const end = Math.max(fromIndex, toIndex)
                const rangeIds = selectableItems.slice(start, end + 1)
                    .filter(item => !item.isStack)
                    .map(item => item.id)
                set({ selectedItemIds: rangeIds, lastSelectedItemId: toId })
            },

            selectAllItems: (visibleIds) => {
                const { items, currentStackId } = get()
                const viewItems = currentStackId
                    ? findLibraryItem(items, currentStackId)?.stackItems || []
                    : items
                const visibleIdSet = visibleIds ? new Set(visibleIds) : null
                set({ selectedItemIds: viewItems
                    .filter(item => !item.isStack && (!visibleIdSet || visibleIdSet.has(item.id)))
                    .map(item => item.id) })
            },

            clearSelection: () => set({ selectedItemIds: [], lastSelectedItemId: null }),

            deleteSelectedItems: () => {
                const { items, selectedItemIds, currentStackId } = get()
                const selectedIds = new Set(selectedItemIds)
                if (!currentStackId) {
                    set({
                        items: removeIdsFromTree(items, selectedIds),
                        selectedItemIds: [],
                        isEditMode: false,
                    })
                    return
                }

                const parentId = findLibraryParentStackId(items, currentStackId)
                const updated = updateTree(items, currentStackId, stack => {
                    const stackItems = (stack.stackItems || []).filter(item => !selectedIds.has(item.id))
                    return stackItems.length > 0 ? refreshStack(stack, stackItems) : null
                })
                set({
                    items: updated.items,
                    currentStackId: findLibraryItem(updated.items, currentStackId) ? currentStackId : parentId,
                    selectedItemIds: [],
                    isEditMode: false,
                })
            },

            setLastSelectedItemId: (id) => set({ lastSelectedItemId: id }),

            createStackFromSelected: () => {
                const { items, selectedItemIds, currentStackId } = get()
                const selectedIds = new Set(selectedItemIds)
                if (selectedIds.size < 2) return

                const nextItems = currentStackId
                    ? updateTree(items, currentStackId, stack => {
                        const stackItems = stackSelectedItems(stack.stackItems || [], selectedIds)
                        return stackItems === stack.stackItems ? stack : refreshStack(stack, stackItems)
                    }).items
                    : stackSelectedItems(items, selectedIds)

                set({ items: nextItems, selectedItemIds: [], isEditMode: false })
            },

            moveItemToStack: (itemId, stackId) => {
                const { items } = get()
                const item = findLibraryItem(items, itemId)
                const stack = findLibraryItem(items, stackId)
                if (!item || !stack?.isStack || itemId === stackId) return
                if (item.isStack && containsLibraryItem(item, stackId)) return

                const removed = updateTree(items, itemId, () => null)
                const inserted = updateTree(removed.items, stackId, target =>
                    target.isStack
                        ? refreshStack(target, [...(target.stackItems || []), item])
                        : target
                )
                if (inserted.changed) set({ items: inserted.items })
            },

            reorderItems: (activeId, overId) => {
                const { items, currentStackId } = get()
                if (!currentStackId) {
                    set({ items: reorder(items, activeId, overId) })
                    return
                }

                const updated = updateTree(items, currentStackId, stack => {
                    const stackItems = reorder(stack.stackItems || [], activeId, overId)
                    return stackItems === stack.stackItems ? stack : refreshStack(stack, stackItems)
                })
                set({ items: updated.items })
            },

            unstack: (stackId) => {
                const { items } = get()
                const stack = findLibraryItem(items, stackId)
                if (!stack?.isStack || !stack.stackItems) return

                const parentId = findLibraryParentStackId(items, stackId)
                const updated = replaceTreeItem(items, stackId, stack.stackItems)
                set({ items: updated.items, currentStackId: parentId })
            },

            getStackItems: (stackId) => findLibraryItem(get().items, stackId)?.stackItems || [],

            setCurrentStackId: (id) => set({
                currentStackId: id,
                isEditMode: false,
                selectedItemIds: [],
            }),

            addFolder: (name, parentId) => {
                const id = crypto.randomUUID()
                set(state => ({
                    folders: [...state.folders, { id, name, parentId, collapsed: false, colorIndex: 0 }]
                }))
                return id
            },

            updateFolder: (id, updates) => set(state => ({
                folders: state.folders.map(folder => folder.id === id ? { ...folder, ...updates } : folder)
            })),

            deleteFolder: (id) => set(state => {
                const folder = state.folders.find(candidate => candidate.id === id)
                if (!folder) return state
                return {
                    folders: state.folders
                        .filter(candidate => candidate.id !== id)
                        .map(candidate => candidate.parentId === id
                            ? { ...candidate, parentId: folder.parentId }
                            : candidate
                        ),
                    items: state.items.map(item => item.folderId === id
                        ? assignFolderToTree(item, folder.parentId)
                        : item
                    ),
                }
            }),

            moveFolder: (id, parentId) => set(state => {
                const folder = state.folders.find(candidate => candidate.id === id)
                if (!folder || folder.parentId === parentId) return state
                if (parentId && !state.folders.some(candidate => candidate.id === parentId)) return state
                if (parentId && getLibraryFolderDescendantIds(state.folders, id).has(parentId)) return state
                return {
                    folders: state.folders.map(candidate => candidate.id === id
                        ? { ...candidate, parentId }
                        : candidate
                    )
                }
            }),

            reorderFolder: (id, direction) => set(state => {
                const folder = state.folders.find(candidate => candidate.id === id)
                if (!folder) return state
                const siblingIndices = state.folders
                    .map((candidate, index) => ({ candidate, index }))
                    .filter(({ candidate }) => candidate.parentId === folder.parentId)
                    .map(({ index }) => index)
                const position = siblingIndices.findIndex(index => state.folders[index].id === id)
                const targetPosition = direction === 'up' ? position - 1 : position + 1
                if (position < 0 || targetPosition < 0 || targetPosition >= siblingIndices.length) return state

                const nextFolders = [...state.folders]
                const currentIndex = siblingIndices[position]
                const targetIndex = siblingIndices[targetPosition]
                ;[nextFolders[currentIndex], nextFolders[targetIndex]] = [nextFolders[targetIndex], nextFolders[currentIndex]]
                return { folders: nextFolders }
            }),

            toggleFolderCollapsed: (id) => set(state => ({
                folders: state.folders.map(folder => folder.id === id
                    ? { ...folder, collapsed: !folder.collapsed }
                    : folder
                )
            })),

            moveItemToFolder: (itemId, folderId) => set(state => {
                if (folderId && !state.folders.some(folder => folder.id === folderId)) return state
                const item = findLibraryItem(state.items, itemId)
                if (!item || item.folderId === folderId) return state
                const updated = updateTree(state.items, itemId, item => assignFolderToTree(item, folderId))
                return updated.changed ? { items: updated.items } : state
            }),
        }),
        {
            name: 'nais2-forge-library',
            storage: createNativeDeferredJSONStorage(1000, 5000),
            partialize: state => ({ items: state.items, folders: state.folders, gridColumns: state.gridColumns }),
        }
    )
)
