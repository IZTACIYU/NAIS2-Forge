import { lazy, Suspense, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SourceImagePanel } from '@/components/layout/SourceImagePanel'
import { CharacterSettingsDialog } from '@/components/character/CharacterSettingsDialog'
import { CharacterPromptPanel } from '@/components/character/CharacterPromptPanel'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'

const PromptGeneratorDialog = lazy(() => import('@/components/prompt/PromptGeneratorDialog').then(module => ({ default: module.PromptGeneratorDialog })))
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import Counter from '@/components/ui/counter'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import { generateRandomSeed } from '@/lib/utils'
import {
    ImagePlus,
    Dice5,
    Lock,
    Unlock,
    SlidersHorizontal,
    Cpu,
    Film,
    Puzzle,
    Users,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import GeminiIcon from '@/assets/gemini-color.svg'
import { useGenerationStore, AVAILABLE_MODELS } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useFragmentStore } from '@/stores/fragment-store'
import { ResolutionSelector } from '@/components/ui/ResolutionSelector'

const SAMPLERS = [
    'k_euler',
    'k_euler_ancestral',
    'k_dpmpp_2s_ancestral',
    'k_dpmpp_2m',
    'k_dpmpp_2m_sde',
    'k_dpmpp_sde',
    'ddim',
]

const SCHEDULERS = ['native', 'karras', 'exponential', 'polyexponential']

export function PromptPanel() {
    const { t } = useTranslation()
    const location = useLocation()
    const isSceneMode = location.pathname.startsWith('/scenes')

    // Zustand 선택적 구독 - sceneStore
    const activePresetId = useSceneStore(state => state.activePresetId)
    const routeSceneId = location.pathname.match(/^\/scenes\/([^/]+)/)?.[1]
    const activeScenePrompt = useSceneStore(state => {
        if (!routeSceneId || !state.activePresetId) return ''
        return state.presets.find(preset => preset.id === state.activePresetId)
            ?.scenes.find(scene => scene.id === routeSceneId)?.scenePrompt || ''
    })
    const getTotalQueueCount = useSceneStore(state => state.getTotalQueueCount)
    const sceneIsGenerating = useSceneStore(state => state.isGenerating)
    const sceneIsCancelling = useSceneStore(state => state.isCancelling)
    const cancelSceneGeneration = useSceneStore(state => state.cancelSceneGeneration)
    const startNewGenerationSession = useSceneStore(state => state.startNewGenerationSession)
    const completedCount = useSceneStore(state => state.completedCount)
    const totalQueuedCount = useSceneStore(state => state.totalQueuedCount)

    const sceneQueueCount = activePresetId ? getTotalQueueCount(activePresetId) : 0

    // Zustand 선택적 구독 - generationStore (상태)
    const basePrompt = useGenerationStore(state => state.basePrompt)
    const additionalPrompt = useGenerationStore(state => state.additionalPrompt)
    const detailPrompt = useGenerationStore(state => state.detailPrompt)
    const negativePrompt = useGenerationStore(state => state.negativePrompt)
    const seed = useGenerationStore(state => state.seed)
    const seedLocked = useGenerationStore(state => state.seedLocked)
    const selectedResolution = useGenerationStore(state => state.selectedResolution)
    const isGenerating = useGenerationStore(state => state.isGenerating)
    const isCancelled = useGenerationStore(state => state.isCancelled)
    const model = useGenerationStore(state => state.model)
    const steps = useGenerationStore(state => state.steps)
    const cfgScale = useGenerationStore(state => state.cfgScale)
    const cfgRescale = useGenerationStore(state => state.cfgRescale)
    const sampler = useGenerationStore(state => state.sampler)
    const scheduler = useGenerationStore(state => state.scheduler)
    const smea = useGenerationStore(state => state.smea)
    const smeaDyn = useGenerationStore(state => state.smeaDyn)
    const variety = useGenerationStore(state => state.variety)
    const qualityToggle = useGenerationStore(state => state.qualityToggle)
    const ucPreset = useGenerationStore(state => state.ucPreset)
    const batchCount = useGenerationStore(state => state.batchCount)
    const currentBatch = useGenerationStore(state => state.currentBatch)
    const generatingMode = useGenerationStore(state => state.generatingMode)

    // Zustand 선택적 구독 - generationStore (액션)
    const setBasePrompt = useGenerationStore(state => state.setBasePrompt)
    const setAdditionalPrompt = useGenerationStore(state => state.setAdditionalPrompt)
    const setDetailPrompt = useGenerationStore(state => state.setDetailPrompt)
    const setNegativePrompt = useGenerationStore(state => state.setNegativePrompt)
    const setSeed = useGenerationStore(state => state.setSeed)
    const setSeedLocked = useGenerationStore(state => state.setSeedLocked)
    const setSelectedResolution = useGenerationStore(state => state.setSelectedResolution)
    const setModel = useGenerationStore(state => state.setModel)
    const setSteps = useGenerationStore(state => state.setSteps)
    const setCfgScale = useGenerationStore(state => state.setCfgScale)
    const setCfgRescale = useGenerationStore(state => state.setCfgRescale)
    const setSampler = useGenerationStore(state => state.setSampler)
    const setScheduler = useGenerationStore(state => state.setScheduler)
    const setSmea = useGenerationStore(state => state.setSmea)
    const setSmeaDyn = useGenerationStore(state => state.setSmeaDyn)
    const setVariety = useGenerationStore(state => state.setVariety)
    const setQualityToggle = useGenerationStore(state => state.setQualityToggle)
    const setUcPreset = useGenerationStore(state => state.setUcPreset)
    const setBatchCount = useGenerationStore(state => state.setBatchCount)
    const generate = useGenerationStore(state => state.generate)
    const cancelGeneration = useGenerationStore(state => state.cancelGeneration)

    // Zustand 선택적 구독 - settingsStore
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const basePromptCollapsed = useSettingsStore(state => state.basePromptCollapsed)
    const setBasePromptCollapsed = useSettingsStore(state => state.setBasePromptCollapsed)
    const additionalPromptCollapsed = useSettingsStore(state => state.additionalPromptCollapsed)
    const setAdditionalPromptCollapsed = useSettingsStore(state => state.setAdditionalPromptCollapsed)
    const detailPromptCollapsed = useSettingsStore(state => state.detailPromptCollapsed)
    const setDetailPromptCollapsed = useSettingsStore(state => state.setDetailPromptCollapsed)
    const negativePromptCollapsed = useSettingsStore(state => state.negativePromptCollapsed)
    const setNegativePromptCollapsed = useSettingsStore(state => state.setNegativePromptCollapsed)

    // Zustand 선택적 구독 - characterPromptStore
    const characterCount = useCharacterPromptStore(state => state.characters.filter(c => c.enabled).length)
    const characters = useCharacterPromptStore(state => state.characters)
    const fragmentRevision = useFragmentStore(state =>
        state.files.map(file => `${file.id}:${file.updatedAt}`).join('|')
    )
    const activeReferenceCount = useCharacterStore(state =>
        state.characterImages.filter(image => image.enabled !== false).length
        + state.vibeImages.filter(image => image.enabled !== false).length
    )

    const [promptGenOpen, setPromptGenOpen] = useState(false)
    const [characterPanelOpen, setCharacterPanelOpen] = useState(false)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    const [parameterDialogOpen, setParameterDialogOpen] = useState(false)
    const [tokenTotals, setTokenTotals] = useState({ positive: 0, negative: 0 })

    useEffect(() => {
        const removeComments = (text: string) => text
            .split('\n')
            .filter(line => !line.trimStart().startsWith('#'))
            .join('\n')
        const positive = [
            basePrompt,
            additionalPrompt,
            detailPrompt,
            activeScenePrompt,
            ...characters.filter(character => character.enabled).map(character => character.prompt),
        ].map(removeComments).filter(text => text.trim()).join(', ')
        const negative = [
            negativePrompt,
            ...characters.filter(character => character.enabled).map(character => character.negative),
        ].map(removeComments).filter(text => text.trim()).join(', ')
        if (!positive && !negative) {
            setTokenTotals({ positive: 0, negative: 0 })
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
                    setTokenTotals({
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
    }, [basePrompt, additionalPrompt, detailPrompt, negativePrompt, activeScenePrompt, characters, fragmentRevision])

    // 전역 단축키 이벤트 수신
    useEffect(() => {
        const handleOpenPromptGen = () => setPromptGenOpen(prev => !prev)
        const handleOpenParameters = () => setParameterDialogOpen(prev => !prev)
        const handleOpenCharacterPrompt = () => {
            setImageRefDialogOpen(false)
            setCharacterPanelOpen(prev => !prev)
        }
        const handleOpenImageReference = () => {
            setCharacterPanelOpen(false)
            setImageRefDialogOpen(prev => !prev)
        }

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenPromptGen)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenImageReference)

        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PROMPT_GENERATOR, handleOpenPromptGen)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PARAMETER_SETTINGS, handleOpenParameters)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_CHARACTER_PROMPT, handleOpenCharacterPrompt)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_IMAGE_REFERENCE, handleOpenImageReference)
        }
    }, [])

    const handleRandomSeed = () => {
        if (!seedLocked) {
            setSeed(generateRandomSeed())
        }
    }




    // Conflict Detection
    const isMainGenerating = generatingMode === 'main'
    const isSceneGenerating = generatingMode === 'scene'
    const isConflict = isSceneMode ? isMainGenerating : isSceneGenerating

    const handleGenerateOrCancel = useCallback(() => {
        if (isConflict) return // Prevent action if conflict exists

        if (isSceneMode) {
            // Toggle scene generation: start new session or cancel
            if (sceneIsGenerating || sceneIsCancelling) {
                cancelSceneGeneration()  // Cancel - invalidates session but keeps button locked
            } else {
                startNewGenerationSession()  // Start - creates new session ID
            }
            return
        }

        if (isGenerating) {
            cancelGeneration()
        } else {
            generate()
        }
    }, [isConflict, isSceneMode, sceneIsGenerating, sceneIsCancelling, cancelSceneGeneration, startNewGenerationSession, isGenerating, cancelGeneration, generate])

    return (
        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden p-2">
            {/* Source Image Panel (I2I/Inpaint Mode) */}
            <SourceImagePanel />

            {/* Prompt Inputs Area (Flex Grow, No Scroll on Container) - relative 컨테이너 */}
            <div className="flex-1 flex flex-col min-h-0 gap-2 mb-2 relative">
                {/* Character Prompt Panel (Accordion Style) - 프롬프트 영역 위에 오버레이 */}
                <CharacterPromptPanel
                    open={characterPanelOpen}
                    onOpenChange={setCharacterPanelOpen}
                />
                <CharacterSettingsDialog
                    open={imageRefDialogOpen}
                    onOpenChange={setImageRefDialogOpen}
                />

                {/* Base Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    basePromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[30%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setBasePromptCollapsed(!basePromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {basePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.base')}
                        {basePromptCollapsed && basePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {basePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!basePromptCollapsed && (
                        <div className="relative flex-1 min-h-0">
                            <AutocompleteTextarea
                                placeholder={t('prompt.basePlaceholder')}
                                value={basePrompt}
                                onChange={(e) => setBasePrompt(e.target.value)}
                                className="h-full min-h-0 resize-none rounded-xl"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                            <TokenCountOverlay count={tokenTotals.positive} />
                        </div>
                    )}
                </div>

                {/* Additional Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    additionalPromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[25%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setAdditionalPromptCollapsed(!additionalPromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {additionalPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.additional')}
                        {additionalPromptCollapsed && additionalPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {additionalPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!additionalPromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.additionalPlaceholder')}
                            value={additionalPrompt}
                            onChange={(e) => setAdditionalPrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>

                {/* Detail Prompt - Collapsible */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    detailPromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[25%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setDetailPromptCollapsed(!detailPromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground cursor-pointer flex-shrink-0"
                    >
                        {detailPromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.detail')}
                        {detailPromptCollapsed && detailPrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {detailPrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!detailPromptCollapsed && (
                        <AutocompleteTextarea
                            placeholder={t('prompt.detailPlaceholder')}
                            value={detailPrompt}
                            onChange={(e) => setDetailPrompt(e.target.value)}
                            className="flex-1 min-h-0 resize-none rounded-xl"
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    )}
                </div>

                {/* Negative Prompt - 20% (collapsible, collapses downward) */}
                <div className={cn(
                    "flex flex-col transition-all duration-200 overflow-hidden",
                    negativePromptCollapsed ? "flex-none h-[28px]" : "min-h-0 basis-[20%] flex-1"
                )}>
                    <button
                        type="button"
                        onClick={() => setNegativePromptCollapsed(!negativePromptCollapsed)}
                        className="flex items-center gap-1 text-xs font-medium text-destructive/80 mb-1 hover:text-destructive cursor-pointer flex-shrink-0"
                    >
                        {negativePromptCollapsed ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronUp className="h-3 w-3" />
                        )}
                        {t('prompt.negative')}
                        {negativePromptCollapsed && negativePrompt && (
                            <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                                - {negativePrompt.split(',')[0]}...
                            </span>
                        )}
                    </button>
                    {!negativePromptCollapsed && (
                        <div className="relative flex-1 min-h-0">
                            <AutocompleteTextarea
                                placeholder={t('prompt.negativePlaceholder')}
                                value={negativePrompt}
                                onChange={(e) => setNegativePrompt(e.target.value)}
                                className="h-full min-h-0 resize-none rounded-xl border-destructive/20"
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                            <TokenCountOverlay count={tokenTotals.negative} />
                        </div>
                    )}
                </div>
            </div>

            {/* Quick Actions & Parameters Button */}
            <div className="flex min-w-0 gap-2 mb-3">
                <Button
                    variant={imageRefDialogOpen ? "default" : "outline"}
                    size="sm"
                    className="min-w-0 flex-1 px-2 text-xs rounded-xl h-9 relative"
                    onClick={() => {
                        setCharacterPanelOpen(false)
                        setImageRefDialogOpen(prev => !prev)
                    }}
                >
                    <ImagePlus className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="min-w-0 truncate">{t('prompt.imageReference')}</span>
                    {activeReferenceCount > 0 && (
                        <div className={cn(
                            "absolute -top-1 -right-1 text-[9px] font-bold rounded-md px-1 py-0.5 min-w-[16px] h-[16px] flex items-center justify-center shadow-sm",
                            imageRefDialogOpen ? "bg-primary-foreground text-primary" : "bg-red-500 text-white"
                        )}>
                            {activeReferenceCount}
                        </div>
                    )}
                </Button>
                {/* Character Prompt Toggle Button */}
                <Button
                    variant={characterPanelOpen ? "default" : "outline"}
                    size="sm"
                    className={cn(
                        "min-w-0 flex-1 px-2 text-xs rounded-xl h-9 relative",
                        characterPanelOpen && "bg-primary text-primary-foreground"
                    )}
                    onClick={() => {
                        setImageRefDialogOpen(false)
                        setCharacterPanelOpen(prev => !prev)
                    }}
                >
                    <Users className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="min-w-0 truncate">{t('prompt.character', '캐릭터')}</span>
                    {characterCount > 0 && (
                        <div className={cn(
                            "absolute -top-1 -right-1 text-[9px] font-bold rounded-md px-1 py-0.5 min-w-[16px] h-[16px] flex items-center justify-center shadow-sm",
                            characterPanelOpen
                                ? "bg-primary-foreground text-primary"
                                : "bg-primary text-primary-foreground"
                        )}>
                            {characterCount}
                        </div>
                    )}
                </Button>
                {/* Fragment Prompt Button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 overflow-hidden px-2 text-xs rounded-xl h-9"
                    onClick={() => window.dispatchEvent(new Event(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG))}
                >
                    <Puzzle className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    <span className="min-w-0 truncate">{t('prompt.fragment')}</span>
                </Button>
                {/* AI Prompt Generator Button */}
                <Tip content={t('promptGenerator.desc', 'Gemini AI로 프롬프트 생성')}>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 rounded-xl shrink-0 hover:bg-accent"
                        onClick={() => setPromptGenOpen(true)}
                    >
                        <img src={GeminiIcon} alt="Gemini" className="h-5 w-5" />
                    </Button>
                </Tip>
                {/* Parameter Settings Dialog */}
                <Dialog open={parameterDialogOpen} onOpenChange={setParameterDialogOpen}>
                    <DialogTrigger asChild>
                        <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl shrink-0">
                            <SlidersHorizontal className="h-4 w-4" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[440px] max-h-[85vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>{t('parameters.title')}</DialogTitle>
                            <DialogDescription>
                                {t('parameters.description')}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-3">
                            {/* Model Selection */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <Label className="flex items-center gap-2">
                                    <Cpu className="h-4 w-4" />
                                    {t('parameters.model')}
                                </Label>
                                <Select value={model} onValueChange={setModel}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AVAILABLE_MODELS.map((m) => (
                                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Resolution (Moved here) */}
                            {/* Resolution (Moved here) */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <Label className="text-sm font-medium">
                                    {t('settingsPage.general.resolution', '해상도')}
                                </Label>
                                <ResolutionSelector
                                    value={selectedResolution}
                                    onChange={setSelectedResolution}
                                    disabled={isGenerating}
                                />
                            </div>

                            {/* Seed (Moved here) */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <label className="text-sm font-medium">{t('settings.seed')}</label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        value={seed}
                                        onChange={(e) => setSeed(Number(e.target.value))}
                                        disabled={seedLocked}
                                        className="flex-1 h-9 text-xs rounded-xl"
                                    />
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className={cn("h-9 w-9 rounded-xl shrink-0", seedLocked && 'border-primary text-primary bg-primary/10')}
                                        onClick={() => setSeedLocked(!seedLocked)}
                                    >
                                        {seedLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-9 w-9 rounded-xl shrink-0"
                                        onClick={handleRandomSeed}
                                        disabled={seedLocked}
                                    >
                                        <Dice5 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>

                            {/* Steps */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.steps')}</Label>
                                    <span className="text-sm text-muted-foreground">{steps}</span>
                                </div>
                                <Slider
                                    value={[steps]}
                                    onValueChange={([v]) => setSteps(v)}
                                    min={1}
                                    max={50}
                                    step={1}
                                    className={cn("w-full", steps > 28 && "[&>.relative>.bg-primary]:bg-destructive")}
                                />
                            </div>

                            {/* CFG Scale */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.cfgScale')}</Label>
                                    <span className="text-sm text-muted-foreground">{cfgScale.toFixed(1)}</span>
                                </div>
                                <Slider
                                    value={[cfgScale]}
                                    onValueChange={([v]) => setCfgScale(v)}
                                    min={1}
                                    max={10}
                                    step={0.1}
                                    className="w-full"
                                />
                            </div>

                            {/* CFG Rescale */}
                            <div className="grid grid-cols-[110px_1fr] items-center gap-4">
                                <div className="flex items-center justify-between">
                                    <Label>{t('parameters.cfgRescale')}</Label>
                                    <span className="text-sm text-muted-foreground">{cfgRescale.toFixed(2)}</span>
                                </div>
                                <Slider
                                    value={[cfgRescale]}
                                    onValueChange={([v]) => setCfgRescale(v)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    className="w-full"
                                />
                            </div>

                            {/* Sampler & Scheduler */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>{t('parameters.sampler')}</Label>
                                    <Select value={sampler} onValueChange={setSampler}>
                                        <SelectTrigger className="rounded-xl">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SAMPLERS.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t('parameters.scheduler')}</Label>
                                    <Select value={scheduler} onValueChange={setScheduler}>
                                        <SelectTrigger className="rounded-xl">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {SCHEDULERS.map((s) => (
                                                <SelectItem key={s} value={s}>{s}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* SMEA & SMEA DYN */}
                            <div className="flex items-center justify-between pt-2">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setSmea(!smea)}>
                                        {t('parameters.smea')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Switchable Multi-head External Attention</span>
                                </div>
                                <Switch
                                    checked={smea}
                                    onChange={(e) => setSmea(e.target.checked)}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setSmeaDyn(!smeaDyn)}>
                                        {t('parameters.smeaDyn')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Dynamic SMEA</span>
                                </div>
                                <Switch
                                    checked={smeaDyn}
                                    disabled={!smea}
                                    onChange={(e) => setSmeaDyn(e.target.checked)}
                                />
                            </div>

                            {/* Variety+ */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setVariety(!variety)}>
                                        {t('parameters.variety', 'Variety+')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Increases generation variety</span>
                                </div>
                                <Switch
                                    checked={variety}
                                    onChange={(e) => setVariety(e.target.checked)}
                                />
                            </div>

                            {/* Add Quality Tags */}
                            <div className="flex items-center justify-between">
                                <div className="flex flex-col gap-1">
                                    <Label className="cursor-pointer" onClick={() => setQualityToggle(!qualityToggle)}>
                                        {t('parameters.qualityToggle', 'Add Quality Tags')}
                                    </Label>
                                    <span className="text-xs text-muted-foreground">Adds quality tags to prompt</span>
                                </div>
                                <Switch
                                    checked={qualityToggle}
                                    onChange={(e) => setQualityToggle(e.target.checked)}
                                />
                            </div>

                            {/* UC Preset */}
                            <div className="space-y-2">
                                <Label>{t('parameters.ucPreset', 'UC Preset')}</Label>
                                <Select value={String(ucPreset)} onValueChange={(v) => setUcPreset(Number(v))}>
                                    <SelectTrigger className="rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">Heavy</SelectItem>
                                        <SelectItem value="1">Light</SelectItem>
                                        <SelectItem value="2">Furry Focus</SelectItem>
                                        <SelectItem value="3">Human Focus</SelectItem>
                                        <SelectItem value="4">None</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* End of Parameters Dialog Content */}
                        </div>

                    </DialogContent>
                </Dialog>
            </div>

            {/* AI Prompt Generator Dialog */}
            {promptGenOpen && <Suspense fallback={null}><PromptGeneratorDialog
                open={promptGenOpen}
                onOpenChange={setPromptGenOpen}
                onApply={(tags) => {
                    // Append to additional prompt
                    const current = additionalPrompt.trim()
                    const newValue = current ? `${current}, ${tags}` : tags
                    setAdditionalPrompt(newValue)
                }}
            /></Suspense>}

            {/* Bottom Generate Button Area */}
            <div className="p-0">
                {/* Generate Button + Counter */}
                <div className="flex gap-2">
                    <Button
                        variant={(isGenerating || (isSceneMode && (sceneIsGenerating || sceneIsCancelling))) ? "destructive" : "generate"}
                        size="lg"
                        className={cn(
                            "flex-1 h-12 rounded-xl text-base font-semibold shadow-lg transition-all duration-200",
                            isConflict && "opacity-50 cursor-not-allowed"
                        )}
                        onClick={handleGenerateOrCancel}
                        disabled={
                            (isSceneMode && sceneQueueCount === 0 && !sceneIsGenerating && !sceneIsCancelling) ||
                            isConflict ||
                            sceneIsCancelling ||  // Disable while waiting for API to complete after cancel (Scene Mode)
                            (isGenerating && isCancelled)  // Disable while waiting for API to complete after cancel (Main Mode)
                        }
                    >
                        {isSceneMode ? (
                            sceneIsCancelling ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {t('common.cancelling', '취소 중...')}
                                </>
                            ) : sceneIsGenerating ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {t('common.cancel', '취소')} {totalQueuedCount > 0 && `(${completedCount + 1}/${totalQueuedCount})`}
                                </>
                            ) : (
                                <>
                                    <Film className="mr-2 h-5 w-5" />
                                    {t('scene.generateAll', '씬 생성')} {sceneQueueCount > 0 && `(${sceneQueueCount})`}
                                </>
                            )
                        ) : (
                            isGenerating && isCancelled ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {t('common.cancelling', '취소 중...')}
                                </>
                            ) : isGenerating ? (
                                <>
                                    <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                    {batchCount > 1
                                        ? `${t('generate.cancel')} (${currentBatch}/${batchCount})`
                                        : t('generate.cancel')
                                    }
                                </>
                            ) : (
                                <>
                                    <ImagePlus className="mr-2 h-5 w-5" />
                                    {t('generate.button')}
                                </>
                            )
                        )}
                    </Button>
                    <Counter
                        value={batchCount}
                        onChange={setBatchCount}
                        min={1}
                        max={9999}
                        fontSize={16}
                    />
                </div>
            </div>
        </div>
    )
}

function TokenCountOverlay({ count }: { count: number }) {
    const exceeded = count > 512
    return (
        <span className={cn(
            "pointer-events-none absolute bottom-2 right-3 z-[1] rounded border px-1.5 py-0.5 font-mono text-[10px] shadow-sm backdrop-blur-sm",
            exceeded
                ? "border-destructive/70 bg-destructive/90 text-destructive-foreground"
                : "border-border/60 bg-background/70 text-muted-foreground"
        )}>
            {count}/512
        </span>
    )
}
