import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    pointerWithin,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTranslation } from 'react-i18next'
import {
    Check,
    ChevronDown,
    ChevronRight,
    Database,
    Eye,
    EyeOff,
    Folder,
    FolderPlus,
    GripVertical,
    Image as ImageIcon,
    Pencil,
    Power,
    Search,
    Trash2,
    Upload,
    X,
    Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import {
    type PreciseReferenceType,
    type ReferenceFolder,
    type ReferenceImage,
    type ReferenceMode,
    MAX_ACTIVE_REFERENCE_IMAGES,
    useCharacterStore,
} from '@/stores/character-store'

interface CharacterSettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

interface SortableImageCardProps {
    image: ReferenceImage
    fallbackName: string
    isVibe: boolean
    enabledCharacterCount: number
    enabledVibeCount: number
    collapsed: boolean
    editing: boolean
    editingName: string
    onEditingNameChange: (name: string) => void
    onToggleCollapsed: () => void
    onStartRename: () => void
    onCommitRename: () => void
    onCancelRename: () => void
    onUpdate: (updates: Partial<ReferenceImage>) => void
    onRemove: () => void
}

function SafeSlider({ value, onValueCommit, label }: { value: number; onValueCommit: (value: number) => void; label: string }) {
    const [localValue, setLocalValue] = useState([value])

    useEffect(() => setLocalValue([value]), [value])

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <Label className="truncate text-xs text-muted-foreground">{label}</Label>
                <span className="shrink-0 font-mono text-xs">{localValue[0].toFixed(2)}</span>
            </div>
            <Slider value={localValue} min={0} max={1} step={0.01} onValueChange={setLocalValue} onValueCommit={([next]) => onValueCommit(next)} />
        </div>
    )
}

function SortableImageCard({
    image,
    fallbackName,
    isVibe,
    enabledCharacterCount,
    enabledVibeCount,
    collapsed,
    editing,
    editingName,
    onEditingNameChange,
    onToggleCollapsed,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onUpdate,
    onRemove,
}: SortableImageCardProps) {
    const { t } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: `image:${image.id}`,
        data: { type: 'image', imageId: image.id, folderId: image.folderId },
    })
    const enabled = image.enabled !== false
    const enabledModeCount = isVibe ? enabledVibeCount : enabledCharacterCount
    const enableBlocked = !enabled && (
        (isVibe ? enabledCharacterCount > 0 : enabledVibeCount > 0)
        || enabledModeCount >= MAX_ACTIVE_REFERENCE_IMAGES
    )

    return (
        <section
            ref={setNodeRef}
            id={`reference-image-${image.id}`}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn('overflow-hidden rounded-lg border bg-card', !enabled && 'opacity-55', isDragging && 'z-20 opacity-30')}
        >
            <div className="flex min-h-10 items-center justify-between gap-1 border-b px-1.5 py-1">
                <button
                    type="button"
                    className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
                    aria-label={t('characterDialog.reorder')}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical className="h-4 w-4" />
                </button>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={onToggleCollapsed}>
                    {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    {editing ? (
                        <Input
                            value={editingName}
                            className="h-7 min-w-0 text-sm"
                            autoFocus
                            onClick={event => event.stopPropagation()}
                            onChange={event => onEditingNameChange(event.target.value)}
                            onBlur={onCommitRename}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') onCancelRename()
                            }}
                        />
                    ) : (
                        <span className="truncate text-sm font-medium">{image.name || fallbackName}</span>
                    )}
                </button>
                <div className="flex shrink-0 items-center gap-1">
                    <Tip content={t('common.rename')}>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStartRename}>
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                    </Tip>
                    <Tip content={enabled ? t('characterDialog.clickToDisable') : t('characterDialog.clickToEnable')}>
                        <div className="flex items-center gap-1">
                            {enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            <Switch checked={enabled} disabled={enableBlocked} onChange={event => onUpdate({ enabled: event.target.checked })} />
                        </div>
                    </Tip>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onRemove}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {!collapsed && (
                <div className="space-y-3 p-3">
                    <div className="relative flex aspect-[384/264] w-full items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                        {image.thumbnail || image.base64 ? (
                            <img
                                src={image.thumbnail || image.base64}
                                alt=""
                                draggable={false}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                <Database className="h-7 w-7 opacity-60" />
                                <span className="whitespace-pre-line text-center text-[10px]">{t('characterDialog.encodedDataOnly')}</span>
                            </div>
                        )}
                        {(image.cacheKey || image.encodedVibe || image.encodedVibePath) && (
                            <div className="absolute bottom-2 left-2 rounded bg-green-500/90 px-1.5 py-1 text-white"><Zap className="h-3 w-3" /></div>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">{t('characterDialog.referenceType')}</Label>
                        {isVibe ? (
                            <div className="flex h-8 items-center rounded-md border bg-muted/30 px-3 text-xs">{t('characterDialog.tabVibe')}</div>
                        ) : (
                            <Select value={image.referenceType || 'character&style'} onValueChange={value => onUpdate({ referenceType: value as PreciseReferenceType })}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="character&style">{t('characterDialog.typeCharacterStyle')}</SelectItem>
                                    <SelectItem value="character">{t('characterDialog.typeCharacter')}</SelectItem>
                                    <SelectItem value="style">{t('characterDialog.typeStyle')}</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    {isVibe ? (
                        <>
                            <SafeSlider label={t('characterDialog.vibeInfoExtracted')} value={image.informationExtracted} onValueCommit={value => onUpdate({ informationExtracted: value })} />
                            <SafeSlider label={t('characterDialog.vibeStrength')} value={image.strength} onValueCommit={value => onUpdate({ strength: value })} />
                        </>
                    ) : (
                        <>
                            <SafeSlider label={t('characterDialog.strength')} value={image.strength} onValueCommit={value => onUpdate({ strength: value })} />
                            <SafeSlider label={t('characterDialog.fidelity')} value={image.fidelity ?? 0.6} onValueCommit={value => onUpdate({ fidelity: value })} />
                        </>
                    )}
                </div>
            )}
        </section>
    )
}

function FolderSection({
    folder,
    images,
    collapsed,
    editing,
    editingName,
    onEditingNameChange,
    onToggle,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onRemove,
    renderImage,
}: {
    folder: ReferenceFolder
    images: ReferenceImage[]
    collapsed: boolean
    editing: boolean
    editingName: string
    onEditingNameChange: (name: string) => void
    onToggle: () => void
    onStartRename: () => void
    onCommitRename: () => void
    onCancelRename: () => void
    onRemove: () => void
    renderImage: (image: ReferenceImage) => React.ReactNode
}) {
    const { t } = useTranslation()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
        id: `folder:${folder.id}`,
        data: { type: 'folder', folderId: folder.id },
    })

    return (
        <section
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={cn('overflow-hidden rounded-lg border border-border/70 bg-background/20', isOver && 'border-primary bg-primary/5', isDragging && 'opacity-35')}
        >
            <div className="flex h-10 items-center gap-1.5 border-b border-border/50 px-1.5">
                <button type="button" className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing" {...attributes} {...listeners}>
                    <GripVertical className="h-4 w-4" />
                </button>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={onToggle}>
                    {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    <Folder className="h-4 w-4 shrink-0 text-amber-400" />
                    {editing ? (
                        <Input
                            value={editingName}
                            className="h-7 min-w-0 text-sm"
                            autoFocus
                            onClick={event => event.stopPropagation()}
                            onChange={event => onEditingNameChange(event.target.value)}
                            onBlur={onCommitRename}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                                if (event.key === 'Escape') onCancelRename()
                            }}
                        />
                    ) : <span className="truncate text-sm font-medium">{folder.name}</span>}
                    <span className="shrink-0 text-xs text-muted-foreground">{images.length}</span>
                </button>
                <Tip content={t('common.rename')}>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onStartRename}><Pencil className="h-3.5 w-3.5" /></Button>
                </Tip>
                <Tip content={t('characterDialog.deleteFolder')}>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
                </Tip>
            </div>
            {!collapsed && (
                <div className="min-h-12 space-y-2 p-2">
                    <SortableContext items={images.map(image => `image:${image.id}`)} strategy={verticalListSortingStrategy}>
                        {images.map(renderImage)}
                    </SortableContext>
                    {images.length === 0 && <div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">{t('characterDialog.dropIntoFolder')}</div>}
                </div>
            )}
        </section>
    )
}

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
})

export function CharacterSettingsDialog({ open, onOpenChange }: CharacterSettingsDialogProps) {
    const { t } = useTranslation()
    const characterImages = useCharacterStore(state => state.characterImages)
    const vibeImages = useCharacterStore(state => state.vibeImages)
    const folders = useCharacterStore(state => state.referenceFolders)
    const addCharacterImage = useCharacterStore(state => state.addCharacterImage)
    const removeCharacterImage = useCharacterStore(state => state.removeCharacterImage)
    const updateCharacterImage = useCharacterStore(state => state.updateCharacterImage)
    const addVibeImage = useCharacterStore(state => state.addVibeImage)
    const removeVibeImage = useCharacterStore(state => state.removeVibeImage)
    const updateVibeImage = useCharacterStore(state => state.updateVibeImage)
    const addFolder = useCharacterStore(state => state.addReferenceFolder)
    const renameFolder = useCharacterStore(state => state.renameReferenceFolder)
    const removeFolder = useCharacterStore(state => state.removeReferenceFolder)
    const reorderFolders = useCharacterStore(state => state.reorderReferenceFolders)
    const moveImage = useCharacterStore(state => state.moveReferenceImage)
    const disableAll = useCharacterStore(state => state.disableAllReferenceImages)
    const ensureHighQualityThumbnails = useCharacterStore(state => state.ensureHighQualityThumbnails)
    const inputRef = useRef<HTMLInputElement>(null)
    const [activeTab, setActiveTab] = useState<ReferenceMode>('character')
    const [dragOverFiles, setDragOverFiles] = useState(false)
    const [activeDragName, setActiveDragName] = useState<string | null>(null)
    const [collapsedImageIds, setCollapsedImageIds] = useState<Set<string>>(() => new Set())
    const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set())
    const [editingImageId, setEditingImageId] = useState<string | null>(null)
    const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState('')
    const [search, setSearch] = useState('')
    const [creatingFolder, setCreatingFolder] = useState(false)
    const [newFolderName, setNewFolderName] = useState('')
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
    const { setNodeRef: setRootDropRef, isOver: rootIsOver } = useDroppable({ id: `root:${activeTab}`, data: { type: 'root' } })

    useEffect(() => {
        if (!open) return

        const current = useCharacterStore.getState()
        setCollapsedImageIds(new Set([
            ...current.characterImages.map(image => image.id),
            ...current.vibeImages.map(image => image.id),
        ]))
        void ensureHighQualityThumbnails()
    }, [open, ensureHighQualityThumbnails])

    const addFiles = useCallback(async (files: FileList | File[], mode: ReferenceMode) => {
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            const base64 = await fileToBase64(file)
            const name = file.name.replace(/\.[^.]+$/, '')
            if (mode === 'character') {
                await addCharacterImage(base64, name)
                continue
            }
            try {
                const metadata = await parseMetadataFromBase64(base64)
                const encoded = metadata?.encodedVibes?.[0]
                const info = metadata?.vibeTransferInfo?.[0]
                await addVibeImage(base64, encoded, info?.informationExtracted, info?.strength, name)
            } catch {
                await addVibeImage(base64, undefined, undefined, undefined, name)
            }
        }
    }, [addCharacterImage, addVibeImage])

    const handleInput = async (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) await addFiles(event.target.files, activeTab)
        event.target.value = ''
    }

    const handleFileDrop = async (event: DragEvent<HTMLDivElement>) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
        setDragOverFiles(false)
        await addFiles(event.dataTransfer.files, activeTab)
    }

    const toggleSetItem = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
        setter(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const allImages = activeTab === 'character' ? characterImages : vibeImages
    const modeFolders = useMemo(() => folders.filter(folder => folder.mode === activeTab), [activeTab, folders])
    const enabledCharacterCount = useMemo(() => characterImages.filter(image => image.enabled !== false).length, [characterImages])
    const enabledVibeCount = useMemo(() => vibeImages.filter(image => image.enabled !== false).length, [vibeImages])
    const enabledImages = useMemo(() => allImages.filter(image => image.enabled !== false), [allImages])
    const folderById = useMemo(() => new Map(modeFolders.map(folder => [folder.id, folder])), [modeFolders])
    const normalizedSearch = search.trim().toLocaleLowerCase()

    const visibleImages = useMemo(() => allImages.filter(image => {
        if (!normalizedSearch) return true
        const folderName = image.folderId ? folderById.get(image.folderId)?.name || '' : ''
        return (image.name || '').toLocaleLowerCase().includes(normalizedSearch) || folderName.toLocaleLowerCase().includes(normalizedSearch)
    }), [allImages, folderById, normalizedSearch])

    const visibleFolders = useMemo(() => modeFolders.filter(folder => {
        if (!normalizedSearch) return true
        if (folder.name.toLocaleLowerCase().includes(normalizedSearch)) return true
        return visibleImages.some(image => image.folderId === folder.id)
    }), [modeFolders, normalizedSearch, visibleImages])

    const unfiledImages = visibleImages.filter(image => !image.folderId || !folderById.has(image.folderId))

    const focusImage = (image: ReferenceImage) => {
        if (image.folderId) {
            setCollapsedFolderIds(current => {
                const next = new Set(current)
                next.delete(image.folderId!)
                return next
            })
        }
        setCollapsedImageIds(current => {
            const next = new Set(current)
            next.delete(image.id)
            return next
        })
        requestAnimationFrame(() => document.getElementById(`reference-image-${image.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    }

    const commitFolderCreation = () => {
        const name = newFolderName.trim()
        if (name) addFolder(activeTab, name)
        setNewFolderName('')
        setCreatingFolder(false)
    }

    const handleDragStart = (event: DragStartEvent) => {
        const data = event.active.data.current
        if (data?.type === 'image') {
            const image = allImages.find(item => item.id === data.imageId)
            setActiveDragName(image?.name || t('characterDialog.unnamedImage'))
        } else if (data?.type === 'folder') {
            setActiveDragName(modeFolders.find(folder => folder.id === data.folderId)?.name || null)
        }
    }

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragName(null)
        const activeData = event.active.data.current
        const overData = event.over?.data.current
        if (!activeData || !overData || !event.over) return
        if (activeData.type === 'folder' && overData.type === 'folder') {
            reorderFolders(activeTab, activeData.folderId, overData.folderId)
            return
        }
        if (activeData.type !== 'image') return
        if (overData.type === 'image') {
            const overImage = allImages.find(image => image.id === overData.imageId)
            if (overImage) moveImage(activeTab, activeData.imageId, overImage.folderId, overImage.id)
        } else if (overData.type === 'folder') {
            moveImage(activeTab, activeData.imageId, overData.folderId)
            setCollapsedFolderIds(current => {
                const next = new Set(current)
                next.delete(overData.folderId)
                return next
            })
        } else if (overData.type === 'root') {
            moveImage(activeTab, activeData.imageId, undefined)
        }
    }

    if (!open) return null

    const renderImage = (image: ReferenceImage) => {
        const isVibe = activeTab === 'vibe'
        const update = isVibe ? updateVibeImage : updateCharacterImage
        const remove = isVibe ? removeVibeImage : removeCharacterImage
        const index = allImages.findIndex(item => item.id === image.id)
        const fallbackName = `${isVibe ? t('characterDialog.tabVibe') : t('characterDialog.tabCharacter')} ${index + 1}`
        return (
            <SortableImageCard
                key={image.id}
                image={image}
                fallbackName={fallbackName}
                isVibe={isVibe}
                enabledCharacterCount={enabledCharacterCount}
                enabledVibeCount={enabledVibeCount}
                collapsed={collapsedImageIds.has(image.id)}
                editing={editingImageId === image.id}
                editingName={editingName}
                onEditingNameChange={setEditingName}
                onToggleCollapsed={() => toggleSetItem(setCollapsedImageIds, image.id)}
                onStartRename={() => { setEditingName(image.name || fallbackName); setEditingFolderId(null); setEditingImageId(image.id) }}
                onCommitRename={() => { const name = editingName.trim(); if (name) update(image.id, { name }); setEditingImageId(null) }}
                onCancelRename={() => setEditingImageId(null)}
                onUpdate={updates => update(image.id, updates)}
                onRemove={() => remove(image.id)}
            />
        )
    }

    return (
        <div
            className={cn(
                'absolute inset-0 z-20 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-muted',
                'animate-in slide-in-from-bottom-4 duration-200',
                dragOverFiles && 'ring-2 ring-inset ring-primary'
            )}
            onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOverFiles(true) } }}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverFiles(false) }}
            onDrop={handleFileDrop}
        >
            <div className="shrink-0 border-b border-border/30 bg-muted/50">
                <div className="flex h-11 items-center justify-between px-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{t('characterDialog.title')}</span>
                        <span className="text-xs text-muted-foreground">({enabledImages.length})</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive" onClick={() => onOpenChange(false)}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <Tabs value={activeTab} onValueChange={value => { setActiveTab(value as ReferenceMode); setSearch(''); setCreatingFolder(false) }}>
                    <TabsList className="grid h-9 w-full grid-cols-2 rounded-none bg-transparent px-3">
                        <TabsTrigger value="character" className="h-8 text-xs">{t('characterDialog.tabCharacter')} ({enabledCharacterCount})</TabsTrigger>
                        <TabsTrigger value="vibe" className="h-8 text-xs">{t('characterDialog.tabVibe')} ({enabledVibeCount})</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {enabledImages.length > 0 && (
                <div className="shrink-0 space-y-1.5 border-b border-border/30 bg-background/25 px-3 py-2">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 font-medium"><Eye className="h-3.5 w-3.5 text-primary" /><span>{t('characterDialog.activeImages')}</span></div>
                        <span>{enabledImages.length}</span>
                    </div>
                    <div className="flex max-h-[72px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                        {enabledImages.map((image, index) => (
                            <button
                                key={image.id}
                                type="button"
                                className="flex min-w-0 basis-[120px] flex-1 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/70"
                                onClick={() => focusImage(image)}
                            >
                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                                <span className="min-w-0 flex-1 truncate text-xs font-medium">{image.name || `${t('characterDialog.unnamedImage')} ${index + 1}`}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="shrink-0 space-y-2 border-b border-border/30 px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={event => setSearch(event.target.value)} className="h-8 pl-8 text-xs" placeholder={t('characterDialog.searchPlaceholder')} />
                    </div>
                    <Tip content={t('characterDialog.createFolder')}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCreatingFolder(true)}><FolderPlus className="h-4 w-4" /></Button>
                    </Tip>
                    <Tip content={t('characterDialog.disableAll')}>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" disabled={enabledImages.length === 0} onClick={() => disableAll(activeTab)}><Power className="h-4 w-4" /></Button>
                    </Tip>
                </div>
                {creatingFolder && (
                    <div className="flex items-center gap-1.5">
                        <Input value={newFolderName} onChange={event => setNewFolderName(event.target.value)} className="h-8 text-xs" autoFocus placeholder={t('characterDialog.folderName')} onKeyDown={event => { if (event.key === 'Enter') commitFolderCreation(); if (event.key === 'Escape') setCreatingFolder(false) }} />
                        <Button size="icon" className="h-8 w-8" disabled={!newFolderName.trim()} onClick={commitFolderCreation}><Check className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setCreatingFolder(false); setNewFolderName('') }}><X className="h-4 w-4" /></Button>
                    </div>
                )}
            </div>

            <div className="relative min-h-0 flex-1 overflow-y-auto p-3 [contain:layout_paint]">
                <button
                    type="button"
                    className={cn('mb-3 flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-xs transition-colors', dragOverFiles ? 'border-primary bg-primary/10 text-primary' : 'border-muted-foreground/30 text-muted-foreground hover:bg-muted/50')}
                    onClick={() => inputRef.current?.click()}
                >
                    <Upload className="h-4 w-4" />
                    {dragOverFiles ? t('characterDialog.dropHere') : activeTab === 'character' ? t('characterDialog.uploadCharacter') : t('characterDialog.uploadVibe')}
                </button>
                <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleInput} />

                <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragCancel={() => setActiveDragName(null)} onDragEnd={handleDragEnd}>
                    <div ref={setRootDropRef} className={cn('space-y-3 rounded-md transition-colors', rootIsOver && 'bg-primary/5')}>
                        {unfiledImages.length > 0 && (
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground"><ImageIcon className="h-3.5 w-3.5" />{t('characterDialog.unfiled')}</div>
                                <SortableContext items={unfiledImages.map(image => `image:${image.id}`)} strategy={verticalListSortingStrategy}>
                                    {unfiledImages.map(renderImage)}
                                </SortableContext>
                            </div>
                        )}

                        <SortableContext items={visibleFolders.map(folder => `folder:${folder.id}`)} strategy={verticalListSortingStrategy}>
                            {visibleFolders.map(folder => {
                                const folderImages = visibleImages.filter(image => image.folderId === folder.id)
                                return (
                                    <FolderSection
                                        key={folder.id}
                                        folder={folder}
                                        images={folderImages}
                                        collapsed={collapsedFolderIds.has(folder.id)}
                                        editing={editingFolderId === folder.id}
                                        editingName={editingName}
                                        onEditingNameChange={setEditingName}
                                        onToggle={() => toggleSetItem(setCollapsedFolderIds, folder.id)}
                                        onStartRename={() => { setEditingName(folder.name); setEditingImageId(null); setEditingFolderId(folder.id) }}
                                        onCommitRename={() => { const name = editingName.trim(); if (name) renameFolder(folder.id, name); setEditingFolderId(null) }}
                                        onCancelRename={() => setEditingFolderId(null)}
                                        onRemove={() => removeFolder(folder.id)}
                                        renderImage={renderImage}
                                    />
                                )
                            })}
                        </SortableContext>

                        {allImages.length === 0 && modeFolders.length === 0 && (
                            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{t('characterDialog.noImages')}</div>
                        )}
                        {normalizedSearch && visibleImages.length === 0 && visibleFolders.length === 0 && (
                            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">{t('characterDialog.noSearchResults')}</div>
                        )}
                    </div>
                    <DragOverlay modifiers={[snapCenterToCursor]}>{activeDragName ? <div className="max-w-[240px] truncate rounded-md border bg-background/95 px-3 py-2 text-sm font-medium shadow-xl">{activeDragName}</div> : null}</DragOverlay>
                </DndContext>
            </div>

            {dragOverFiles && (
                <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
                    <div className="rounded-lg border border-primary bg-background/90 px-5 py-3 text-sm font-medium text-primary shadow-lg">{t('characterDialog.dropHere')}</div>
                </div>
            )}
        </div>
    )
}
