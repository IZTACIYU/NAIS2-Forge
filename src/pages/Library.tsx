import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
    DndContext,
    pointerWithin,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    defaultDropAnimationSideEffects,
    DragStartEvent,
    DragEndEvent,
    DragOverEvent,
    MeasuringStrategy
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import {
    useLibraryStore,
    LibraryItem,
    findLibraryItem,
    findLibraryParentStackId,
    flattenLibraryItems,
    flattenLibraryLeaves,
    getFirstLibraryLeaf,
} from '@/stores/library-store'
import { SortableLibraryItem } from '@/components/library/SortableLibraryItem'
import { LibraryItem as LibraryItemComponent } from '@/components/library/LibraryItem'
import { useTranslation } from 'react-i18next'
import { mkdir, exists, writeFile, remove, BaseDirectory } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { Command } from '@tauri-apps/plugin-shell'
import { toast } from '@/components/ui/use-toast'
import { ImagePlus, X, Grid3x3, Edit3, Trash2, Layers, ArrowLeft, CheckSquare, FolderOpen, Upload, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { useSettingsStore } from '@/stores/settings-store'

const STACK_DROP_HOVER_MS = 1000

const waitForLibraryMaintenance = () => new Promise<void>(resolve => {
    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(() => resolve())
    } else {
        setTimeout(resolve, 120)
    }
})

const arrayBufferToBase64 = (buffer: Uint8Array): string => {
    let binary = ''
    for (let i = 0; i < buffer.byteLength; i++) binary += String.fromCharCode(buffer[i])
    return btoa(binary)
}

const dropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
        styles: {
            active: {
                opacity: '0.5',
            },
        },
    }),
}

import { LibraryRenameDialog } from '@/components/library/LibraryRenameDialog'
import {
    LIBRARY_ALL_FOLDER_ID,
    LIBRARY_FOLDER_DROP_PREFIX,
    LIBRARY_UNGROUPED_FOLDER_ID,
    LibraryFolderSelection,
    LibraryFolderSidebar,
} from '@/components/library/LibraryFolderSidebar'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { readFile } from '@tauri-apps/plugin-fs'

// ... existing imports

export default function Library() {
    const { t } = useTranslation()
    const { 
        items,
        folders,
        addItem, 
        setItems, 
        updateItem, 
        gridColumns, 
        setGridColumns,
        // Edit Mode
        isEditMode,
        setEditMode,
        selectedItemIds,
        selectAllItems,
        clearSelection: _clearSelection,
        deleteSelectedItems,
        // Stack
        createStackFromSelected,
        moveItemToStack,
        reorderItems,
        currentStackId,
        setCurrentStackId,
        unstack,
        moveItemToFolder,
    } = useLibraryStore()
    const { libraryPath, useAbsoluteLibraryPath, expertLibraryFolderBrowserEnabled } = useSettingsStore()
    const [activeId, setActiveId] = useState<string | null>(null)
    const [stackDropTargetId, setStackDropTargetId] = useState<string | null>(null)
    const stackDropTargetIdRef = useRef<string | null>(null)
    const stackDropCandidateRef = useRef<string | null>(null)
    const stackDropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const activeDragItemRef = useRef<LibraryItem | null>(null)
    const activeDragDescendantIdsRef = useRef<Set<string>>(new Set())
    const [isDraggingFile, setIsDraggingFile] = useState(false)
    const [folderPanelOpen, setFolderPanelOpen] = useState(true)
    const [selectedFolderId, setSelectedFolderId] = useState<LibraryFolderSelection>(LIBRARY_ALL_FOLDER_ID)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Get current view items (main library or inside a stack)
    const currentStack = currentStackId ? findLibraryItem(items, currentStackId) : null
    const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders])
    const viewItems = useMemo(() => {
        if (currentStackId) return currentStack?.stackItems || []
        if (!expertLibraryFolderBrowserEnabled || selectedFolderId === LIBRARY_ALL_FOLDER_ID) return items
        if (selectedFolderId === LIBRARY_UNGROUPED_FOLDER_ID) {
            return items.filter(item => !item.folderId || !folderIds.has(item.folderId))
        }
        return items.filter(item => item.folderId === selectedFolderId)
    }, [currentStack, currentStackId, expertLibraryFolderBrowserEnabled, folderIds, items, selectedFolderId])
    const viewItemIds = useMemo(() => viewItems.map(item => item.id), [viewItems])
    const itemById = useMemo(() => new Map(
        flattenLibraryItems(items).map(item => [item.id, item])
    ), [items])

    useEffect(() => {
        if (
            selectedFolderId !== LIBRARY_ALL_FOLDER_ID
            && selectedFolderId !== LIBRARY_UNGROUPED_FOLDER_ID
            && !folderIds.has(selectedFolderId)
        ) {
            setSelectedFolderId(LIBRARY_ALL_FOLDER_ID)
        }
    }, [folderIds, selectedFolderId])

    // Dialog States
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [selectedItemForRename, setSelectedItemForRename] = useState<LibraryItem | null>(null)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [selectedImageRef, setSelectedImageRef] = useState<string | null>(null)
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()

    // Fullscreen viewer state
    const [viewerImageSrc, setViewerImageSrc] = useState<string | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    const clearStackDropTarget = useCallback(() => {
        if (stackDropTimerRef.current) clearTimeout(stackDropTimerRef.current)
        stackDropTimerRef.current = null
        stackDropCandidateRef.current = null
        if (stackDropTargetIdRef.current !== null) {
            stackDropTargetIdRef.current = null
            setStackDropTargetId(null)
        }
    }, [])

    useEffect(() => clearStackDropTarget, [clearStackDropTarget])

    // ESC key handler for closing viewer
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && viewerImageSrc) {
                setViewerImageSrc(null)
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [viewerImageSrc])

    // Ensure Library Directory Exists & Sync Files
    useEffect(() => {
        let cancelled = false
        const initDir = async () => {
            try {
                // 1. Ensure Dir Exists
                if (useAbsoluteLibraryPath && libraryPath) {
                    // Absolute path
                    const existsDir = await exists(libraryPath)
                    if (!existsDir) {
                        await mkdir(libraryPath, { recursive: true })
                    }
                } else {
                    // Relative to Pictures folder
                    const relPath = libraryPath || 'NAIS_Library'
                    const existsDir = await exists(relPath, { baseDir: BaseDirectory.Picture })
                    if (!existsDir) {
                        await mkdir(relPath, { baseDir: BaseDirectory.Picture })
                    }
                }

                // File maintenance is intentionally idle and sequential. A parallel
                // scan of large stacks competes with thumbnail decoding and scrolling.
                await waitForLibraryMaintenance()
                if (cancelled) return

                const currentItems = useLibraryStore.getState().items
                const validItems: LibraryItem[] = []
                let changed = false

                const validateItem = async (item: LibraryItem): Promise<LibraryItem | null> => {
                    if (item.isStack && item.stackItems) {
                        const validStackItems: LibraryItem[] = []
                        for (const stackItem of item.stackItems) {
                            if (cancelled) return item
                            await waitForLibraryMaintenance()
                            const result = await validateItem(stackItem)
                            if (result) validStackItems.push(result)
                        }

                        if (validStackItems.length === 0) {
                            changed = true
                            return null
                        }

                        const thumbnail = getFirstLibraryLeaf(validStackItems[0])
                        const stackChanged = validStackItems.length !== item.stackItems.length
                            || validStackItems.some((entry, index) => entry !== item.stackItems?.[index])
                            || item.path !== thumbnail.path
                            || item.thumbnailPath !== thumbnail.thumbnailPath
                            || item.thumbnailVersion !== thumbnail.thumbnailVersion
                        if (stackChanged) {
                            changed = true
                            return {
                                ...item,
                                path: thumbnail.path,
                                width: thumbnail.width,
                                height: thumbnail.height,
                                thumbnailPath: thumbnail.thumbnailPath,
                                thumbnailVersion: thumbnail.thumbnailVersion,
                                stackItems: validStackItems,
                            }
                        }
                        return item
                    }

                    try {
                        await waitForLibraryMaintenance()
                        if (cancelled) return item
                        if (await exists(item.path)) return item
                        changed = true
                        return null
                    } catch (error) {
                        console.warn('Failed to check file existence for ' + item.name + ':', error)
                        return item
                    }
                }

                for (const item of currentItems) {
                    if (cancelled) return
                    const result = await validateItem(item)
                    if (result) validItems.push(result)
                }

                if (changed && !cancelled) {
                    setItems(validItems)
                    console.log('[Library] Synced missing files and repaired stack thumbnails.')
                }

            } catch (e) {
                console.error('Failed to init/sync library:', e)
            }
        }
        void initDir()
        return () => { cancelled = true }
    }, [setItems, libraryPath, useAbsoluteLibraryPath])

    const handleDeleteSelected = useCallback(async () => {
        const sourceItems = currentStackId
            ? (findLibraryItem(items, currentStackId)?.stackItems || [])
            : items
        const selectedItems = sourceItems.filter(item => selectedItemIds.includes(item.id))
        const expandedItems = flattenLibraryLeaves(selectedItems)
        const originalPaths = expandedItems.map(item => item.path)
        const thumbnailPaths = flattenLibraryItems(selectedItems)
            .map(item => item.thumbnailPath)
            .filter((path): path is string => Boolean(path))
        const pathsToDelete = [...new Set([...originalPaths, ...thumbnailPaths])]

        await Promise.allSettled(pathsToDelete.map(path => remove(path)))
        if (originalPaths.length > 0) {
            window.dispatchEvent(new CustomEvent('imageDeleted', {
                detail: { paths: originalPaths }
            }))
        }
        deleteSelectedItems()
    }, [currentStackId, deleteSelectedItems, items, selectedItemIds])

    const handleDragStart = (event: DragStartEvent) => {
        clearStackDropTarget()
        const nextActiveId = String(event.active.id)
        const activeItem = itemById.get(nextActiveId) || null
        activeDragItemRef.current = activeItem
        activeDragDescendantIdsRef.current = activeItem?.isStack
            ? new Set(flattenLibraryItems(activeItem.stackItems || []).map(item => item.id))
            : new Set()
        setActiveId(nextActiveId)
    }

    const handleDragOver = (event: DragOverEvent) => {
        const overId = event.over ? String(event.over.id) : null
        const activeItem = activeDragItemRef.current
        const overItem = overId ? itemById.get(overId) : null
        const createsCycle = Boolean(overId && activeDragDescendantIdsRef.current.has(overId))

        if (!activeItem || !overId || activeItem.id === overId || !overItem?.isStack || createsCycle) {
            if (stackDropCandidateRef.current !== null || stackDropTargetIdRef.current !== null) {
                clearStackDropTarget()
            }
            return
        }
        if (stackDropCandidateRef.current === overId) return

        clearStackDropTarget()
        stackDropCandidateRef.current = overId
        stackDropTimerRef.current = setTimeout(() => {
            stackDropTimerRef.current = null
            stackDropTargetIdRef.current = overId
            setStackDropTargetId(overId)
        }, STACK_DROP_HOVER_MS)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event

        if (over && active.id !== over.id) {
            const overId = String(over.id)
            if (overId.startsWith(LIBRARY_FOLDER_DROP_PREFIX)) {
                const folderId = overId.slice(LIBRARY_FOLDER_DROP_PREFIX.length)
                moveItemToFolder(
                    String(active.id),
                    folderId === LIBRARY_UNGROUPED_FOLDER_ID ? undefined : folderId
                )
                clearStackDropTarget()
                activeDragItemRef.current = null
                activeDragDescendantIdsRef.current.clear()
                setActiveId(null)
                return
            }
            const activeItem = activeDragItemRef.current
            const overItem = itemById.get(overId)
            if (activeItem && overItem?.isStack && stackDropTargetId === overId) {
                moveItemToStack(String(active.id), overId)
            } else {
                reorderItems(String(active.id), overId)
            }
        }

        clearStackDropTarget()
        activeDragItemRef.current = null
        activeDragDescendantIdsRef.current.clear()
        setActiveId(null)
    }

    const handleDragCancel = () => {
        clearStackDropTarget()
        activeDragItemRef.current = null
        activeDragDescendantIdsRef.current.clear()
        setActiveId(null)
    }

    // Handle File Drop from OS
    const onFileDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDraggingFile(false)

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files)
            const imageFiles = files.filter(f => f.type.startsWith('image/'))

            if (imageFiles.length === 0) return

            try {
                const picturePath = await pictureDir()
                const relPath = libraryPath || 'NAIS_Library'
                const libraryDir = useAbsoluteLibraryPath && libraryPath
                    ? libraryPath
                    : await join(picturePath, relPath)

                // Ensure dir exists
                if (useAbsoluteLibraryPath && libraryPath) {
                    if (!(await exists(libraryPath))) {
                        await mkdir(libraryPath, { recursive: true })
                    }
                } else {
                    if (!(await exists(relPath, { baseDir: BaseDirectory.Picture }))) {
                        await mkdir(relPath, { baseDir: BaseDirectory.Picture })
                    }
                }

                let addedCount = 0

                // Check for custom app metadata
                const customFilename = e.dataTransfer.getData('nais/filename')

                for (const file of imageFiles) {
                    const buffer = await file.arrayBuffer()
                    const uint8Array = new Uint8Array(buffer)
                    const ext = file.name.split('.').pop() || 'png'
                    const uuid = crypto.randomUUID()
                    const shortUuid = uuid.split('-')[0] // First 8 chars for shorter names

                    // Determine filename - add UUID suffix to prevent collisions
                    let baseName = file.name.replace(/\.[^.]+$/, '') // Remove extension
                    if (customFilename && imageFiles.length === 1) {
                        baseName = customFilename.replace(/\.[^.]+$/, '')
                    }

                    // Create unique filename: originalName_xxxxxxxx.ext
                    const fileName = `${baseName}_${shortUuid}.${ext}`

                    const newPath = await join(libraryDir, fileName)

                    // Write
                    if (useAbsoluteLibraryPath && libraryPath) {
                        await writeFile(newPath, uint8Array)
                    } else {
                        const relPath = libraryPath || 'NAIS_Library'
                        await writeFile(`${relPath}/${fileName}`, uint8Array, { baseDir: BaseDirectory.Picture })
                    }

                    const newItem: LibraryItem = {
                        id: uuid,
                        name: fileName.replace(`.${ext}`, ''), // Display Name matched
                        path: newPath,
                        width: 0,
                        height: 0,
                        createdAt: Date.now(),
                        folderId: currentStack?.folderId
                            || (expertLibraryFolderBrowserEnabled && folderIds.has(selectedFolderId)
                                ? selectedFolderId
                                : undefined),
                    }

                    addItem(newItem)
                    addedCount++
                }

                if (addedCount > 0) {
                    toast({
                        title: t('library.added', '이미지 추가됨'),
                        description: t('library.addedDesc', { count: addedCount }),
                        variant: 'success'
                    })
                }
            } catch (error) {
                console.error('File import failed:', error)
                toast({
                    title: t('library.error', '가져오기 실패'),
                    variant: 'destructive'
                })
            }
        }
    }, [addItem, currentStack?.folderId, expertLibraryFolderBrowserEnabled, folderIds, libraryPath, selectedFolderId, t, useAbsoluteLibraryPath])

    const activeItem = activeId ? viewItems.find(i => i.id === activeId) : null

    // Handlers
    const handleRenameClick = useCallback((item: LibraryItem) => {
        setSelectedItemForRename(item)
        setRenameDialogOpen(true)
    }, [])

    const handleRenameConfirm = (newName: string) => {
        if (selectedItemForRename) {
            updateItem(selectedItemForRename.id, { name: newName })
            // Note: We are currently NOT renaming the physical file to avoid file referencing issues or complexity for now.
            // The user request was "Rename in context menu", which usually implies display name.
            // If physical rename is strictly required, we'd need `rename`.
            // Given "Unify filenames" requirement earlier, maybe physical rename is expected?
            // "Name change" usually means the display name in the app.
            // Let's stick to display name update in the store for safety.
            toast({ title: t('actions.saved', '저장 완료'), variant: 'success' })
        }
    }

    const handleAddRefClick = useCallback(async (item: LibraryItem) => {
        try {
            const data = await readFile(item.path)
            const base64 = arrayBufferToBase64(data)
            setSelectedImageRef(`data:image/png;base64,${base64}`)
            setImageRefDialogOpen(true)
        } catch (e) {
            console.error('Failed to load for ref:', e)
            toast({ title: t('library.error', '오류 발생'), variant: 'destructive' })
        }
    }, [t])

    const handleLoadMetadata = useCallback(async (item: LibraryItem) => {
        try {
            const data = await readFile(item.path)
            const base64 = arrayBufferToBase64(data)
            setSelectedImageForMetadata(`data:image/png;base64,${base64}`)
            setMetadataDialogOpen(true)
        } catch (e) {
            console.error('Failed to load metadata:', e)
            toast({ title: t('library.error', '오류 발생'), variant: 'destructive' })
        }
    }, [t])

    const handleItemImageClick = useCallback((item: LibraryItem, imageUrl: string) => {
        const store = useLibraryStore.getState()
        if (store.isEditMode && !item.isStack) {
            store.toggleItemSelection(item.id, false)
        } else if (item.isStack) {
            store.setCurrentStackId(item.id)
        } else {
            setViewerImageSrc(imageUrl)
        }
    }, [])

    const handleItemSelectionClick = useCallback((item: LibraryItem, event: React.MouseEvent) => {
        if (item.isStack) return
        const store = useLibraryStore.getState()
        if (event.shiftKey && store.lastSelectedItemId) {
            store.selectItemRange(store.lastSelectedItemId, item.id, viewItemIds)
        } else if (event.ctrlKey || event.metaKey) {
            store.toggleItemSelection(item.id, false)
        } else {
            store.toggleItemSelection(item.id, true)
        }
    }, [viewItemIds])

    const handleToggleGrid = () => {
        const next = gridColumns >= 5 ? 2 : gridColumns + 1
        setGridColumns(next)
    }

    const handleOpenLibraryFolder = async () => {
        try {
            const folderPath = useAbsoluteLibraryPath && libraryPath
                ? libraryPath
                : await join(await pictureDir(), libraryPath || 'NAIS_Library')
            if (!(await exists(folderPath))) await mkdir(folderPath, { recursive: true })
            await Command.create('explorer', [folderPath]).execute()
        } catch (error) {
            console.error('Failed to open library folder:', error)
        }
    }

    // File import handler
    const handleImportClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
        if (imageFiles.length === 0) return

        try {
            const picturePath = await pictureDir()
            const relPath = libraryPath || 'NAIS_Library'
            const libraryDir = useAbsoluteLibraryPath && libraryPath
                ? libraryPath
                : await join(picturePath, relPath)

            // Ensure dir exists
            if (useAbsoluteLibraryPath && libraryPath) {
                if (!(await exists(libraryPath))) {
                    await mkdir(libraryPath, { recursive: true })
                }
            } else {
                if (!(await exists(relPath, { baseDir: BaseDirectory.Picture }))) {
                    await mkdir(relPath, { baseDir: BaseDirectory.Picture })
                }
            }

            let addedCount = 0
            for (const file of imageFiles) {
                const buffer = await file.arrayBuffer()
                const uint8Array = new Uint8Array(buffer)
                const ext = file.name.split('.').pop() || 'png'
                const uuid = crypto.randomUUID()
                const shortUuid = uuid.split('-')[0]
                const baseName = file.name.replace(/\.[^.]+$/, '')
                const fileName = `${baseName}_${shortUuid}.${ext}`
                const newPath = await join(libraryDir, fileName)

                if (useAbsoluteLibraryPath && libraryPath) {
                    await writeFile(newPath, uint8Array)
                } else {
                    await writeFile(`${relPath}/${fileName}`, uint8Array, { baseDir: BaseDirectory.Picture })
                }

                const newItem: LibraryItem = {
                    id: uuid,
                    name: fileName.replace(`.${ext}`, ''),
                    path: newPath,
                    width: 0,
                    height: 0,
                    createdAt: Date.now(),
                    folderId: currentStack?.folderId
                        || (expertLibraryFolderBrowserEnabled && folderIds.has(selectedFolderId)
                            ? selectedFolderId
                            : undefined),
                }
                addItem(newItem)
                addedCount++
            }

            if (addedCount > 0) {
                toast({
                    title: t('library.added', '이미지 추가됨'),
                    description: t('library.addedDesc', { count: addedCount }),
                    variant: 'success'
                })
            }
        } catch (error) {
            console.error('File import failed:', error)
            toast({ title: t('library.error', '가져오기 실패'), variant: 'destructive' })
        }

        e.target.value = ''
    }

    return (
        <div
            className="h-full flex flex-col relative"
            onDragOver={(e) => {
                e.preventDefault()
                // Check if it's a file drag from OS
                if (e.dataTransfer.types.includes('Files')) {
                    if (!isDraggingFile) setIsDraggingFile(true)
                }
            }}
            onDragLeave={(e) => {
                e.preventDefault()
                // Simple check to see if we left the window
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setIsDraggingFile(false)
            }}
            onDrop={onFileDrop}
        >
            {/* Header */}
            <div className="h-14 border-b flex items-center px-6 justify-between bg-background/50 backdrop-blur-sm z-10 w-full box-border">
                {isEditMode ? (
                    /* Edit Mode Header */
                    <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground">
                                {selectedItemIds.length} {t('library.selected', '개 선택')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button variant="ghost" size="sm" className="h-9 hover:bg-white/10" onClick={() => selectAllItems(viewItemIds)}>
                                <CheckSquare className="h-4 w-4 mr-2" /> {t('scene.selectAll', '전체 선택')}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-9 hover:bg-white/10" onClick={() => setEditMode(false)}>
                                <X className="h-4 w-4 mr-2" /> {t('actions.cancel', '취소')}
                            </Button>
                            <div className="w-px h-5 bg-white/10" />
                            <Tip content={t('library.createStackDesc', '선택한 이미지를 하나의 스택으로 묶음')}>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-9 hover:bg-white/10"
                                    onClick={createStackFromSelected}
                                    disabled={selectedItemIds.length < 2}
                                >
                                    <Layers className="h-4 w-4 mr-2" /> {t('library.createStack', '스택 만들기')}
                                </Button>
                            </Tip>
                            <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-9 text-destructive hover:text-destructive hover:bg-destructive/10" 
                                onClick={handleDeleteSelected}
                                disabled={selectedItemIds.length === 0}
                            >
                                <Trash2 className="h-4 w-4 mr-2" /> {t('actions.delete', '삭제')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    /* Normal Header */
                    <>
                        <div className="flex items-center gap-3">
                            {currentStackId ? (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 hover:bg-white/10"
                                        onClick={() => setCurrentStackId(findLibraryParentStackId(items, currentStackId))}
                                    >
                                        <ArrowLeft className="h-4 w-4 mr-2" /> {t('actions.back', '뒤로')}
                                    </Button>
                                    <h2 className="text-lg font-semibold tracking-tight">{currentStack?.name}</h2>
                                </>
                            ) : (
                                <>
                                    <Tip content={t('library.openFolder', '폴더 열기')}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                            onClick={handleOpenLibraryFolder}
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                        </Button>
                                    </Tip>
                                    <h2 className="text-lg font-semibold tracking-tight">{t('library.title', '라이브러리')}</h2>
                                    {expertLibraryFolderBrowserEnabled && (
                                        <Tip content={t('library.toggleFolders', '폴더 패널 열기/닫기')}>
                                            <Button
                                                variant={folderPanelOpen ? 'secondary' : 'ghost'}
                                                size="icon"
                                                className="h-8 w-8"
                                                onClick={() => setFolderPanelOpen(open => !open)}
                                            >
                                                <Menu className="h-4 w-4" />
                                            </Button>
                                        </Tip>
                                    )}
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-3">
                            {/* Hidden file input for image import */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={handleFileInputChange}
                            />
                            {/* Import Image Button */}
                            <Tip content={t('library.import', '이미지 불러오기')}>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-white/10" 
                                    onClick={handleImportClick}
                                >
                                    <Upload className="h-4 w-4" />
                                </Button>
                            </Tip>
                            <Tip content={t('library.editModeDesc', '여러 이미지를 선택하여 일괄 편집')}>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-white/10" 
                                    onClick={() => setEditMode(true)} 
                                    disabled={viewItems.length === 0}
                                >
                                    <Edit3 className="h-4 w-4" />
                                </Button>
                            </Tip>
                            {currentStackId && (
                                <Tip content={t('library.unstackDesc', '스택을 해제하고 개별 이미지로 복원')}>
                                    <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        className="h-9 hover:bg-white/10" 
                                        onClick={() => unstack(currentStackId)}
                                    >
                                        <FolderOpen className="h-4 w-4 mr-2" /> {t('library.unstack', '스택 해제')}
                                    </Button>
                                </Tip>
                            )}
                            <Tip content={t('library.gridColumnsDesc', '그리드 열 개수 변경')}>
                                <Button variant="ghost" size="sm" className="h-9 text-muted-foreground hover:text-foreground hover:bg-white/10" onClick={handleToggleGrid}>
                                    <Grid3x3 className="h-4 w-4 mr-1.5" />
                                    <span className="font-medium text-sm">{gridColumns}</span>
                                </Button>
                            </Tip>
                            <span className="text-sm text-muted-foreground">{viewItems.length} {t('library.items', 'items')}</span>
                        </div>
                    </>
                )}
            </div>

            {/* Content */}
            <DndContext
                sensors={sensors}
                collisionDetection={pointerWithin}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
                measuring={{
                    droppable: {
                        strategy: MeasuringStrategy.BeforeDragging,
                    },
                }}
            >
                <div className="flex min-h-0 flex-1">
                    {expertLibraryFolderBrowserEnabled && folderPanelOpen && !currentStackId && (
                        <LibraryFolderSidebar
                            items={items}
                            selectedFolderId={selectedFolderId}
                            onSelectFolder={setSelectedFolderId}
                            isDraggingItem={activeId !== null}
                        />
                    )}
                    <div className="relative min-w-0 flex-1 overflow-y-auto p-6 custom-scrollbar">
                    <SortableContext
                        items={viewItemIds}
                        strategy={rectSortingStrategy}
                    >
                        <div
                            className="grid gap-6 pb-10"
                            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
                        >
                            {viewItems.map((item) => (
                                <SortableLibraryItem
                                    key={item.id}
                                    item={item}
                                    onRename={handleRenameClick}
                                    onAddRef={handleAddRefClick}
                                    onLoadMetadata={handleLoadMetadata}
                                    onImageClick={handleItemImageClick}
                                    isEditMode={isEditMode}
                                    isSelected={selectedItemIds.includes(item.id)}
                                    isStackDropTarget={stackDropTargetId === item.id}
                                    onSelectionClick={handleItemSelectionClick}
                                    disabled={isEditMode}
                                />
                            ))}
                        </div>
                    </SortableContext>
                        {viewItems.length === 0 && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none opacity-40">
                                <div className="w-24 h-24 rounded-full bg-muted/30 flex items-center justify-center mb-6 animate-pulse">
                                    <ImagePlus className="h-10 w-10 text-muted-foreground" />
                                </div>
                                <h3 className="text-xl font-semibold mb-2 text-foreground/80">
                                    {t('library.emptyTitle', '라이브러리가 비어있습니다')}
                                </h3>
                                <p className="text-sm text-muted-foreground text-center max-w-sm px-4 leading-relaxed">
                                    {t('library.emptyDesc', '이미지를 드래그하여 컬렉션을 만들어보세요')}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <DragOverlay
                    dropAnimation={dropAnimation}
                    modifiers={[snapCenterToCursor]}
                    style={{ willChange: 'transform' }}
                >
                    {activeItem ? (
                        <LibraryItemComponent item={activeItem} isOverlay />
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* File Drop Overlay - Modern Style from MainMode */}
            {isDraggingFile && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center transition-all duration-300 pointer-events-none">
                    <div className="relative">
                        {/* Animated ring */}
                        <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary via-purple-500 to-primary animate-pulse opacity-50 blur-xl" />

                        {/* Main card */}
                        <div className="relative bg-background/80 backdrop-blur-xl border border-white/20 rounded-3xl p-12 shadow-2xl transform transition-transform scale-100">
                            <div className="text-center space-y-4">
                                {/* Animated icon container */}
                                <div className="relative mx-auto w-20 h-20">
                                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                                    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center shadow-inner">
                                        <ImagePlus className="h-10 w-10 text-white" />
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xl font-bold text-foreground">
                                        {t('library.drop', '여기에 놓아서 추가')}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-2">
                                        {t('library.dropHint', '이미지를 드래그하여 추가하세요')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Dialogs */}
            <LibraryRenameDialog
                open={renameDialogOpen}
                onOpenChange={setRenameDialogOpen}
                initialName={selectedItemForRename?.name || ''}
                onConfirm={handleRenameConfirm}
            />

            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={selectedImageRef}
            />

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            {/* Full-Screen Image Viewer Overlay */}
            {viewerImageSrc && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center cursor-pointer"
                    onClick={() => setViewerImageSrc(null)}
                >
                    <img
                        src={viewerImageSrc}
                        alt="Full view"
                        className="max-w-[90vw] max-h-[90vh] object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 rounded-lg h-10 w-10"
                        onClick={() => setViewerImageSrc(null)}
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div>
    )
}
