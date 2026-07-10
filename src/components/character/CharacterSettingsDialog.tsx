import { useCallback, useRef, useState, useEffect, type ChangeEvent, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Database, Eye, EyeOff, Image as ImageIcon, Pencil, Upload, X, Zap } from 'lucide-react'
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
import { PreciseReferenceType, ReferenceImage, useCharacterStore } from '@/stores/character-store'

type ReferenceMode = 'character' | 'vibe'

interface CharacterSettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

function SafeSlider({
    value,
    onValueCommit,
    label,
}: {
    value: number
    onValueCommit: (value: number) => void
    label: string
}) {
    const [localValue, setLocalValue] = useState([value])

    useEffect(() => setLocalValue([value]), [value])

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground truncate">{label}</Label>
                <span className="shrink-0 text-xs font-mono">{localValue[0].toFixed(2)}</span>
            </div>
            <Slider
                value={localValue}
                min={0}
                max={1}
                step={0.01}
                onValueChange={setLocalValue}
                onValueCommit={([next]) => onValueCommit(next)}
            />
        </div>
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
    const addCharacterImage = useCharacterStore(state => state.addCharacterImage)
    const removeCharacterImage = useCharacterStore(state => state.removeCharacterImage)
    const updateCharacterImage = useCharacterStore(state => state.updateCharacterImage)
    const addVibeImage = useCharacterStore(state => state.addVibeImage)
    const removeVibeImage = useCharacterStore(state => state.removeVibeImage)
    const updateVibeImage = useCharacterStore(state => state.updateVibeImage)
    const ensureHighQualityThumbnails = useCharacterStore(state => state.ensureHighQualityThumbnails)
    const inputRef = useRef<HTMLInputElement>(null)
    const [activeTab, setActiveTab] = useState<ReferenceMode>('character')
    const [dragOver, setDragOver] = useState(false)
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editingName, setEditingName] = useState('')

    useEffect(() => {
        if (open) void ensureHighQualityThumbnails()
    }, [open, ensureHighQualityThumbnails])

    const addFiles = useCallback(async (files: FileList | File[], mode: ReferenceMode) => {
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue
            const base64 = await fileToBase64(file)
            if (mode === 'character') {
                await addCharacterImage(base64, file.name.replace(/\.[^.]+$/, ''))
                continue
            }
            try {
                const metadata = await parseMetadataFromBase64(base64)
                const encoded = metadata?.encodedVibes?.[0]
                const info = metadata?.vibeTransferInfo?.[0]
                await addVibeImage(base64, encoded, info?.informationExtracted, info?.strength, file.name.replace(/\.[^.]+$/, ''))
            } catch {
                await addVibeImage(base64, undefined, undefined, undefined, file.name.replace(/\.[^.]+$/, ''))
            }
        }
    }, [addCharacterImage, addVibeImage])

    const handleInput = async (event: ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) await addFiles(event.target.files, activeTab)
        event.target.value = ''
    }

    const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.stopPropagation()
        setDragOver(false)
        await addFiles(event.dataTransfer.files, activeTab)
    }

    const toggleCollapsed = (id: string) => {
        setCollapsedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const commitName = (image: ReferenceImage, update: (id: string, updates: Partial<ReferenceImage>) => void) => {
        const name = editingName.trim()
        if (name) update(image.id, { name })
        setEditingId(null)
    }

    if (!open) return null

    const enabledCharacterCount = characterImages.filter(image => image.enabled !== false).length
    const enabledVibeCount = vibeImages.filter(image => image.enabled !== false).length
    const activeCount = activeTab === 'character' ? enabledCharacterCount : enabledVibeCount
    const images = activeTab === 'character' ? characterImages : vibeImages

    return (
        <div
            className={cn(
                'absolute inset-0 z-20 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-muted/95 backdrop-blur-sm',
                'animate-in slide-in-from-bottom-4 duration-200',
                dragOver && 'ring-2 ring-inset ring-primary'
            )}
            onDragEnter={(event) => { event.preventDefault(); setDragOver(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
            }}
            onDrop={handleDrop}
        >
            <div className="shrink-0 border-b border-border/30 bg-muted/50">
                <div className="flex h-11 items-center justify-between px-3">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">{t('characterDialog.title')}</span>
                        <span className="text-xs text-muted-foreground">({activeCount})</span>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive"
                        onClick={() => onOpenChange(false)}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
                <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ReferenceMode)}>
                    <TabsList className="grid h-9 w-full grid-cols-2 rounded-none bg-transparent px-3">
                        <TabsTrigger value="character" className="h-8 text-xs">
                            {t('characterDialog.tabCharacter')} ({enabledCharacterCount})
                        </TabsTrigger>
                        <TabsTrigger value="vibe" className="h-8 text-xs">
                            {t('characterDialog.tabVibe')} ({enabledVibeCount})
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="relative flex-1 min-h-0 overflow-y-auto p-3">
                <button
                    type="button"
                    className={cn(
                        'mb-3 flex h-16 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-xs transition-colors',
                        dragOver ? 'border-primary bg-primary/10 text-primary' : 'border-muted-foreground/30 text-muted-foreground hover:bg-muted/50'
                    )}
                    onClick={() => inputRef.current?.click()}
                >
                    <Upload className="h-4 w-4" />
                    {dragOver
                        ? t('characterDialog.dropHere')
                        : activeTab === 'character'
                            ? t('characterDialog.uploadCharacter')
                            : t('characterDialog.uploadVibe')}
                </button>
                <input ref={inputRef} type="file" multiple accept="image/*" className="hidden" onChange={handleInput} />

                {images.length === 0 && (
                    <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                        {t('characterDialog.noImages')}
                    </div>
                )}

                <div className="space-y-3">
                    {images.map((image, index) => {
                        const enabled = image.enabled !== false
                        const isVibe = activeTab === 'vibe'
                        const update = isVibe ? updateVibeImage : updateCharacterImage
                        const remove = isVibe ? removeVibeImage : removeCharacterImage
                        const enableBlocked = !enabled && (isVibe ? enabledCharacterCount > 0 : enabledVibeCount > 0)
                        const collapsed = collapsedIds.has(image.id)
                        const fallbackName = `${isVibe ? t('characterDialog.tabVibe') : t('characterDialog.tabCharacter')} ${index + 1}`
                        return (
                            <section
                                key={image.id}
                                className={cn('overflow-hidden rounded-lg border bg-card', !enabled && 'opacity-55')}
                            >
                                <div className="flex min-h-10 items-center justify-between gap-2 border-b px-2 py-1">
                                    <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => toggleCollapsed(image.id)}>
                                        {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                                        {editingId === image.id ? (
                                            <Input
                                                value={editingName}
                                                className="h-7 min-w-0 text-sm"
                                                autoFocus
                                                onClick={event => event.stopPropagation()}
                                                onChange={event => setEditingName(event.target.value)}
                                                onBlur={() => commitName(image, update)}
                                                onKeyDown={event => {
                                                    if (event.key === 'Enter') commitName(image, update)
                                                    if (event.key === 'Escape') setEditingId(null)
                                                }}
                                            />
                                        ) : (
                                            <span className="truncate text-sm font-medium">{image.name || fallbackName}</span>
                                        )}
                                    </button>
                                    <div className="flex items-center gap-2">
                                        <Tip content={t('common.rename')}>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => {
                                                    setEditingName(image.name || fallbackName)
                                                    setEditingId(image.id)
                                                }}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </Button>
                                        </Tip>
                                        <Tip content={enabled ? t('characterDialog.clickToDisable') : t('characterDialog.clickToEnable')}>
                                            <div className="flex items-center gap-1.5">
                                                {enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                                <Switch
                                                    checked={enabled}
                                                    disabled={enableBlocked}
                                                    onChange={event => update(image.id, { enabled: event.target.checked })}
                                                />
                                            </div>
                                        </Tip>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(image.id)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>

                                {!collapsed && <div className="space-y-3 p-3">
                                    <div className="relative flex aspect-[384/264] w-full items-center justify-center overflow-hidden rounded-md border bg-muted/40">
                                        {image.thumbnail || image.base64 ? (
                                            <img src={image.thumbnail || image.base64} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                                <Database className="h-7 w-7 opacity-60" />
                                                <span className="text-[10px]">{t('characterDialog.encodedDataOnly')}</span>
                                            </div>
                                        )}
                                        {(image.cacheKey || image.encodedVibe) && (
                                            <div className="absolute bottom-2 left-2 rounded bg-green-500/90 px-1.5 py-1 text-white">
                                                <Zap className="h-3 w-3" />
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">{t('characterDialog.referenceType')}</Label>
                                        {isVibe ? (
                                            <div className="flex h-8 items-center rounded-md border bg-muted/30 px-3 text-xs">
                                                {t('characterDialog.tabVibe')}
                                            </div>
                                        ) : (
                                            <Select
                                                value={image.referenceType || 'character&style'}
                                                onValueChange={value => update(image.id, { referenceType: value as PreciseReferenceType })}
                                            >
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
                                            <SafeSlider label={t('characterDialog.vibeInfoExtracted')} value={image.informationExtracted} onValueCommit={value => update(image.id, { informationExtracted: value })} />
                                            <SafeSlider label={t('characterDialog.vibeStrength')} value={image.strength} onValueCommit={value => update(image.id, { strength: value })} />
                                        </>
                                    ) : (
                                        <>
                                            <SafeSlider label={t('characterDialog.strength')} value={image.strength} onValueCommit={value => update(image.id, { strength: value })} />
                                            <SafeSlider label={t('characterDialog.fidelity')} value={image.fidelity ?? 0.6} onValueCommit={value => update(image.id, { fidelity: value })} />
                                        </>
                                    )}
                                </div>}
                            </section>
                        )
                    })}
                </div>
            </div>

            {dragOver && (
                <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
                    <div className="rounded-lg border border-primary bg-background/90 px-5 py-3 text-sm font-medium text-primary shadow-lg">
                        {t('characterDialog.dropHere')}
                    </div>
                </div>
            )}
        </div>
    )
}
