import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { NAIMetadata, parseMetadataFromFile, parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { usePresetStore } from '@/stores/preset-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/components/ui/use-toast'
import { FileImage, Download, AlertCircle } from 'lucide-react'
import { useCharacterStore } from '@/stores/character-store'

interface MetadataDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    initialImage?: string // base64 data URL
}

interface LoadOptions {
    prompts: boolean
    parameters: boolean
    resolution: boolean
    seed: boolean
    characterPrompts: boolean
    vibeTransfer: boolean
}

export function MetadataDialog({ open, onOpenChange, initialImage }: MetadataDialogProps) {
    const { t } = useTranslation()
    const { presets, activePresetId, loadPreset, syncFromGenerationStore } = usePresetStore()
    const genStore = useGenerationStore()
    const charStore = useCharacterPromptStore()
    const alwaysAddCharacters = useSettingsStore(state => state.expertMetadataAlwaysAddCharacters)
    const referenceStore = useCharacterStore()

    const [metadata, setMetadata] = useState<NAIMetadata | null>(null)
    const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [selectedPresetId, setSelectedPresetId] = useState<string>(activePresetId || 'default')
    const [loadOptions, setLoadOptions] = useState<LoadOptions>({
        prompts: true,
        parameters: true,
        resolution: true,
        seed: true,
        characterPrompts: true,
        vibeTransfer: true,
    })
    const [isDragOver, setIsDragOver] = useState(false)

    useEffect(() => {
        if (!open) return
        const presetState = usePresetStore.getState()
        const targetPresetId = presetState.presets.some(preset => preset.id === presetState.activePresetId)
            ? presetState.activePresetId
            : presetState.presets[0]?.id || 'default'
        setSelectedPresetId(targetPresetId)
    }, [open])

    // Load metadata from initial image when dialog opens with an image
    useEffect(() => {
        if (open && initialImage) {
            setImageDataUrl(initialImage)
            loadFromBase64(initialImage)
        }
        // Reset when dialog closes
        if (!open) {
            setMetadata(null)
            setImageDataUrl(null)
        }
    }, [open, initialImage])

    const loadFromBase64 = async (base64: string) => {
        setIsLoading(true)
        try {
            const meta = await parseMetadataFromBase64(base64)
            setMetadata(meta)
            if (!meta) {
                toast({
                    title: t('metadata.noData', '메타데이터 없음'),
                    description: t('metadata.noDataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다.'),
                    variant: 'destructive',
                })
            }
        } catch (error) {
            console.error('Failed to load metadata:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleFileDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)

        const file = e.dataTransfer.files[0]
        if (!file || !file.type.startsWith('image/')) {
            toast({
                title: t('metadata.invalidFile', '잘못된 파일'),
                description: t('metadata.invalidFileDesc', 'PNG 이미지 파일만 지원합니다.'),
                variant: 'destructive',
            })
            return
        }

        setIsLoading(true)
        try {
            // Read file as data URL for preview
            const reader = new FileReader()
            reader.onload = async () => {
                const dataUrl = reader.result as string
                setImageDataUrl(dataUrl)

                // Parse metadata
                const meta = await parseMetadataFromFile(file)
                setMetadata(meta)
                if (!meta) {
                    toast({
                        title: t('metadata.noData', '메타데이터 없음'),
                        description: t('metadata.noDataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다.'),
                        variant: 'destructive',
                    })
                }
                setIsLoading(false)
            }
            reader.readAsDataURL(file)
        } catch (error) {
            console.error('Failed to parse file:', error)
            setIsLoading(false)
        }
    }, [t])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragOver(false)
    }

    const handleApply = async () => {
        if (!metadata) return

        // First, load the target preset
        if (selectedPresetId !== activePresetId) {
            loadPreset(selectedPresetId)
        }

        // Apply selected metadata to generation store
        if (loadOptions.prompts) {
            if (metadata.promptParts) {
                // NAIS2-generated image: restore each section separately.
                genStore.setBasePrompt(metadata.promptParts.base)
                genStore.setAdditionalPrompt(metadata.promptParts.additional)
                genStore.setDetailPrompt(metadata.promptParts.detail)
                if (metadata.promptParts.inpainting !== undefined) {
                    genStore.setInpaintingPrompt(metadata.promptParts.inpainting)
                }
                if (metadata.promptParts.negative !== undefined) {
                    genStore.setNegativePrompt(metadata.promptParts.negative)
                }
            } else if (metadata.prompt) {
                // External image: merged prompt lands in basePrompt (fallback).
                genStore.setBasePrompt(metadata.prompt)
            }
            // V4 negative prompt has priority over legacy uc when not already set
            // by promptParts above.
            if (!metadata.promptParts?.negative) {
                if (metadata.v4_negative_prompt?.caption?.base_caption) {
                    genStore.setNegativePrompt(metadata.v4_negative_prompt.caption.base_caption)
                } else if (metadata.negativePrompt) {
                    genStore.setNegativePrompt(metadata.negativePrompt)
                }
            }
        }

        if (loadOptions.parameters) {
            if (metadata.steps) genStore.setSteps(metadata.steps)
            if (metadata.cfgScale) genStore.setCfgScale(metadata.cfgScale)
            if (metadata.cfgRescale) genStore.setCfgRescale(metadata.cfgRescale)
            if (metadata.sampler) genStore.setSampler(metadata.sampler)
            if (metadata.scheduler) genStore.setScheduler(metadata.scheduler)
            if (typeof metadata.smea === 'boolean') genStore.setSmea(metadata.smea)
            if (typeof metadata.smeaDyn === 'boolean') genStore.setSmeaDyn(metadata.smeaDyn)
            if (typeof metadata.variety === 'boolean') genStore.setVariety(metadata.variety)
            if (typeof metadata.qualityToggle === 'boolean') genStore.setQualityToggle(metadata.qualityToggle)
            if (typeof metadata.ucPreset === 'number') genStore.setUcPreset(metadata.ucPreset)
        }

        if (loadOptions.resolution && metadata.width && metadata.height) {
            genStore.setSelectedResolution({
                label: `${metadata.width}x${metadata.height}`,
                width: metadata.width,
                height: metadata.height,
            })
        }

        if (loadOptions.seed && metadata.seed) {
            genStore.setSeed(metadata.seed)
            genStore.setSeedLocked(true)
        }

        if (loadOptions.characterPrompts) {
            const sourceCharacters = metadata.generationSources?.characterPrompts
            if (sourceCharacters) {
                const generationSources = metadata.generationSources
                // Restore the stage entries used by this Forge image instead of
                // creating duplicate cards from V4 captions.
                charStore.disableAll()
                for (const source of sourceCharacters) {
                    const existing = alwaysAddCharacters ? undefined : charStore.characters.find(character =>
                        character.name === source.name
                        && character.prompt === source.prompt
                        && character.negative === source.negative
                        && character.promptEnabled === source.promptEnabled
                        && character.negativeEnabled === source.negativeEnabled
                        && character.costumeEnabled === source.costumeEnabled
                    )
                    if (existing) {
                        charStore.updateCharacter(existing.id, { enabled: true })
                        continue
                    }

                    const presetId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                    charStore.addPreset({
                        id: presetId,
                        name: source.name || `Imported ${charStore.presets.length + 1}`,
                        prompt: source.prompt,
                        negative: source.negative,
                    })
                    charStore.addCharacter({
                        presetId,
                        name: source.name,
                        prompt: source.prompt,
                        negative: source.negative,
                        promptEnabled: source.promptEnabled,
                        negativeEnabled: source.negativeEnabled,
                        costumeEnabled: source.costumeEnabled,
                        position: source.position,
                        enabled: true,
                    })
                }
                if (typeof generationSources?.characterPositionEnabled === 'boolean') {
                    charStore.setPositionEnabled(generationSources.characterPositionEnabled)
                }
            } else if (metadata.v4_prompt?.caption?.char_captions) {
                // Legacy / external image fallback: recreate characters from NAI captions.
                const negativeCharCaptions = metadata.v4_negative_prompt?.caption?.char_captions || []
                metadata.v4_prompt.caption.char_captions.forEach((cap, index) => {
                    const presetId = `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
                    const charNegative = negativeCharCaptions[index]?.char_caption || ''
                    charStore.addPreset({ id: presetId, name: `Imported ${index + 1}`, prompt: cap.char_caption, negative: charNegative })
                    cap.centers.forEach(center => {
                        charStore.addCharacter({ presetId, prompt: cap.char_caption, negative: charNegative, position: center, enabled: true })
                    })
                })
            }
        }

        if (loadOptions.vibeTransfer) {
            const sources = metadata.generationSources
            if (sources) {
                // Original reference images never leave local storage. Match by
                // stable local ID and restore only the settings used to generate.
                referenceStore.disableAllReferenceImages('character')
                referenceStore.disableAllReferenceImages('vibe')

                for (const source of sources.characterReferences) {
                    const existing = referenceStore.characterImages.find(image => image.id === source.id)
                    if (existing) referenceStore.updateCharacterImage(existing.id, { ...source, enabled: true })
                }

                const restoredVibeIds = new Set<string>()
                for (const source of sources.vibeReferences) {
                    const existing = referenceStore.vibeImages.find(image => image.id === source.id)
                    if (!existing) continue
                    restoredVibeIds.add(source.id)
                    referenceStore.updateVibeImage(existing.id, { ...source, enabled: true })
                }

                // Missing Vibe originals can still use NAI's encoded payload.
                for (let index = 0; index < sources.vibeReferences.length; index++) {
                    const source = sources.vibeReferences[index]
                    if (restoredVibeIds.has(source.id)) continue
                    const encoded = metadata.encodedVibes?.[index]
                    if (!encoded) continue
                    await referenceStore.addVibeImage('', encoded, source.informationExtracted, source.strength, source.name)
                }
            } else if (metadata.encodedVibes && metadata.encodedVibes.length > 0) {
                // Legacy / external image fallback: only encoded Vibe data is available.
                const infos = metadata.vibeTransferInfo || []
                for (const [index, encoded] of metadata.encodedVibes.entries()) {
                    await referenceStore.addVibeImage('', encoded, infos[index]?.informationExtracted ?? 1.0, infos[index]?.strength ?? 0.6)
                }
            }
        }

        // Save to preset
        syncFromGenerationStore()

        toast({
            title: t('metadata.applied', '메타데이터 적용됨'),
            description: t('metadata.appliedDesc', '선택한 설정이 프리셋에 적용되었습니다.'),
            variant: 'success',
        })

        onOpenChange(false)
    }

    const toggleOption = (key: keyof LoadOptions) => {
        setLoadOptions(prev => ({ ...prev, [key]: !prev[key] }))
    }

    const allSelected = Object.values(loadOptions).every(v => v)
    const toggleAll = () => {
        const newValue = !allSelected
        setLoadOptions({
            prompts: newValue,
            parameters: newValue,
            resolution: newValue,
            seed: newValue,
            characterPrompts: newValue,
            vibeTransfer: newValue,
        })
    }

    const resetAndLoadAnother = () => {
        setMetadata(null)
        setImageDataUrl(null)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileImage className="h-5 w-5" />
                        {t('metadata.title', '메타데이터 불러오기')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('metadata.description', '이미지에서 생성 설정을 추출하여 프리셋에 적용합니다.')}
                    </DialogDescription>
                </DialogHeader>

                {!metadata ? (
                    // Drop zone
                    <div
                        className={`
                            border-2 border-dashed rounded-xl p-12 text-center transition-colors
                            ${isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}
                            ${isLoading ? 'opacity-50' : 'cursor-pointer hover:border-primary/50'}
                        `}
                        onDrop={handleFileDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                    >
                        <Download className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-base font-medium mb-2">
                            {isLoading ? t('metadata.loading', '불러오는 중...') : t('metadata.dropHere', '이미지를 여기에 드롭하세요')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                            {t('metadata.dropDesc', 'PNG 파일에서 메타데이터를 추출합니다')}
                        </p>
                    </div>
                ) : (
                    // Two-column layout: Image | Info
                    <div className="flex gap-4 min-h-0 flex-1 overflow-hidden">
                        {/* Left: Image Preview */}
                        <div className="w-1/3 flex-shrink-0">
                            {imageDataUrl && (
                                <div className="rounded-xl overflow-hidden bg-muted/30 border">
                                    <img
                                        src={imageDataUrl}
                                        alt="Preview"
                                        className="w-full h-auto object-contain max-h-[400px]"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Right: Metadata Info */}
                        <div className="flex-1 flex flex-col min-h-0 min-w-0">
                            <ScrollArea className="flex-1 pr-2">
                                <div className="space-y-4">
                                    {/* Prompt */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-prompts"
                                                checked={loadOptions.prompts}
                                                onCheckedChange={() => toggleOption('prompts')}
                                            />
                                            <Label htmlFor="opt-prompts" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optPrompts', '프롬프트')}
                                            </Label>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs font-medium text-muted-foreground">
                                                Positive Prompt
                                            </Label>
                                            <Textarea
                                                value={metadata.prompt || ''}
                                                readOnly
                                                className="text-xs resize-none h-48 bg-muted/30 cursor-text select-text"
                                                placeholder="No prompt found"
                                            />
                                        </div>
                                    </div>

                                    {/* Negative Prompt */}
                                    {(metadata.negativePrompt || metadata.v4_negative_prompt?.caption?.base_caption) && (
                                        <div className="space-y-1">
                                            <Label className="text-xs font-medium text-muted-foreground">
                                                Negative Prompt
                                            </Label>
                                            <Textarea
                                                value={metadata.v4_negative_prompt?.caption?.base_caption || metadata.negativePrompt || ''}
                                                readOnly
                                                className="text-xs resize-none h-24 bg-muted/30 cursor-text select-text"
                                            />
                                        </div>
                                    )}

                                    <Separator />

                                    {/* Parameters */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-params"
                                                checked={loadOptions.parameters}
                                                onCheckedChange={() => toggleOption('parameters')}
                                            />
                                            <Label htmlFor="opt-params" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optParams', '파라미터')}
                                            </Label>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 text-xs">
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">Steps:</span>
                                                <span className="ml-1 font-medium">{metadata.steps || '-'}</span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2" title="Prompt Guidance (API: scale)">
                                                <span className="text-muted-foreground">Guidance:</span>
                                                <span className="ml-1 font-medium">{metadata.cfgScale || '-'}</span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2" title="Prompt Guidance Rescale (API: cfg_rescale)">
                                                <span className="text-muted-foreground">Rescale:</span>
                                                <span className="ml-1 font-medium">{metadata.cfgRescale ?? '-'}</span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">Sampler:</span>
                                                <span className="ml-1 font-medium">{metadata.sampler || '-'}</span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">SMEA:</span>
                                                <span className="ml-1 font-medium">
                                                    {metadata.smea ? 'ON' : 'OFF'}
                                                    {metadata.smeaDyn ? ' (DYN)' : ''}
                                                </span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">Variety:</span>
                                                <span className="ml-1 font-medium">
                                                    {metadata.variety ? '+58' : 'OFF'}
                                                </span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">Quality Tags:</span>
                                                <span className="ml-1 font-medium">
                                                    {typeof metadata.qualityToggle === 'boolean'
                                                        ? (metadata.qualityToggle ? 'ON' : 'OFF')
                                                        : '-'}
                                                </span>
                                            </div>
                                            <div className="bg-muted/30 rounded-lg p-2">
                                                <span className="text-muted-foreground">UC Preset:</span>
                                                <span className="ml-1 font-medium">
                                                    {metadata.ucPreset === 0 ? 'Heavy' :
                                                        metadata.ucPreset === 1 ? 'Light' :
                                                            metadata.ucPreset === 2 ? 'Furry' :
                                                                metadata.ucPreset === 3 ? 'Human' :
                                                                    metadata.ucPreset === 4 ? 'None' : '-'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Resolution */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-resolution"
                                                checked={loadOptions.resolution}
                                                onCheckedChange={() => toggleOption('resolution')}
                                            />
                                            <Label htmlFor="opt-resolution" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optResolution', '해상도')}
                                            </Label>
                                            <span className="text-sm text-muted-foreground ml-auto">
                                                {metadata.width && metadata.height
                                                    ? `${metadata.width} × ${metadata.height}`
                                                    : '-'
                                                }
                                            </span>
                                        </div>
                                    </div>

                                    {/* Seed */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Checkbox
                                                id="opt-seed"
                                                checked={loadOptions.seed}
                                                onCheckedChange={() => toggleOption('seed')}
                                            />
                                            <Label htmlFor="opt-seed" className="text-sm font-medium cursor-pointer">
                                                {t('metadata.optSeed', '시드')}
                                            </Label>
                                            <span className="text-sm font-mono text-muted-foreground ml-auto">
                                                {metadata.seed || '-'}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Character Prompts */}
                                    {((metadata.generationSources?.characterPrompts.length ?? 0) > 0 || (metadata.v4_prompt?.caption?.char_captions?.length ?? 0) > 0) && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="opt-char-prompts"
                                                    checked={loadOptions.characterPrompts}
                                                    onCheckedChange={() => toggleOption('characterPrompts')}
                                                />
                                                <Label htmlFor="opt-char-prompts" className="text-sm font-medium cursor-pointer">
                                                    {t('metadata.optCharPrompts', '캐릭터 프롬프트')}
                                                </Label>
                                            </div>
                                            <div className="pl-6 space-y-1">
                                                {metadata.generationSources?.characterPrompts.map((source, idx) => (
                                                    <div key={source.id} className="bg-muted/30 rounded-lg p-2 text-xs">
                                                        <div className="font-medium text-muted-foreground">
                                                            {source.name || `#${idx + 1}`}
                                                        </div>
                                                    </div>
                                                ))}
                                                {!metadata.generationSources?.characterPrompts.length && metadata.v4_prompt?.caption?.char_captions?.map((cap, idx) => (
                                                    <div key={idx} className="bg-muted/30 rounded-lg p-2 text-xs">
                                                        <div className="font-medium text-muted-foreground mb-1">
                                                            Pos: {cap.centers.map(c => `(${c.x.toFixed(2)}, ${c.y.toFixed(2)})`).join(', ')}
                                                        </div>
                                                        <Textarea
                                                            value={cap.char_caption}
                                                            readOnly
                                                            className="text-xs resize-none h-20 bg-transparent border-0 p-0 focus-visible:ring-0 cursor-text select-text"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Warnings / Vibe Transfer Info */}
                                    {(metadata.hasVibeTransfer || metadata.hasCharacterReference || (metadata.generationSources?.characterReferences.length ?? 0) > 0 || (metadata.generationSources?.vibeReferences.length ?? 0) > 0) && (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="opt-vibe"
                                                    checked={loadOptions.vibeTransfer}
                                                    onCheckedChange={() => toggleOption('vibeTransfer')}
                                                />
                                                <Label htmlFor="opt-vibe" className="text-sm font-medium cursor-pointer">
                                                    {t('metadata.optReferences', '이미지 참조')}
                                                </Label>
                                            </div>
                                            <p className="text-xs text-muted-foreground pl-6">
                                                {t('metadata.referencesDesc', '저장된 레퍼런스와 바이브를 다시 활성화합니다. 없는 바이브는 데이터 복원으로 처리합니다.')}
                                            </p>
                                        </div>
                                    )}

                                    {metadata.hasCharacterReference && !metadata.generationSources && (
                                        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                                            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                                            <p className="text-xs text-amber-600 dark:text-amber-400">
                                                {t('metadata.charRefWarning', 'Character Reference detected. Extraction supported via Director Tools.')}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>

                            <Separator className="my-3" />

                            {/* Bottom Actions */}
                            <div className="space-y-3">
                                {/* Preset selector */}
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm whitespace-nowrap">{t('metadata.targetPreset', '적용할 프리셋')}</Label>
                                    <Select value={selectedPresetId} onValueChange={setSelectedPresetId}>
                                        <SelectTrigger className="flex-1 h-9">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {presets.map(preset => (
                                                <SelectItem key={preset.id} value={preset.id}>
                                                    {preset.isDefault ? t('preset.default', '기본') : preset.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Action buttons */}
                                <div className="flex gap-2">
                                    <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs">
                                        {allSelected ? t('metadata.deselectAll', '전체 해제') : t('metadata.selectAll', '전체 선택')}
                                    </Button>
                                    <div className="flex-1" />
                                    <Button variant="outline" size="sm" onClick={resetAndLoadAnother}>
                                        {t('metadata.loadAnother', '다른 이미지')}
                                    </Button>
                                    <Button size="sm" onClick={handleApply}>
                                        {t('metadata.apply', '적용')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
