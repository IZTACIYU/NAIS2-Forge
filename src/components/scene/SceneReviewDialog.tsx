import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { ArrowLeft, ChevronDown, ChevronUp, ImagePlus, Play, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CharacterPromptPanel } from '@/components/character/CharacterPromptPanel'
import { CharacterSettingsDialog } from '@/components/character/CharacterSettingsDialog'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
import { SceneImageContextMenu } from '@/components/scene/SceneImageContextMenu'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'
import {
    addUniqueReviewHistoryImage,
    isTrackedReviewGeneration,
    SCENE_IMAGE_GENERATED_EVENT,
    type SceneImageGeneratedDetail,
} from '@/lib/scene-review-generation'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useGenerationStore } from '@/stores/generation-store'
import { usePresetStore } from '@/stores/preset-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import type { SceneCard, SceneImage } from '@/stores/scene-store'

interface SceneReviewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    scenes: SceneCard[]
}

type ReviewTab = 'all' | 'individual' | 'pending' | 'completed'

interface ReviewImage extends SceneImage {
    sceneId: string
    sceneName: string
}

const imageSrc = (url: string) => url.startsWith('data:') ? url : convertFileSrc(url)

function ReviewImageGrid({ images, onSelect }: { images: ReviewImage[]; onSelect: (image: ReviewImage) => void }) {
    const { t } = useTranslation()

    if (images.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noGeneratedImages')}</div>
    }

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pr-1">
            {images.map(image => (
                <button
                    key={`${image.sceneId}:${image.id}`}
                    type="button"
                    className="aspect-square overflow-hidden rounded-lg border border-border/60 bg-black/30 transition-colors hover:border-primary/60"
                    onClick={() => onSelect(image)}
                >
                    <img src={imageSrc(image.url)} alt={image.sceneName} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                </button>
            ))}
        </div>
    )
}

function ReviewPromptField({ label, placeholder, value, collapsed, onCollapsedChange, onChange, negative = false }: {
    label: string
    placeholder: string
    value: string
    collapsed: boolean
    onCollapsedChange: (collapsed: boolean) => void
    onChange: (value: string) => void
    negative?: boolean
}) {
    const promptFontSize = useSettingsStore(state => state.promptFontSize)

    return (
        <div className={cn('flex min-h-0 flex-col overflow-hidden', collapsed ? 'h-7 shrink-0' : 'flex-1')}>
            <button
                type="button"
                onClick={() => onCollapsedChange(!collapsed)}
                className={cn('mb-1 flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground', negative && 'text-destructive/80 hover:text-destructive')}
            >
                {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                {label}
                {collapsed && value && <span className="truncate font-normal text-muted-foreground">- {value.split(',')[0]}...</span>}
            </button>
            {!collapsed && (
                <AutocompleteTextarea
                    value={value}
                    placeholder={placeholder}
                    onChange={event => onChange(event.target.value)}
                    className={cn('min-h-0 flex-1 resize-none rounded-lg', negative && 'border-destructive/20')}
                    style={{ fontSize: `${promptFontSize}px` }}
                />
            )}
        </div>
    )
}

function ReviewPromptStack({ onGenerate }: { onGenerate: () => void }) {
    const { t } = useTranslation()
    const [characterPanelOpen, setCharacterPanelOpen] = useState(false)
    const [referenceDialogOpen, setReferenceDialogOpen] = useState(false)
    const [presetDialogOpen, setPresetDialogOpen] = useState(false)
    const basePrompt = useGenerationStore(state => state.basePrompt)
    const additionalPrompt = useGenerationStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationStore(state => state.detailPrompt)
    const negativePrompt = useGenerationStore(state => state.negativePrompt)
    const setBasePrompt = useGenerationStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationStore(state => state.setNegativePrompt)
    const activePresetName = usePresetStore(state => state.presets.find(preset => preset.id === state.activePresetId)?.name)
    const characterCount = useCharacterPromptStore(state => state.characters.filter(character => character.enabled).length)
    const referenceCount = useCharacterStore(state =>
        state.characterImages.filter(image => image.enabled !== false).length
        + state.vibeImages.filter(image => image.enabled !== false).length
    )
    const isGenerating = useSceneStore(state => state.isGenerating)
    const isCancelling = useSceneStore(state => state.isCancelling)
    const basePromptCollapsed = useSettingsStore(state => state.basePromptCollapsed)
    const additionalPromptCollapsed = useSettingsStore(state => state.additionalPromptCollapsed)
    const detailPromptCollapsed = useSettingsStore(state => state.detailPromptCollapsed)
    const negativePromptCollapsed = useSettingsStore(state => state.negativePromptCollapsed)
    const setBasePromptCollapsed = useSettingsStore(state => state.setBasePromptCollapsed)
    const setAdditionalPromptCollapsed = useSettingsStore(state => state.setAdditionalPromptCollapsed)
    const setDetailPromptCollapsed = useSettingsStore(state => state.setDetailPromptCollapsed)
    const setNegativePromptCollapsed = useSettingsStore(state => state.setNegativePromptCollapsed)

    return (
        <aside className="flex min-h-0 flex-col gap-2 rounded-xl border border-border/50 bg-card/40 p-3">
            <div className="flex h-8 shrink-0 items-center gap-2">
                <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                <span className="truncate text-sm font-medium">{activePresetName || t('preset.default')}</span>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col gap-2">
                <CharacterPromptPanel open={characterPanelOpen} onOpenChange={setCharacterPanelOpen} />
                <ReviewPromptField label={t('prompt.base')} placeholder={t('prompt.basePlaceholder')} value={basePrompt} collapsed={basePromptCollapsed} onCollapsedChange={setBasePromptCollapsed} onChange={setBasePrompt} />
                <ReviewPromptField label={t('prompt.additional')} placeholder={t('prompt.additionalPlaceholder')} value={additionalPrompt} collapsed={additionalPromptCollapsed} onCollapsedChange={setAdditionalPromptCollapsed} onChange={setAdditionalPrompt} />
                <ReviewPromptField label={t('prompt.detail')} placeholder={t('prompt.detailPlaceholder')} value={detailPrompt} collapsed={detailPromptCollapsed} onCollapsedChange={setDetailPromptCollapsed} onChange={setDetailPrompt} />
                <ReviewPromptField label={t('prompt.negative')} placeholder={t('prompt.negativePlaceholder')} value={negativePrompt} collapsed={negativePromptCollapsed} onCollapsedChange={setNegativePromptCollapsed} onChange={setNegativePrompt} negative />
            </div>
            <div className="flex shrink-0 gap-2">
                <Button
                    type="button"
                    variant={referenceDialogOpen ? 'default' : 'outline'}
                    size="sm"
                    className="relative min-w-0 flex-1 rounded-lg px-2 text-xs"
                    onClick={() => {
                        setCharacterPanelOpen(false)
                        setReferenceDialogOpen(open => !open)
                    }}
                >
                    <ImagePlus className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t('prompt.imageReference')}</span>
                    {referenceCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-md bg-red-500 px-1 text-[9px] font-bold text-white">{referenceCount}</span>}
                </Button>
                <Button
                    type="button"
                    variant={characterPanelOpen ? 'default' : 'outline'}
                    size="sm"
                    className="relative min-w-0 flex-1 rounded-lg px-2 text-xs"
                    onClick={() => {
                        setReferenceDialogOpen(false)
                        setCharacterPanelOpen(open => !open)
                    }}
                >
                    <Users className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t('prompt.character')}</span>
                    {characterCount > 0 && <span className="absolute -right-1 -top-1 min-w-4 rounded-md bg-primary px-1 text-[9px] font-bold text-primary-foreground">{characterCount}</span>}
                </Button>
            </div>
            <Button
                type="button"
                variant={isGenerating || isCancelling ? 'destructive' : 'generate'}
                className="h-10 shrink-0 rounded-lg"
                onClick={onGenerate}
                disabled={isCancelling}
            >
                {isGenerating || isCancelling
                    ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    : <Play className="mr-2 h-4 w-4" />
                }
                {isGenerating ? t('common.cancel') : isCancelling ? t('common.cancelling') : t('generate.button')}
            </Button>
            <CharacterSettingsDialog open={referenceDialogOpen} onOpenChange={setReferenceDialogOpen} />
        </aside>
    )
}

function ReviewFilmstrip({ images, selectedSceneId, onSelect }: {
    images: ReviewImage[]
    selectedSceneId?: string
    onSelect: (image: ReviewImage) => void
}) {
    const selectedIndex = Math.max(0, images.findIndex(image => image.sceneId === selectedSceneId))
    const nearbyImages = images.slice(Math.max(0, selectedIndex - 2), selectedIndex + 3)

    return (
        <div className="mt-2 flex h-20 shrink-0 items-center justify-center gap-2 overflow-hidden rounded-lg border border-border/50 bg-background/35 px-2">
            {nearbyImages.map(image => (
                <button
                    key={`${image.sceneId}:${image.id}`}
                    type="button"
                    className={cn('relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-black/30', image.sceneId === selectedSceneId ? 'border-primary ring-1 ring-primary' : 'border-border/50 opacity-60 hover:opacity-100')}
                    onClick={() => onSelect(image)}
                    title={image.sceneName}
                >
                    <img src={imageSrc(image.url)} alt={image.sceneName} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                </button>
            ))}
        </div>
    )
}

function IndividualReviewView({ scene, image, reviewImages, historyImages, onSelectImage, onSelectReviewImage, onDeleteImage, onGenerate, onBack }: {
    scene?: SceneCard
    image?: SceneImage | null
    reviewImages: ReviewImage[]
    historyImages: ReviewImage[]
    onSelectImage: (imageId: string) => void
    onSelectReviewImage: (image: ReviewImage) => void
    onDeleteImage: (image: SceneImage) => void
    onGenerate: () => void
    onBack?: () => void
}) {
    const { t } = useTranslation()

    if (!scene || !image) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noGeneratedImages')}</div>
    }

    return (
        <div className="grid h-full min-h-0 grid-cols-[minmax(230px,0.85fr)_minmax(0,2fr)_minmax(190px,0.72fr)] gap-3">
            <ReviewPromptStack onGenerate={onGenerate} />

            <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border/50 bg-card/40 p-3">
                <div className="flex min-w-0 items-center gap-2">
                    {onBack && (
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} aria-label={t('scene.reviewBack')}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <h2 className="truncate text-sm font-semibold" title={scene.name}>{scene.name}</h2>
                </div>
                <textarea
                    readOnly
                    aria-label={t('scene.scenePrompt')}
                    value={scene.scenePrompt}
                    className="mt-2 h-24 shrink-0 resize-none rounded-lg border border-border/60 bg-background/50 p-2 text-xs outline-none"
                />
                <SceneImageContextMenu image={image} onDelete={() => onDeleteImage(image)}>
                    <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/30">
                        <img src={imageSrc(image.url)} alt={scene.name} className="h-full w-full object-contain" />
                    </div>
                </SceneImageContextMenu>
                <ReviewFilmstrip images={reviewImages} selectedSceneId={scene.id} onSelect={onSelectReviewImage} />
            </section>

            <aside className="flex min-h-0 flex-col rounded-xl border border-border/50 bg-card/40 p-3">
                <div className="mb-2 text-sm font-medium">{t('history.title')}</div>
                {historyImages.length === 0 ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center text-center text-xs text-muted-foreground">{t('scene.noReviewHistory')}</div>
                ) : (
                    <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-2 overflow-y-auto custom-scrollbar pr-1">
                        {historyImages.map(historyImage => (
                            <SceneImageContextMenu key={historyImage.id} image={historyImage} onDelete={() => onDeleteImage(historyImage)}>
                                <button
                                    type="button"
                                    className={cn('relative aspect-square min-h-0 overflow-hidden rounded-md border bg-black/30', historyImage.id === image.id ? 'border-primary ring-1 ring-primary' : 'border-border/50 hover:border-primary/50')}
                                    onClick={() => onSelectImage(historyImage.id)}
                                >
                                    <img src={imageSrc(historyImage.url)} alt={scene.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                                </button>
                            </SceneImageContextMenu>
                        ))}
                    </div>
                )}
            </aside>
        </div>
    )
}

export function SceneReviewDialog({ open, onOpenChange, scenes }: SceneReviewDialogProps) {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<ReviewTab>('all')
    const [allDetailOpen, setAllDetailOpen] = useState(false)
    const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
    const [temporaryHistory, setTemporaryHistory] = useState<ReviewImage[]>([])
    const reviewGenerationSceneIds = useRef(new Set<string>())
    const activePresetId = useSceneStore(state => state.activePresetId)
    const isGenerating = useSceneStore(state => state.isGenerating)
    const isCancelling = useSceneStore(state => state.isCancelling)
    const images = useMemo(() => open
        ? scenes.flatMap(scene => {
            const image = pickSceneRepresentativeImage(scene.images)
            return image ? [{ ...image, sceneId: scene.id, sceneName: scene.name }] : []
        })
        : [], [open, scenes])
    const selectedScene = scenes.find(scene => scene.id === selectedSceneId)
        || scenes.find(scene => scene.id === images[0]?.sceneId)
    const selectedHistory = temporaryHistory.filter(image => image.sceneId === selectedScene?.id)
    const selectedImage = selectedHistory.find(image => image.id === selectedImageId)
        || selectedScene?.images.find(image => image.id === selectedImageId)
        || selectedHistory[0]
        || (selectedScene ? pickSceneRepresentativeImage(selectedScene.images) : null)

    const rememberHistoryImage = useCallback((image: ReviewImage) => {
        setTemporaryHistory(history => addUniqueReviewHistoryImage(history, image, 'end'))
    }, [])

    useEffect(() => {
        if (open) return
        setActiveTab('all')
        setAllDetailOpen(false)
        setSelectedSceneId(null)
        setSelectedImageId(null)
        setTemporaryHistory([])
        reviewGenerationSceneIds.current.clear()
    }, [open])

    useEffect(() => {
        const handleGeneratedImage = (event: Event) => {
            const detail = (event as CustomEvent<SceneImageGeneratedDetail>).detail || {}
            if (!open || !isTrackedReviewGeneration(detail, activePresetId, reviewGenerationSceneIds.current)) return
            const { path, sceneId } = detail
            const scene = scenes.find(candidate => candidate.id === sceneId)
            if (!scene) return

            const image: ReviewImage = {
                id: `review:${Date.now()}:${path}`,
                url: path,
                timestamp: Date.now(),
                isFavorite: false,
                sceneId,
                sceneName: scene.name,
            }
            setTemporaryHistory(history => addUniqueReviewHistoryImage(history, image, 'start'))
            setSelectedSceneId(sceneId)
            setSelectedImageId(image.id)
        }

        window.addEventListener(SCENE_IMAGE_GENERATED_EVENT, handleGeneratedImage)
        return () => window.removeEventListener(SCENE_IMAGE_GENERATED_EVENT, handleGeneratedImage)
    }, [activePresetId, open, scenes])

    useEffect(() => {
        if (!isGenerating && !isCancelling) reviewGenerationSceneIds.current.clear()
    }, [isCancelling, isGenerating])

    useEffect(() => {
        const detailVisible = activeTab === 'individual' || (activeTab === 'all' && allDetailOpen)
        if (!detailVisible || !selectedScene) return
        const initialImage = images.find(image => image.sceneId === selectedScene.id)
        if (initialImage) rememberHistoryImage(initialImage)
    }, [activeTab, allDetailOpen, images, rememberHistoryImage, selectedScene])

    const selectImage = (image: ReviewImage, stayInAll: boolean) => {
        setSelectedSceneId(image.sceneId)
        setSelectedImageId(image.id)
        if (stayInAll) setAllDetailOpen(true)
        else setActiveTab('individual')
    }

    const selectTab = (tab: ReviewTab) => {
        setActiveTab(tab)
        if (tab === 'all') setAllDetailOpen(false)
    }

    const handleGenerate = () => {
        const state = useSceneStore.getState()
        if (state.isGenerating || state.isCancelling) {
            state.cancelSceneGeneration()
            return
        }
        if (!activePresetId || !selectedScene) return

        const currentScene = state.presets.find(preset => preset.id === activePresetId)?.scenes.find(scene => scene.id === selectedScene.id)
        if (!currentScene) return
        reviewGenerationSceneIds.current.add(currentScene.id)
        if (currentScene.queueCount === 0) state.incrementQueue(activePresetId, currentScene.id)
        state.startNewGenerationSession()
    }

    const selectReviewImage = (image: ReviewImage) => {
        setSelectedSceneId(image.sceneId)
        setSelectedImageId(image.id)
        rememberHistoryImage(image)
    }

    const deleteReviewImage = (image: SceneImage) => {
        if (!activePresetId || !selectedScene) return
        const state = useSceneStore.getState()
        const storedImage = state.presets
            .find(preset => preset.id === activePresetId)?.scenes
            .find(scene => scene.id === selectedScene.id)?.images
            .find(candidate => candidate.id === image.id || candidate.url === image.url)
        if (storedImage) state.deleteImage(activePresetId, selectedScene.id, storedImage.id)
        setTemporaryHistory(history => history.filter(item => item.url !== image.url))
        if (selectedImage?.url === image.url) setSelectedImageId(null)
    }

    const individualViewProps = {
        scene: selectedScene,
        image: selectedImage,
        reviewImages: images,
        historyImages: selectedHistory,
        onSelectImage: setSelectedImageId,
        onSelectReviewImage: selectReviewImage,
        onDeleteImage: deleteReviewImage,
        onGenerate: handleGenerate,
    }
    const tabs: Array<{ id: ReviewTab; label: string }> = [
        { id: 'all', label: t('scene.reviewAll') },
        { id: 'individual', label: t('scene.reviewIndividual') },
        { id: 'pending', label: t('scene.reviewPending') },
        { id: 'completed', label: t('scene.reviewCompleted') },
    ]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!flex !h-[88vh] !w-[92vw] !max-w-[1600px] flex-col gap-2 overflow-hidden p-4">
                <DialogTitle className="sr-only">{t('scene.reviewImages')}</DialogTitle>
                <div role="tablist" className="flex h-9 shrink-0 items-end gap-1 border-b border-border/60 pr-10">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={cn('h-9 border-b-2 px-3 text-xs font-medium transition-colors', activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                            onClick={() => selectTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="min-h-0 flex-1">
                    {activeTab === 'all' && (
                        <>
                            <div className={cn('h-full overflow-y-auto custom-scrollbar', allDetailOpen && 'hidden')}>
                                <ReviewImageGrid images={images} onSelect={image => selectImage(image, true)} />
                            </div>
                            {allDetailOpen && <IndividualReviewView {...individualViewProps} onBack={() => setAllDetailOpen(false)} />}
                        </>
                    )}
                    {activeTab === 'individual' && <IndividualReviewView {...individualViewProps} />}
                    {activeTab === 'pending' && (
                        <div className="h-full overflow-y-auto custom-scrollbar">
                            <ReviewImageGrid images={images} onSelect={image => selectImage(image, false)} />
                        </div>
                    )}
                    {activeTab === 'completed' && (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noReviewedImages')}</div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
