import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { ResolutionSelector, Resolution } from '@/components/ui/ResolutionSelector'
import {
    ChevronLeft,
    Check,
    Play,
    Image as ImageIcon,
    FolderOpen,
    Minus,
    Plus,
    X,
    Pencil,
    Star,
    Trash2,
    CheckSquare,
    Square,
    Shirt,
    ChevronDown,
    ChevronUp,
    UsersRound,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from "@/components/ui/AutocompleteTextarea";
import { Tip } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useNearViewport } from '@/hooks/use-near-viewport'
import { useSceneQueueCount } from '@/hooks/use-scene-queue'


const getThumbnailAspectClass = (layout: 'vertical' | 'horizontal' | 'square') => {
    if (layout === 'vertical') return 'aspect-[2/3]'
    if (layout === 'square') return 'aspect-square'
    return 'aspect-[3/2]'
}

import { useSceneStore, SceneImage } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useFragmentStore } from '@/stores/fragment-store'
import { Command } from '@tauri-apps/plugin-shell'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { pictureDir, join } from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'
import { exists, mkdir, readFile, remove } from '@tauri-apps/plugin-fs'
import { toast } from '@/components/ui/use-toast'
import { getSceneFolderFromImages, sanitizeSceneFolderName } from '@/lib/scene-path'
import { SceneMultiCharacterPanel } from '@/components/scene/SceneMultiCharacterPanel'
import { removePromptComments } from '@/lib/prompt-comments'
import {
    buildSceneCharacterPrompt,
    getSceneMultiCharacterPromptMap,
    selectSceneCharacters,
} from '@/lib/scene-character-prompts'

export default function SceneDetail() {
    const { id: sceneId } = useParams()
    const { t } = useTranslation()
    const activePresetId = useSceneStore(state => state.activePresetId)

    // Use reactive selector for scene - this ensures component re-renders when scene.images changes
    const scene = useSceneStore(state => {
        const preset = state.presets.find(p => p.id === state.activePresetId)
        return preset?.scenes.find(s => s.id === sceneId)
    })
    const sceneCharacterAddition = useSceneStore(state => {
        if (!state.activePresetId || !sceneId) return null
        return state.sceneCharacterAdditions[state.activePresetId]?.[sceneId] || null
    })
    const sceneCharacterAdditionsEnabled = useSceneStore(state => state.sceneCharacterAdditionsEnabled)

    const {
        renameScene,
        toggleFavorite,
        deleteImage,
        deleteNonFavoriteImages,
        incrementQueue,
        decrementQueue,
        validateSceneImages,
        updateSceneSettings,
        updateSceneCharacterAddition,
        updateSceneMultiCharacterSlots,
        updateSceneNegativePrompt,
    } = useSceneStore(useShallow(state => ({
        renameScene: state.renameScene,
        toggleFavorite: state.toggleFavorite,
        deleteImage: state.deleteImage,
        deleteNonFavoriteImages: state.deleteNonFavoriteImages,
        incrementQueue: state.incrementQueue,
        decrementQueue: state.decrementQueue,
        validateSceneImages: state.validateSceneImages,
        updateSceneSettings: state.updateSceneSettings,
        updateSceneCharacterAddition: state.updateSceneCharacterAddition,
        updateSceneMultiCharacterSlots: state.updateSceneMultiCharacterSlots,
        updateSceneNegativePrompt: state.updateSceneNegativePrompt,
    })))
    const sceneQueueCount = useSceneQueueCount(activePresetId, sceneId || '')
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const expertCharacterPromptLayoutEnabled = useSettingsStore(state => state.expertCharacterPromptLayoutEnabled)
    const expertCharacterPromptVariantsEnabled = useSettingsStore(state => state.expertCharacterPromptVariantsEnabled)
    const expertSceneCharacterVariantOverrideEnabled = useSettingsStore(state => state.expertSceneCharacterVariantOverrideEnabled)
    const expertSceneCharacterCostumeOverrideEnabled = useSettingsStore(state => state.expertSceneCharacterCostumeOverrideEnabled)
    const expertSceneMultiCharacterEnabled = useSettingsStore(state => state.expertSceneMultiCharacterEnabled)
    const expertSceneCharacterAdditionsEnabled = useSettingsStore(state => state.expertSceneCharacterAdditionsEnabled)
    const sceneVariantOverrideEnabled = expertSceneCharacterVariantOverrideEnabled && expertCharacterPromptVariantsEnabled
    const sceneCostumeOverrideEnabled = expertSceneCharacterCostumeOverrideEnabled && expertCharacterPromptLayoutEnabled
    const hasCostumeOverride = sceneCharacterAddition?.characterCostumeEnabled === false
    const characters = useCharacterPromptStore(state => state.characters)
    const fragmentRevision = useFragmentStore(state => state.files.map(file => `${file.id}:${file.updatedAt}`).join('|'))
    const {
        basePrompt,
        additionalPrompt,
        detailPrompt,
        negativePrompt,
        inpaintingPrompt,
        i2iMode,
    } = useGenerationStore(useShallow(state => ({
        basePrompt: state.basePrompt,
        additionalPrompt: state.additionalPrompt,
        detailPrompt: state.detailPrompt,
        negativePrompt: state.negativePrompt,
        inpaintingPrompt: state.inpaintingPrompt,
        i2iMode: state.i2iMode,
    })))

    const updateScenePromptOverride = (updates: { characterVariantIndex?: number; characterCostumeEnabled?: boolean }) => {
        if (!activePresetId || !sceneId) return
        updateSceneCharacterAddition(activePresetId, sceneId, {
            characterPromptIds: sceneCharacterAddition?.characterPromptIds || [],
            characterReferenceIds: sceneCharacterAddition?.characterReferenceIds || [],
            vibeReferenceIds: sceneCharacterAddition?.vibeReferenceIds || [],
            ...sceneCharacterAddition,
            ...updates,
        })
    }

    // --- Resolution Logic ---
    const currentWidth = scene?.width || 832
    const currentHeight = scene?.height || 1216

    // Handler for ResolutionSelector
    const handleResolutionChange = (resolution: Resolution) => {
        if (activePresetId && sceneId) {
            updateSceneSettings(activePresetId, sceneId, { width: resolution.width, height: resolution.height })
        }
    }

    // Current resolution value for ResolutionSelector
    const currentResolution: Resolution = {
        label: `${currentWidth} × ${currentHeight}`,
        width: currentWidth,
        height: currentHeight
    }

    const [editName, setEditName] = useState(scene?.name || '')
    // Dialog states
    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [selectedImageForMetadata, setSelectedImageForMetadata] = useState<string | undefined>()
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [selectedImageForRef, setSelectedImageForRef] = useState<string | null>(null)
    const [inpaintDialogOpen, setInpaintDialogOpen] = useState(false)
    const [selectedImageForInpaint, setSelectedImageForInpaint] = useState<string | null>(null)
    const [isEditingName, setIsEditingName] = useState(false)
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)
    const [viewerImageSrc, setViewerImageSrc] = useState<string | null>(null)
    const [viewerImage, setViewerImage] = useState<SceneImage | null>(null)  // Current image object for context menu
    const streamingSceneId = useSceneStore(s => s.streamingSceneId)
    const streamingImage = useSceneStore(s => s.streamingSceneId === sceneId ? s.streamingImage : null)
    const streamingProgress = useSceneStore(s => s.streamingSceneId === sceneId ? s.streamingProgress : 0)
    const thumbnailLayout = useSceneStore(s => s.thumbnailLayout)

    // Edit mode state
    const [isEditMode, setIsEditMode] = useState(false)
    const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set())

    // Auto-save prompt logic - hooks must be before conditional return
    const updateScenePrompt = useSceneStore(state => state.updateScenePrompt)
    const [localPrompt, setLocalPrompt] = useState(scene?.scenePrompt || '')
    const localPromptRef = useRef(localPrompt)
    localPromptRef.current = localPrompt
    const [localNegativePrompt, setLocalNegativePrompt] = useState(scene?.sceneNegativePrompt || '')
    const localNegativePromptRef = useRef(localNegativePrompt)
    localNegativePromptRef.current = localNegativePrompt
    const [scenePromptMode, setScenePromptMode] = useState<'positive' | 'negative'>('positive')
    const [sceneEditorCollapsed, setSceneEditorCollapsed] = useState(false)
    const [multiCharacterPanelOpen, setMultiCharacterPanelOpen] = useState(false)
    const [sceneTokenTotals, setSceneTokenTotals] = useState({ positive: 0, negative: 0 })

    const nav = useNavigate()

    // ESC key handler for closing viewer or navigating back
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (viewerImageSrc) {
                    setViewerImageSrc(null)
                } else {
                    // Navigate back to scene list
                    nav('/scenes')
                }
            }
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [viewerImageSrc, nav])

    // Memory cleanup on unmount - release streaming data when leaving scene detail
    // This prevents OOM when switching between modes (Issue #6)
    useEffect(() => {
        return () => {
            console.log('[SceneDetail] Unmounting - clearing streaming data')
            useSceneStore.getState().clearRuntimeData()
        }
    }, [])

    useEffect(() => {
        if (scene) {
            setEditName(scene.name)
        }
    }, [scene?.name])

    // Sync local prompt when scene ID changes
    useEffect(() => {
        if (scene) {
            setLocalPrompt(scene.scenePrompt)
            setLocalNegativePrompt(scene.sceneNegativePrompt || '')
        }
    }, [scene?.id])

    // Debounced save of prompt to store.
    useEffect(() => {
        if (!scene || !activePresetId) return
        if (localPrompt === scene.scenePrompt) return

        const timer = setTimeout(() => {
            updateScenePrompt(activePresetId, scene.id, localPrompt)
        }, 1000)

        return () => clearTimeout(timer)
    }, [localPrompt, scene?.id, scene?.scenePrompt, activePresetId, updateScenePrompt])

    useEffect(() => {
        if (!scene || !activePresetId) return
        if (localNegativePrompt === (scene.sceneNegativePrompt || '')) return

        const timer = setTimeout(() => {
            updateSceneNegativePrompt(activePresetId, scene.id, localNegativePrompt)
        }, 1000)

        return () => clearTimeout(timer)
    }, [localNegativePrompt, scene?.id, scene?.sceneNegativePrompt, activePresetId, updateSceneNegativePrompt])

    useEffect(() => {
        if (!scene) return

        const sceneAddition = expertSceneCharacterAdditionsEnabled && sceneCharacterAdditionsEnabled
            ? sceneCharacterAddition
            : null
        const requestedVariantIndex = sceneVariantOverrideEnabled
            ? sceneCharacterAddition?.characterVariantIndex
            : undefined
        const costumeOverride = sceneCostumeOverrideEnabled
            ? sceneCharacterAddition?.characterCostumeEnabled
            : undefined
        const characterIds = Array.from(new Set([
            ...characters.filter(character => character.enabled).map(character => character.id),
            ...(sceneAddition?.characterPromptIds || []),
        ]))
        const selectedCharacters = selectSceneCharacters(characters, characterIds, requestedVariantIndex)
        const multiCharacterPrompts = getSceneMultiCharacterPromptMap(
            expertSceneMultiCharacterEnabled ? scene.multiCharacterSlots : undefined,
            selectedCharacters,
            characters,
        )
        const characterPositivePrompts = selectedCharacters.map(character => [
            expertCharacterPromptLayoutEnabled
                ? buildSceneCharacterPrompt(character, costumeOverride)
                : character.prompt,
            ...(multiCharacterPrompts.get(character.id) || []),
        ].filter(Boolean).join('\n'))
        const characterNegativePrompts = selectedCharacters.map(character => (
            expertCharacterPromptLayoutEnabled && character.negativeEnabled === false ? '' : character.negative
        ))
        const positive = [
            basePrompt,
            i2iMode === 'inpaint' ? inpaintingPrompt : '',
            additionalPrompt,
            localPrompt,
            detailPrompt,
            ...characterPositivePrompts,
        ].map(removePromptComments).filter(prompt => prompt.trim()).join(', ')
        const negative = [
            negativePrompt,
            localNegativePrompt,
            ...characterNegativePrompts,
        ].map(removePromptComments).filter(prompt => prompt.trim()).join(', ')

        if (!positive && !negative) {
            setSceneTokenTotals({ positive: 0, negative: 0 })
            return
        }

        let cancelled = false
        const timer = window.setTimeout(() => {
            void Promise.all([
                import('@/lib/token-counter'),
                import('@/lib/fragment-processor'),
            ]).then(async ([{ countTokens }, { resolveFragmentsForTokenCount }]) => {
                const [resolvedPositive, resolvedNegative] = await Promise.all([
                    resolveFragmentsForTokenCount(positive),
                    resolveFragmentsForTokenCount(negative),
                ])
                if (!cancelled) {
                    setSceneTokenTotals({
                        positive: countTokens(resolvedPositive),
                        negative: countTokens(resolvedNegative),
                    })
                }
            })
        }, 250)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [
        scene?.id,
        scene?.multiCharacterSlots,
        sceneCharacterAddition,
        sceneCharacterAdditionsEnabled,
        expertSceneCharacterAdditionsEnabled,
        sceneVariantOverrideEnabled,
        sceneCostumeOverrideEnabled,
        expertSceneMultiCharacterEnabled,
        expertCharacterPromptLayoutEnabled,
        characters,
        basePrompt,
        additionalPrompt,
        detailPrompt,
        negativePrompt,
        inpaintingPrompt,
        i2iMode,
        localPrompt,
        localNegativePrompt,
        fragmentRevision,
    ])

    // Preserve the newest local edit when leaving the scene before debounce ends.
    useEffect(() => {
        if (!scene || !activePresetId) return
        const sceneIdToSave = scene.id
        const presetIdToSave = activePresetId

        return () => {
            const latestPrompt = localPromptRef.current
            const currentScene = useSceneStore.getState().presets
                .find(p => p.id === presetIdToSave)?.scenes
                .find(s => s.id === sceneIdToSave)
            if (currentScene && latestPrompt !== currentScene.scenePrompt) {
                updateScenePrompt(presetIdToSave, sceneIdToSave, latestPrompt)
            }
            const latestNegativePrompt = localNegativePromptRef.current
            if (currentScene && latestNegativePrompt !== (currentScene.sceneNegativePrompt || '')) {
                updateSceneNegativePrompt(presetIdToSave, sceneIdToSave, latestNegativePrompt)
            }
        }
    }, [scene?.id, activePresetId, updateScenePrompt, updateSceneNegativePrompt])

    // Auto-validate images on mount - MUST be before conditional return to maintain hook order
    useEffect(() => {
        if (!scene || !activePresetId || !validateSceneImages) return

        const validateImages = async () => {
            if (scene.images.length === 0) return

            const validImageIds: string[] = []
            let hasChanges = false

            for (const img of scene.images) {
                try {
                    // Check if url is a file path
                    if (!img.url.startsWith('data:')) {
                        if (await exists(img.url)) {
                            validImageIds.push(img.id)
                        } else {
                            hasChanges = true
                        }
                    } else {
                        // Keep base64 images
                        validImageIds.push(img.id)
                    }
                } catch (e) {
                    // If check fails, assume valid to be safe
                    validImageIds.push(img.id)
                }
            }

            // Only update if changes needed
            if (hasChanges && validImageIds.length !== scene.images.length) {
                validateSceneImages(activePresetId, scene.id, validImageIds)
            }
        }

        validateImages()
    }, [scene?.id, activePresetId, validateSceneImages])

    const handleBack = () => {
        // Save prompt immediately before leaving
        if (scene && activePresetId && localPrompt !== scene.scenePrompt) {
            updateScenePrompt(activePresetId, scene.id, localPrompt)
        }
        if (scene && activePresetId && localNegativePrompt !== (scene.sceneNegativePrompt || '')) {
            updateSceneNegativePrompt(activePresetId, scene.id, localNegativePrompt)
        }
        nav('/scenes')
    }

    if (!scene || !activePresetId) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
                <p>{t('scene.notFound', '씬을 찾을 수 없습니다')}</p>
                <Button onClick={handleBack} variant="outline">
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    {t('common.back', '돌아가기')}
                </Button>
            </div>
        )
    }

    const handleSaveName = () => {
        if (editName.trim()) {
            renameScene(activePresetId, scene.id, editName.trim())
        }
        setIsEditingName(false)
    }

    const handleGenerate = () => {
        if (!activePresetId || !scene) return

        // If queue count is 0, set it to 1 for single generation
        // Otherwise, use the existing queue count without incrementing
        if (sceneQueueCount === 0) {
            incrementQueue(activePresetId, scene.id)
        }

        // Start a new generation session to properly track and allow cancellation
        useSceneStore.getState().startNewGenerationSession()
    }

    const handleOpenFolder = async () => {
        try {
            if (!scene) return

            // Get preset name for folder structure
            const currentPreset = useSceneStore.getState().presets.find(p => p.id === activePresetId)
            const safePresetName = sanitizeSceneFolderName(currentPreset?.name || 'Default', 'Default')
            const safeSceneName = sanitizeSceneFolderName(scene.name)

            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const basePath = useAbsolutePath && savePath ? savePath : await pictureDir()
            const defaultFolderPath = await join(basePath, 'NAIS_Scene', safePresetName, safeSceneName)
            const linkedFolderPath = getSceneFolderFromImages(scene.images)
            const folderPath = linkedFolderPath && await exists(linkedFolderPath)
                ? linkedFolderPath
                : defaultFolderPath

            await mkdir(folderPath, { recursive: true })
            await Command.create('explorer', [folderPath]).execute()
        } catch (error) {
            console.error("Failed to open folder:", error)
        }
    }

    const isStreaming = streamingSceneId === scene.id

    const sortedImages = showFavoritesOnly
        ? scene.images.filter(img => img.isFavorite)
        : scene.images

    return (
        <div className="relative flex h-full flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Tip content={t('actions.openFolder', '생성된 이미지 폴더 열기')}>
                        <Button variant="ghost" size="icon" className="rounded-xl" onClick={handleOpenFolder}>
                            <FolderOpen className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </Tip>
                    <Tip content={t('actions.back', '씬 목록으로 돌아가기')}>
                        <Button variant="ghost" size="icon" className="rounded-xl" onClick={handleBack}>
                            <ChevronLeft className="h-5 w-5" />
                        </Button>
                    </Tip>
                    <div>
                        {isEditingName ? (
                            <div className="flex items-center gap-2">
                                <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="text-2xl font-bold h-9 w-64 rounded-lg"
                                    autoFocus
                                    onBlur={handleSaveName}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleSaveName()
                                        if (e.key === 'Escape') setIsEditingName(false)
                                    }}
                                />
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={handleSaveName}>
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setIsEditingName(false)}>
                                    <X className="h-4 w-4" />
                                </Button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <h1 className="text-2xl font-bold">{scene.name}</h1>
                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg opacity-50 hover:opacity-100" onClick={() => setIsEditingName(true)}>
                                    <Pencil className="h-4 w-4" />
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {/* Resolution Settings */}
                    <div className="w-[220px]">
                        <ResolutionSelector
                            value={currentResolution}
                            onChange={handleResolutionChange}
                        />
                    </div>

                    <div className="w-px h-8 bg-border mx-2" />

                    {/* Queue Controls */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-muted/50">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => decrementQueue(activePresetId, scene.id)}
                            disabled={sceneQueueCount === 0}
                        >
                            <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm font-medium w-8 text-center">{sceneQueueCount}</span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => incrementQueue(activePresetId, scene.id)}
                        >
                            <Plus className="h-3 w-3" />
                        </Button>
                    </div>


                    <Button size="sm" className="rounded-xl" onClick={handleGenerate}>
                        <Play className="mr-2 h-4 w-4" />
                        {t('generate.button')}
                    </Button>
                </div>
            </div >

            {(sceneVariantOverrideEnabled || sceneCostumeOverrideEnabled || expertSceneMultiCharacterEnabled) && (
                <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/25 px-3 py-2 shrink-0">
                    {sceneVariantOverrideEnabled && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{t('sceneCharacterAddition.stackOverride')}</span>
                            <Select
                                value={sceneCharacterAddition?.characterVariantIndex === undefined
                                    ? 'current'
                                    : String(sceneCharacterAddition.characterVariantIndex)}
                                onValueChange={(value) => updateScenePromptOverride({
                                    characterVariantIndex: value === 'current' ? undefined : Number(value),
                                })}
                            >
                                <SelectTrigger className="h-8 w-[112px] rounded-lg">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="current">{t('sceneCharacterAddition.useCurrentStack')}</SelectItem>
                                    {[0, 1, 2, 3, 4].map(index => (
                                        <SelectItem key={index} value={String(index)}>{index + 1}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    {sceneCostumeOverrideEnabled && (
                        <Tip content={t('sceneCharacterAddition.disableCostume')}>
                            <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                    "h-8 rounded-lg",
                                    hasCostumeOverride && "border-rose-500/50 bg-rose-500/15 text-rose-500 hover:bg-rose-500/25"
                                )}
                                onClick={() => updateScenePromptOverride({
                                    characterCostumeEnabled: hasCostumeOverride ? undefined : false,
                                })}
                            >
                                <Shirt className="mr-2 h-4 w-4" />
                                {t('sceneCharacterAddition.disableCostume')}
                            </Button>
                        </Tip>
                    )}
                    {expertSceneMultiCharacterEnabled && (
                        <Popover open={multiCharacterPanelOpen} onOpenChange={setMultiCharacterPanelOpen}>
                            <PopoverTrigger asChild>
                                <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg">
                                    <UsersRound className="mr-2 h-4 w-4" />
                                    {t('sceneMultiCharacter.title')}
                                    <ChevronDown className="ml-2 h-3.5 w-3.5" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-[min(620px,calc(100vw-3rem))] max-h-[min(70vh,620px)] overflow-y-auto p-3">
                                <SceneMultiCharacterPanel
                                    embedded
                                    slots={scene.multiCharacterSlots || []}
                                    onChange={(slots) => updateSceneMultiCharacterSlots(activePresetId, scene.id, slots)}
                                />
                            </PopoverContent>
                        </Popover>
                    )}
                </div>
            )}

            <section className="shrink-0">
                <div className="flex h-8 items-center justify-between gap-3 border-b border-border/50">
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn(
                                'h-8 rounded-none px-2.5 text-xs text-muted-foreground hover:text-foreground',
                                scenePromptMode === 'positive' && 'border-b-2 border-primary text-foreground',
                            )}
                            onClick={() => setScenePromptMode('positive')}
                        >
                            {t('sceneEditor.positive')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn(
                                'h-8 rounded-none px-2.5 text-xs text-muted-foreground hover:text-foreground',
                                scenePromptMode === 'negative' && 'border-b-2 border-primary text-foreground',
                            )}
                            onClick={() => setScenePromptMode('negative')}
                        >
                            {t('sceneEditor.negative')}
                        </Button>
                    </div>
                    <Tip content={sceneEditorCollapsed ? t('sceneEditor.expand') : t('sceneEditor.collapse')}>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={() => setSceneEditorCollapsed(value => !value)}
                        >
                            {sceneEditorCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        </Button>
                    </Tip>
                </div>

                {!sceneEditorCollapsed && (
                    <div className="relative mt-2">
                        <AutocompleteTextarea
                            key={`${scene.id}-${scenePromptMode}`}
                            placeholder={scenePromptMode === 'positive' ? t('sceneEditor.positivePlaceholder') : t('sceneEditor.negativePlaceholder')}
                            className="!h-[164px] min-h-0 resize-none rounded-md"
                            style={{ fontSize: `${promptFontSize}px` }}
                            value={scenePromptMode === 'positive' ? localPrompt : localNegativePrompt}
                            onChange={(event: any) => scenePromptMode === 'positive'
                                ? setLocalPrompt(event.target.value)
                                : setLocalNegativePrompt(event.target.value)
                            }
                        />
                        <SceneTokenCountOverlay count={scenePromptMode === 'positive' ? sceneTokenTotals.positive : sceneTokenTotals.negative} />
                    </div>
                )}
            </section>

            {/* Generated Images */}
            <section className="flex min-h-0 flex-1 flex-col">
                <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-border/50">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                        {t('scene.generatedImages')}
                        <span className="text-muted-foreground font-normal">({scene.images.length})</span>
                        {isEditMode && selectedImageIds.size > 0 && (
                            <span className="text-primary font-medium ml-2">
                                {t('scene.selectedCount', '{{count}}개 선택됨', { count: selectedImageIds.size })}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {isEditMode ? (
                            <>
                                {/* Select All / Deselect All */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => {
                                        if (selectedImageIds.size === scene.images.length) {
                                            setSelectedImageIds(new Set())
                                        } else {
                                            setSelectedImageIds(new Set(scene.images.map(img => img.id)))
                                        }
                                    }}
                                >
                                    {selectedImageIds.size === scene.images.length ? (
                                        <Square className="h-3 w-3" />
                                    ) : (
                                        <CheckSquare className="h-3 w-3" />
                                    )}
                                    {selectedImageIds.size === scene.images.length ? t('scene.deselectAll', '선택 해제') : t('scene.selectAll', '전체 선택')}
                                </Button>
                                {/* Delete Selected */}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={async () => {
                                        if (activePresetId && sceneId && selectedImageIds.size > 0) {
                                            const deletedPaths: string[] = []
                                            for (const imgId of selectedImageIds) {
                                                const img = scene.images.find(i => i.id === imgId)
                                                if (img && !img.url.startsWith('data:')) {
                                                    try { await remove(img.url) } catch (e) { console.warn('Delete failed:', e) }
                                                    deletedPaths.push(img.url)
                                                }
                                                deleteImage(activePresetId, scene.id, imgId)
                                            }
                                            if (deletedPaths.length > 0) {
                                                window.dispatchEvent(new CustomEvent('imageDeleted', { detail: { paths: deletedPaths } }))
                                            }
                                            toast({ description: t('scene.deletedSelected', '{{count}}개 이미지 삭제됨', { count: selectedImageIds.size }) })
                                            setSelectedImageIds(new Set())
                                        }
                                    }}
                                    disabled={selectedImageIds.size === 0}
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {t('scene.deleteSelected', '선택 삭제')}
                                </Button>
                                {/* Exit Edit Mode */}
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => {
                                        setIsEditMode(false)
                                        setSelectedImageIds(new Set())
                                    }}
                                >
                                    <Check className="h-3 w-3" />
                                    {t('scene.exitEditMode', '편집 종료')}
                                </Button>
                            </>
                        ) : (
                            <>
                                {/* Edit Mode Button */}
                                <Tip content={t('scene.editMode', '편집 모드')}>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 rounded-lg gap-1"
                                        onClick={() => setIsEditMode(true)}
                                    >
                                        <Pencil className="h-3 w-3" />
                                    </Button>
                                </Tip>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 rounded-lg gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={async () => {
                                        if (activePresetId && sceneId) {
                                            const { count, paths } = deleteNonFavoriteImages(activePresetId, sceneId)
                                            // Delete actual files
                                            for (const filePath of paths) {
                                                try {
                                                    await remove(filePath)
                                                } catch (e) {
                                                    console.warn('Failed to delete file:', filePath, e)
                                                }
                                            }
                                            if (paths.length > 0) {
                                                window.dispatchEvent(new CustomEvent('imageDeleted', { detail: { paths } }))
                                            }
                                            if (count > 0) {
                                                toast({ description: t('scene.deletedNonFavorites', '{{count}}개 이미지 삭제됨', { count }) })
                                            }
                                        }
                                    }}
                                    disabled={scene.images.filter(img => !img.isFavorite).length === 0}
                                >
                                    <Trash2 className="h-3 w-3" />
                                    {t('scene.deleteNonFavorites', '즐겨찾기 제외 삭제')}
                                </Button>
                                <Button
                                    variant={showFavoritesOnly ? "default" : "outline"}
                                    size="sm"
                                    className="h-7 rounded-lg gap-1"
                                    onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                                >
                                    <Star className={`h-3 w-3 ${showFavoritesOnly ? 'fill-current' : ''}`} />
                                    {t('scene.favoritesOnly', '즐겨찾기')}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar pt-3 pr-1">
                    {sortedImages.length === 0 && !isStreaming ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                            <ImageIcon className="h-16 w-16 mb-4 stroke-1" />
                            <p>{t('scene.noImages', '생성된 이미지가 없습니다')}</p>
                        </div>
                    ) : (
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                            {/* Streaming Card Slot */}
                            {isStreaming && streamingImage && (
                                <div className={cn("rounded-xl overflow-hidden bg-muted/30 relative border border-primary/50 shadow-[0_0_15px_rgba(59,130,246,0.5)]", getThumbnailAspectClass(thumbnailLayout))}>
                                    <img src={streamingImage} alt="Generating..." className="w-full h-full object-cover animate-pulse opacity-80" loading="lazy" decoding="async" />
                                    <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-500/50">
                                        <div className="h-full bg-white transition-all duration-300 shadow-[0_0_8px_rgba(255,255,255,0.8)]" style={{ width: `${streamingProgress * 100}%` }} />
                                    </div>
                                </div>
                            )}

                            {sortedImages.map((image) => (
                                <SceneImageCard
                                    key={image.id}
                                    image={image}
                                    thumbnailLayout={thumbnailLayout}
                                    isEditMode={isEditMode}
                                    isSelected={selectedImageIds.has(image.id)}
                                    onSelect={() => {
                                        const newSet = new Set(selectedImageIds)
                                        if (newSet.has(image.id)) {
                                            newSet.delete(image.id)
                                        } else {
                                            newSet.add(image.id)
                                        }
                                        setSelectedImageIds(newSet)
                                    }}
                                    onDelete={() => deleteImage(activePresetId, scene.id, image.id)}
                                    onToggleFavorite={() => toggleFavorite(activePresetId, scene.id, image.id)}
                                    // Handlers for new context menu items
                                    onAddRef={async () => {
                                        // Reuse image loading logic or read file
                                        try {
                                            let dataUrl = image.url
                                            if (!dataUrl.startsWith('data:')) {
                                                const data = await readFile(image.url)
                                                let binary = ''
                                                const len = data.byteLength
                                                for (let i = 0; i < len; i++) {
                                                    binary += String.fromCharCode(data[i])
                                                }
                                                dataUrl = `data:image/png;base64,${btoa(binary)}`
                                            }
                                            setSelectedImageForRef(dataUrl)
                                            setImageRefDialogOpen(true)
                                        } catch (e) {
                                            console.error("Failed to load reference image", e)
                                        }
                                    }}
                                    onLoadMetadata={async () => {
                                        try {
                                            let dataUrl = image.url
                                            if (!dataUrl.startsWith('data:')) {
                                                const data = await readFile(image.url)
                                                let binary = ''
                                                const len = data.byteLength
                                                for (let i = 0; i < len; i++) {
                                                    binary += String.fromCharCode(data[i])
                                                }
                                                dataUrl = `data:image/png;base64,${btoa(binary)}`
                                            }
                                            setSelectedImageForMetadata(dataUrl)
                                            setMetadataDialogOpen(true)
                                        } catch (e) {
                                            console.error("Failed to load metadata image", e)
                                        }
                                    }}
                                    onInpaint={(base64) => {
                                        setSelectedImageForInpaint(base64)
                                        setInpaintDialogOpen(true)
                                    }}
                                    onImageClick={(imgSrc) => {
                                        setViewerImageSrc(imgSrc)
                                        setViewerImage(image)
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </section>

            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setSelectedImageForMetadata(undefined)
                }}
                initialImage={selectedImageForMetadata}
            />

            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={selectedImageForRef}
            />

            <InpaintingDialog
                open={inpaintDialogOpen}
                onOpenChange={(open) => {
                    setInpaintDialogOpen(open)
                    if (!open) setSelectedImageForInpaint(null)
                }}
                sourceImage={selectedImageForInpaint}
            />

            {/* Full-Screen Image Viewer Overlay with Context Menu */}
            {viewerImageSrc && viewerImage && (
                <div
                    className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/90 p-4 cursor-pointer"
                    onClick={() => {
                        setViewerImageSrc(null)
                        setViewerImage(null)
                    }}
                >
                    <SceneImageContextMenu
                        image={viewerImage}
                        onDelete={() => {
                            if (activePresetId && scene) {
                                deleteImage(activePresetId, scene.id, viewerImage.id)
                            }
                            setViewerImageSrc(null)
                            setViewerImage(null)
                        }}
                        onAddRef={async () => {
                            try {
                                let dataUrl = viewerImage.url
                                if (!dataUrl.startsWith('data:')) {
                                    const data = await readFile(viewerImage.url)
                                    let binary = ''
                                    for (let i = 0; i < data.byteLength; i++) {
                                        binary += String.fromCharCode(data[i])
                                    }
                                    dataUrl = `data:image/png;base64,${btoa(binary)}`
                                }
                                setSelectedImageForRef(dataUrl)
                                setImageRefDialogOpen(true)
                            } catch (e) {
                                console.error('Failed to load ref image', e)
                            }
                        }}
                        onLoadMetadata={async () => {
                            try {
                                let dataUrl = viewerImage.url
                                if (!dataUrl.startsWith('data:')) {
                                    const data = await readFile(viewerImage.url)
                                    let binary = ''
                                    for (let i = 0; i < data.byteLength; i++) {
                                        binary += String.fromCharCode(data[i])
                                    }
                                    dataUrl = `data:image/png;base64,${btoa(binary)}`
                                }
                                setSelectedImageForMetadata(dataUrl)
                                setMetadataDialogOpen(true)
                            } catch (e) {
                                console.error('Failed to load metadata image', e)
                            }
                        }}
                        onInpaint={async (base64) => {
                            setSelectedImageForInpaint(base64)
                            setInpaintDialogOpen(true)
                        }}
                    >
                        <img
                            src={viewerImageSrc}
                            alt="Full view"
                            className="min-h-0 min-w-0 max-h-full max-w-full object-contain cursor-default"
                            onClick={(e) => e.stopPropagation()}
                            onContextMenu={(e) => e.stopPropagation()}
                        />
                    </SceneImageContextMenu>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-4 right-4 text-white bg-black/50 hover:bg-black/70 rounded-lg h-10 w-10"
                        onClick={() => {
                            setViewerImageSrc(null)
                            setViewerImage(null)
                        }}
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </div >
    )
}

import { SceneImageContextMenu } from '@/components/scene/SceneImageContextMenu'

function SceneTokenCountOverlay({ count }: { count: number }) {
    const exceeded = count > 512
    return (
        <span className={cn(
            'pointer-events-none absolute bottom-2 right-3 z-[1] rounded border px-1.5 py-0.5 font-mono text-[10px] shadow-sm backdrop-blur-sm',
            exceeded
                ? 'border-destructive/70 bg-destructive/90 text-destructive-foreground'
                : 'border-border/60 bg-background/70 text-muted-foreground',
        )}>
            {count}/512
        </span>
    )
}

function SceneImageCard({
    image,
    thumbnailLayout,
    isEditMode,
    isSelected,
    onSelect,
    onToggleFavorite,
    onDelete,
    onAddRef,
    onLoadMetadata,
    onImageClick,
    onInpaint,
}: {
    image: SceneImage
    thumbnailLayout: 'vertical' | 'horizontal' | 'square'
    isEditMode?: boolean
    isSelected?: boolean
    onSelect?: () => void
    onToggleFavorite: () => void
    onDelete: () => void
    onAddRef?: () => void
    onLoadMetadata?: () => void
    onImageClick?: (imgSrc: string) => void
    onInpaint?: (base64: string) => void
}) {
    // SceneImageCard now just renders the image and overlay.
    // Logic for loading the image data is handled by the browser <img> tag directly using the file path (image.url).
    // Note: If Tauri requires a special protocol for local files, it's usually `asset://` or handled by `tauri-plugin-fs` + convertFileSrc.
    // Assuming standard `src={image.url}` works for now based on context, or user has configured identifying protocol.
    // If image.url is strictly a Windows path "C:\...", we might need convertFileSrc.
    // BUT the previous code was using readFile + base64. Let's stick to that if needed, 
    // OR try the simpler approach first if supported. 
    // Wait, the previous code had `loadImage` logic because `image.url` is a raw path. 
    // I will restore the `loadImage` logic inside SceneImageCard to ensure images display correctly.

    const [imgSrc, setImgSrc] = useState<string>('')
    const [cardRef, isNearViewport] = useNearViewport<HTMLDivElement>()

    useEffect(() => {
        if (!isNearViewport || !image.url) {
            setImgSrc('')
            return
        }
        if (image.url.startsWith('data:')) {
            setImgSrc(image.url)
            return
        }
        // Use convertFileSrc for efficient native asset loading
        // No need for base64 conversion - directly use the asset protocol
        setImgSrc(convertFileSrc(image.url))
    }, [image.url, isNearViewport])

    return (
        <SceneImageContextMenu
            image={image}
            onDelete={onDelete}
            onAddRef={onAddRef}
            onLoadMetadata={onLoadMetadata}
            onInpaint={onInpaint}
        >
            <div
                ref={cardRef}
                className={cn(
                    "relative group rounded-xl overflow-hidden bg-muted/30 border-2 transition-all duration-300 shadow-sm cursor-pointer",
                    getThumbnailAspectClass(thumbnailLayout),
                    isEditMode && isSelected
                        ? "border-orange-500 ring-2 ring-orange-500/50"
                        : image.isFavorite
                            ? "border-yellow-500 ring-2 ring-yellow-500/30"
                            : "border-border/50 hover:border-primary/50"
                )}
                onClick={() => {
                    if (isEditMode) {
                        onSelect?.()
                    } else {
                        imgSrc && onImageClick?.(imgSrc)
                    }
                }}
            >
                {/* Image */}
                {imgSrc && (
                    <img
                        src={imgSrc}
                        alt="Scene Image"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                        decoding="async"
                    />
                )}

                {/* Edit mode selection overlay */}
                {isEditMode && (
                    <div className={cn(
                        "absolute top-2 left-2 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all",
                        isSelected
                            ? "bg-orange-500 border-orange-500"
                            : "bg-black/50 border-white/50"
                    )}>
                        {isSelected && <Check className="h-4 w-4 text-white" />}
                    </div>
                )}

                {/* Overlay (hide in edit mode) */}
                {!isEditMode && (
                    <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end justify-between p-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
                        >
                            <Star className={cn("h-3.5 w-3.5", image.isFavorite && "fill-current")} />
                        </Button>
                    </div>
                )}

                <div className="absolute inset-0 rounded-xl border border-transparent group-hover:border-primary/50 pointer-events-none" />
            </div>
        </SceneImageContextMenu>
    )
}
