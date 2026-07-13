import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDroppable } from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Images, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
    getLibraryFolderDescendantIds,
    LibraryFolder,
    LibraryItem,
    useLibraryStore,
} from '@/stores/library-store'
import { cn } from '@/lib/utils'

export const LIBRARY_ALL_FOLDER_ID = '__all__'
export const LIBRARY_UNGROUPED_FOLDER_ID = '__ungrouped__'
export const LIBRARY_FOLDER_DROP_PREFIX = 'library-folder:'

export type LibraryFolderSelection = string

interface LibraryFolderSidebarProps {
    items: LibraryItem[]
    selectedFolderId: LibraryFolderSelection
    onSelectFolder: (folderId: LibraryFolderSelection) => void
    isDraggingItem: boolean
}

interface DroppableFolderRowProps {
    dropId: string
    enabled: boolean
    children: React.ReactNode
}

function DroppableFolderRow({ dropId, enabled, children }: DroppableFolderRowProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: LIBRARY_FOLDER_DROP_PREFIX + dropId,
    })

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'rounded-md transition-colors',
                isOver && enabled && 'bg-primary/20 ring-1 ring-inset ring-primary/50'
            )}
        >
            {children}
        </div>
    )
}

function getFolderPath(folders: LibraryFolder[], folderId: string): string {
    const byId = new Map(folders.map(folder => [folder.id, folder]))
    const names: string[] = []
    const visited = new Set<string>()
    let current = byId.get(folderId)
    while (current && !visited.has(current.id)) {
        visited.add(current.id)
        names.unshift(current.name)
        current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return names.join(' / ')
}

export function LibraryFolderSidebar({
    items,
    selectedFolderId,
    onSelectFolder,
    isDraggingItem,
}: LibraryFolderSidebarProps) {
    const { t } = useTranslation()
    const {
        folders,
        addFolder,
        updateFolder,
        deleteFolder,
        moveFolder,
        toggleFolderCollapsed,
    } = useLibraryStore()
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
    const [editingFolderName, setEditingFolderName] = useState('')

    const folderIds = useMemo(() => new Set(folders.map(folder => folder.id)), [folders])
    const childrenByParent = useMemo(() => {
        const children = new Map<string, LibraryFolder[]>()
        for (const folder of folders) {
            const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : 'root'
            const entries = children.get(parentId) || []
            entries.push(folder)
            children.set(parentId, entries)
        }
        return children
    }, [folderIds, folders])

    const directCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const item of items) {
            if (item.folderId && folderIds.has(item.folderId)) {
                counts.set(item.folderId, (counts.get(item.folderId) || 0) + 1)
            }
        }
        return counts
    }, [folderIds, items])

    const folderCounts = useMemo(() => {
        const totals = new Map<string, number>()
        const countFolder = (folderId: string, visiting: Set<string>): number => {
            if (totals.has(folderId)) return totals.get(folderId)!
            if (visiting.has(folderId)) return 0
            const nextVisiting = new Set(visiting).add(folderId)
            const total = (directCounts.get(folderId) || 0)
                + (childrenByParent.get(folderId) || []).reduce(
                    (sum, child) => sum + countFolder(child.id, nextVisiting),
                    0
                )
            totals.set(folderId, total)
            return total
        }
        for (const folder of folders) countFolder(folder.id, new Set())
        return totals
    }, [childrenByParent, directCounts, folders])

    const ungroupedCount = items.filter(item => !item.folderId || !folderIds.has(item.folderId)).length

    const handleCreateFolder = (parentId?: string) => {
        const baseName = t('library.newFolderName', '새 폴더')
        const names = new Set(folders.map(folder => folder.name))
        let name = baseName
        let suffix = 2
        while (names.has(name)) {
            name = `${baseName}(${suffix})`
            suffix += 1
        }
        const id = addFolder(name, parentId)
        if (parentId) updateFolder(parentId, { collapsed: false })
        onSelectFolder(id)
        setEditingFolderId(id)
        setEditingFolderName(name)
    }

    const saveFolderName = (folderId: string) => {
        const name = editingFolderName.trim()
        if (name) updateFolder(folderId, { name })
        setEditingFolderId(null)
        setEditingFolderName('')
    }

    const handleDeleteFolder = (folder: LibraryFolder) => {
        deleteFolder(folder.id)
        if (selectedFolderId === folder.id) {
            onSelectFolder(folder.parentId || LIBRARY_ALL_FOLDER_ID)
        }
    }

    const renderFolder = (folder: LibraryFolder, depth = 0): React.ReactNode => {
        const children = childrenByParent.get(folder.id) || []
        const descendants = getLibraryFolderDescendantIds(folders, folder.id)
        const moveTargets = folders.filter(target => target.id !== folder.id && !descendants.has(target.id))
        return (
            <div key={folder.id}>
                <DroppableFolderRow dropId={folder.id} enabled={isDraggingItem}>
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div
                                className={cn(
                                    'group/folder flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-xs transition-colors',
                                    selectedFolderId === folder.id
                                        ? 'bg-primary/15 text-foreground'
                                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                                )}
                                style={{ paddingLeft: `${4 + depth * 12}px` }}
                                onClick={() => onSelectFolder(folder.id)}
                            >
                                <button
                                    type="button"
                                    className="flex h-6 w-5 shrink-0 items-center justify-center"
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        if (children.length > 0) toggleFolderCollapsed(folder.id)
                                    }}
                                >
                                    {children.length > 0 && (folder.collapsed
                                        ? <ChevronRight className="h-3.5 w-3.5" />
                                        : <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                </button>
                                {folder.collapsed
                                    ? <Folder className="h-4 w-4 shrink-0 text-sky-400" />
                                    : <FolderOpen className="h-4 w-4 shrink-0 text-sky-400" />
                                }
                                {editingFolderId === folder.id ? (
                                    <Input
                                        autoFocus
                                        value={editingFolderName}
                                        onChange={(event) => setEditingFolderName(event.target.value)}
                                        onBlur={() => saveFolderName(folder.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter') saveFolderName(folder.id)
                                            if (event.key === 'Escape') {
                                                setEditingFolderId(null)
                                                setEditingFolderName('')
                                            }
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                        className="h-6 min-w-0 flex-1 px-1 text-xs"
                                    />
                                ) : (
                                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                                )}
                                <span className="shrink-0 text-[10px] opacity-50">{folderCounts.get(folder.id) || 0}</span>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-56">
                            <ContextMenuItem onClick={() => handleCreateFolder(folder.id)}>
                                <FolderPlus className="mr-2 h-4 w-4" />
                                {t('library.addSubfolder', '하위 폴더 추가')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => {
                                setEditingFolderId(folder.id)
                                setEditingFolderName(folder.name)
                            }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {t('actions.rename', '이름 변경')}
                            </ContextMenuItem>
                            <ContextMenuSub>
                                <ContextMenuSubTrigger>
                                    <Folder className="mr-2 h-4 w-4" />
                                    {t('library.moveFolder', '폴더 이동')}
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                                    <ContextMenuItem
                                        disabled={!folder.parentId}
                                        onClick={() => moveFolder(folder.id, undefined)}
                                    >
                                        {t('library.moveToRoot', '최상위로 이동')}
                                    </ContextMenuItem>
                                    {moveTargets.map(target => (
                                        <ContextMenuItem
                                            key={target.id}
                                            disabled={folder.parentId === target.id}
                                            onClick={() => moveFolder(folder.id, target.id)}
                                        >
                                            <span className="max-w-48 truncate">{getFolderPath(folders, target.id)}</span>
                                        </ContextMenuItem>
                                    ))}
                                </ContextMenuSubContent>
                            </ContextMenuSub>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => handleDeleteFolder(folder)}
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('actions.delete', '삭제')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                </DroppableFolderRow>
                {!folder.collapsed && children.map(child => renderFolder(child, depth + 1))}
            </div>
        )
    }

    return (
        <aside className="flex w-[220px] min-w-[180px] max-w-[260px] shrink-0 flex-col border-r border-border/40 bg-background/20">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/30 px-3 text-xs font-medium text-muted-foreground">
                <span>{t('library.folders', '폴더')}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleCreateFolder()}>
                    <FolderPlus className="h-4 w-4" />
                </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-0.5 p-2">
                    <button
                        type="button"
                        className={cn(
                            'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                            selectedFolderId === LIBRARY_ALL_FOLDER_ID
                                ? 'bg-primary/15 text-foreground'
                                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                        )}
                        onClick={() => onSelectFolder(LIBRARY_ALL_FOLDER_ID)}
                    >
                        <Images className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{t('library.allView', '전체 보기')}</span>
                        <span className="text-[10px] opacity-50">{items.length}</span>
                    </button>
                    <DroppableFolderRow dropId={LIBRARY_UNGROUPED_FOLDER_ID} enabled={isDraggingItem}>
                        <button
                            type="button"
                            className={cn(
                                'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors',
                                selectedFolderId === LIBRARY_UNGROUPED_FOLDER_ID
                                    ? 'bg-primary/15 text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                            )}
                            onClick={() => onSelectFolder(LIBRARY_UNGROUPED_FOLDER_ID)}
                        >
                            <Folder className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{t('library.ungrouped', '미분류')}</span>
                            <span className="text-[10px] opacity-50">{ungroupedCount}</span>
                        </button>
                    </DroppableFolderRow>
                    {(childrenByParent.get('root') || []).map(folder => renderFolder(folder))}
                </div>
            </ScrollArea>
        </aside>
    )
}
