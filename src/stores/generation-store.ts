import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { useAuthStore } from './auth-store'
import { useSettingsStore } from './settings-store'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { writeFile, mkdir, exists, BaseDirectory } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { useCharacterStore } from './character-store'
import { useCharacterPromptStore } from './character-prompt-store'
import { processWildcards } from '@/lib/fragment-processor'
import { removePromptComments } from '@/lib/prompt-comments'
import { getRandomCharacterCandidates, pickRandomCharacters } from '@/lib/random-character-selection'
import i18n from '@/i18n'
import { toast } from '@/components/ui/use-toast'

interface Resolution {
    label: string
    width: number
    height: number
}

export const AVAILABLE_MODELS = [
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated' },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full' },
    { id: 'nai-diffusion-3', name: 'NAI Diffusion V3 (Anime)' },
    { id: 'nai-diffusion-furry-3', name: 'NAI Diffusion Furry V3' },
] as const

interface GenerationState {
    // Prompt fields
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    inpaintingPrompt: string

    // Model selection
    model: string

    // Generation settings
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean

    seed: number
    activeImageSeed: number | null
    previewSeed: number | null
    seedLocked: boolean
    selectedResolution: Resolution

    // Quality settings
    qualityToggle: boolean
    ucPreset: number

    // Batch generation
    batchCount: number
    currentBatch: number

    // I2I & Inpainting
    sourceImage: string | null
    strength: number
    noise: number
    mask: string | null
    i2iMode: 'i2i' | 'inpaint' | null

    // Timing
    lastGenerationTime: number | null  // ms
    estimatedTime: number | null

    // State
    isGenerating: boolean // Deprecated in favor of generatingMode check? Or keep for local main mode state?
    generatingMode: 'main' | 'scene' | null
    isCancelled: boolean
    previewImage: string | null

    // AbortController for cancellation
    abortController: AbortController | null

    // Generation session ID (to handle race conditions on cancel/restart)
    generationSessionId: number

    // Streaming progress (0-100)
    streamProgress: number

    // Actions
    setBasePrompt: (prompt: string) => void
    setAdditionalPrompt: (prompt: string) => void
    setDetailPrompt: (prompt: string) => void
    setNegativePrompt: (prompt: string) => void
    setInpaintingPrompt: (prompt: string) => void

    setModel: (model: string) => void
    setSteps: (steps: number) => void
    setCfgScale: (v: number) => void
    setCfgRescale: (v: number) => void
    setSampler: (v: string) => void
    setScheduler: (v: string) => void
    setSmea: (v: boolean) => void
    setSmeaDyn: (v: boolean) => void
    setVariety: (v: boolean) => void

    setSeed: (seed: number) => void
    setActiveImageSeed: (seed: number | null) => void
    setPreviewSeed: (seed: number | null) => void
    setSeedLocked: (locked: boolean) => void
    setSelectedResolution: (resolution: Resolution) => void
    setQualityToggle: (v: boolean) => void
    setUcPreset: (v: number) => void

    setBatchCount: (count: number) => void

    // I2I Actions
    setSourceImage: (img: string | null) => void
    setReferenceImage: (img: string | null) => void
    setStrength: (v: number) => void
    setNoise: (v: number) => void
    setMask: (mask: string | null) => void
    setI2IMode: (mode: 'i2i' | 'inpaint' | null) => void
    resetI2IParams: () => void

    // Batch update for preset loading (avoids multiple IndexedDB writes)
    applyPreset: (preset: {
        basePrompt: string
        additionalPrompt: string
        detailPrompt: string
        negativePrompt: string
        model: string
        steps: number
        cfgScale: number
        cfgRescale: number
        sampler: string
        scheduler: string
        smea: boolean
        smeaDyn: boolean
        variety?: boolean
        qualityToggle?: boolean
        ucPreset?: number
        selectedResolution: Resolution
    }) => void

    generate: () => Promise<void>
    cancelGeneration: () => void
    setPreviewImage: (url: string | null) => void
    setIsGenerating: (v: boolean) => void // Only for Main Mode use ideally
    setGeneratingMode: (mode: 'main' | 'scene' | null) => void
    setStreamProgress: (progress: number) => void
    
    // Memory cleanup - call when leaving main mode to release large Base64 data
    clearRuntimeData: () => void
}

export const useGenerationStore = create<GenerationState>()(
    persist(
        (set, get) => ({
            // Initial state
            basePrompt: '',
            additionalPrompt: '',
            detailPrompt: '',
            negativePrompt: '',
            inpaintingPrompt: '',

            model: 'nai-diffusion-4-5-full',

            steps: 28,
            cfgScale: 5.0,
            cfgRescale: 0.0,
            sampler: 'k_euler_ancestral',
            scheduler: 'karras',
            smea: true,
            smeaDyn: true,
            variety: false,

            seed: Math.floor(Math.random() * 4294967295),
            activeImageSeed: null,
            previewSeed: null,
            seedLocked: false,
            selectedResolution: { label: 'Portrait', width: 832, height: 1216 },

            qualityToggle: true,
            ucPreset: 0,

            batchCount: 1,
            currentBatch: 0,

            // I2I Init
            sourceImage: null,
            strength: 0.7,
            noise: 0.0,
            mask: null,
            i2iMode: null,

            lastGenerationTime: null,
            estimatedTime: null,

            isGenerating: false,
            generatingMode: null,
            isCancelled: false,
            previewImage: null,
            abortController: null,
            generationSessionId: 0,
            streamProgress: 0,

            // Actions
            setBasePrompt: (prompt) => set({ basePrompt: prompt }),
            setAdditionalPrompt: (prompt) => set({ additionalPrompt: prompt }),
            setDetailPrompt: (prompt) => set({ detailPrompt: prompt }),
            setNegativePrompt: (prompt) => set({ negativePrompt: prompt }),
            setInpaintingPrompt: (prompt) => set({ inpaintingPrompt: prompt }),

            setModel: (model) => set({ model }),
            setSteps: (steps) => set({ steps }),
            setCfgScale: (cfgScale) => set({ cfgScale }),
            setCfgRescale: (cfgRescale) => set({ cfgRescale }),
            setSampler: (sampler) => set({ sampler }),

            // Batch update - single IndexedDB write instead of 16 separate writes
            applyPreset: (preset) => set({
                basePrompt: preset.basePrompt,
                additionalPrompt: preset.additionalPrompt,
                detailPrompt: preset.detailPrompt,
                negativePrompt: preset.negativePrompt,
                model: preset.model,
                steps: preset.steps,
                cfgScale: preset.cfgScale,
                cfgRescale: preset.cfgRescale,
                sampler: preset.sampler,
                scheduler: preset.scheduler,
                smea: preset.smea,
                smeaDyn: preset.smeaDyn,
                variety: preset.variety ?? false,
                qualityToggle: preset.qualityToggle ?? true,
                ucPreset: preset.ucPreset ?? 0,
                selectedResolution: preset.selectedResolution,
            }),
            setScheduler: (scheduler) => set({ scheduler }),
            setSmea: (smea) => set({ smea }),
            setSmeaDyn: (smeaDyn) => set({ smeaDyn }),
            setVariety: (variety) => set({ variety }),

            setSeed: (seed) => set({ seed }),
            setActiveImageSeed: (activeImageSeed) => set({ activeImageSeed }),
            setPreviewSeed: (previewSeed) => set({ previewSeed }),
            setSeedLocked: (locked) => set({ seedLocked: locked }),
            setSelectedResolution: (resolution) => set({ selectedResolution: resolution }),
            setQualityToggle: (qualityToggle) => set({ qualityToggle }),
            setUcPreset: (ucPreset) => set({ ucPreset }),

            setBatchCount: (count) => set({ batchCount: count }),

            setSourceImage: (img) => set({ sourceImage: img }),
            setReferenceImage: (img) => set({ sourceImage: img }), // Alias for now
            setStrength: (v) => set({ strength: v }),
            setNoise: (v) => set({ noise: v }),
            setMask: (mask) => set({ mask }),
            setI2IMode: (mode) => set(mode === 'i2i'
                ? { i2iMode: mode, mask: null, inpaintingPrompt: '' }
                : { i2iMode: mode }),
            resetI2IParams: () => set({ sourceImage: null, mask: null, strength: 0.7, noise: 0.0, inpaintingPrompt: '', i2iMode: null }),

            // Memory cleanup - release large runtime data (previewImage, sourceImage, mask)
            // Call this when leaving main mode to prevent OOM
            clearRuntimeData: () => {
                console.log('[GenerationStore] Clearing runtime data to free memory')
                set({ 
                    previewImage: null, 
                    sourceImage: null, 
                    mask: null,
                    streamProgress: 0
                })
            },

            cancelGeneration: () => {
                const { abortController } = get()
                if (abortController) {
                    abortController.abort()
                }
                // Keep the seed unchanged on cancel so the current/streamed image can be retried.
                // The finally block in generate() will set isGenerating=false
                set({ 
                    isCancelled: true, 
                    // isGenerating stays true - button remains locked until API response arrives
                    currentBatch: 0,
                })
                toast({
                    title: i18n.t('toast.generationCancelled.title'),
                    description: i18n.t('toast.generationCancelled.desc'),
                })
            },

            generate: async () => {
                const {
                    basePrompt, additionalPrompt, detailPrompt, negativePrompt, inpaintingPrompt,
                    model, steps, cfgScale, cfgRescale, sampler, scheduler, smea, smeaDyn, variety,
                    selectedResolution, batchCount, lastGenerationTime,
                    sourceImage, strength, noise, mask
                } = get()

                const token = useAuthStore.getState().token
                const isVerified = useAuthStore.getState().isVerified

                if (!token || !isVerified) {
                    toast({
                        title: i18n.t('toast.tokenRequired.title'),
                        description: i18n.t('toast.tokenRequired.desc'),
                        variant: 'destructive',
                    })
                    return
                }

                // Check for cross-mode conflict
                if (get().generatingMode === 'scene') {
                    toast({
                        title: i18n.t('common.error'),
                        description: i18n.t('generate.conflictScene', '씬 모드에서 생성 중입니다.'),
                        variant: 'destructive',
                    })
                    return
                }

                // Create new AbortController and session ID
                const abortController = new AbortController()
                const sessionId = Date.now()
                
                // MEMORY: Clear previous preview image before starting new generation
                // This helps GC reclaim the previous base64 data (~3-5MB per image)
                set({
                    isGenerating: true,
                    generatingMode: 'main',
                    isCancelled: false,
                    abortController,
                    generationSessionId: sessionId,
                    estimatedTime: lastGenerationTime ? lastGenerationTime * batchCount : null,
                    previewImage: null, // Clear previous preview to free memory
                    previewSeed: null, // A history preview seed must not label a new generation.
                    streamProgress: 0,  // Reset streaming progress
                })

                try {
                    for (let i = 0; i < batchCount; i++) {
                        // Check if cancelled or session changed (race condition protection)
                        if (get().isCancelled || get().generationSessionId !== sessionId) {
                            console.log('[Generate] Session invalidated, stopping batch loop')
                            break
                        }

                        set({ currentBatch: i + 1 })

                        const startTime = Date.now()

                        // Fix the seed before any asynchronous preparation so the streaming image,
                        // seed display, and API request always refer to the same value.
                        const lockedSeed = get().seed
                        const currentSeed = get().seedLocked && lockedSeed !== 0
                            ? lockedSeed
                            : Math.floor(Math.random() * 4294967295)
                        set({ seed: currentSeed, activeImageSeed: currentSeed })
                        
                        let finalPrompt = [
                            removePromptComments(basePrompt),
                            removePromptComments(inpaintingPrompt),
                            removePromptComments(additionalPrompt),
                            removePromptComments(detailPrompt)
                        ].filter(Boolean).join(', ')

                        // Fragment Substitution - use processWildcards which handles <filename> syntax
                        // Wildcard Processing (handles both <filename> fragments and (a/b/c) random selection) - async
                        finalPrompt = await processWildcards(finalPrompt)

                        if (get().isCancelled || get().generationSessionId !== sessionId) break

                        const { characterImages: allCharImages, vibeImages: allVibeImages } = useCharacterStore.getState()
                        const characterImages = allCharImages.filter(img => img.enabled !== false && (img.filePath || img.base64 || img.cacheKey))
                        const vibeImages = allVibeImages.filter(img => img.enabled !== false && (img.filePath || img.base64 || img.encodedVibe || img.encodedVibePath))

                        // Character Prompts (Position-based)
                        const {
                            characters: characterPrompts,
                            groups: characterGroups,
                            positionEnabled,
                        } = useCharacterPromptStore.getState()
                        const randomSettings = useSettingsStore.getState()
                        const randomCharacterCandidates = randomSettings.expertSceneRandomCharactersEnabled
                            && randomSettings.sceneRandomCharactersActive
                            ? getRandomCharacterCandidates(
                                characterPrompts,
                                characterGroups,
                                randomSettings.sceneRandomCharacterMode,
                                randomSettings.sceneRandomCharacterIds,
                                randomSettings.sceneRandomCharacterGroupIds,
                            )
                            : []
                        const randomCharacterIds = randomCharacterCandidates.length > 0
                            ? new Set(pickRandomCharacters(
                                randomCharacterCandidates,
                                randomSettings.sceneRandomCharacterCount,
                            ).map(character => character.id))
                            : null
                        const characterPromptsForGeneration = randomCharacterIds
                            ? characterPrompts.filter(character => randomCharacterIds.has(character.id))
                            : characterPrompts.filter(character => character.enabled)


                        const splitCharacterCostumePrompt = (prompt: string) => {
                            const normalized = prompt.replace(/\r\n/g, '\n')
                            const marker = '#!-\uc758\uc0c1\ud504\ub86c'
                            const index = normalized.indexOf(marker)
                            if (index === -1) return { characterPrompt: prompt, costumePrompt: '' }
                            return {
                                characterPrompt: normalized.slice(0, index).replace(/\n+$/g, ''),
                                costumePrompt: normalized.slice(index + marker.length).replace(/^\n+/g, ''),
                            }
                        }

                        const buildCharacterPromptForGeneration = (char: typeof characterPrompts[number]) => {
                            const { expertCharacterPromptLayoutEnabled } = useSettingsStore.getState()
                            const { characterPrompt, costumePrompt } = splitCharacterCostumePrompt(char.prompt)
                            if (!expertCharacterPromptLayoutEnabled) {
                                return [characterPrompt, costumePrompt].filter(part => part.trim()).join('\n')
                            }
                            const parts: string[] = []
                            if (char.promptEnabled !== false && characterPrompt.trim()) parts.push(characterPrompt)
                            if (char.costumeEnabled !== false && costumePrompt.trim()) parts.push(costumePrompt)
                            return parts.join('\n')
                        }

                        // Apply fragment/wildcard substitution to character prompts (async)
                        const processedCharacterPrompts = await Promise.all(
                            characterPromptsForGeneration.map(async c => {
                                const characterPrompt = removePromptComments(buildCharacterPromptForGeneration(c))
                                const characterNegative = useSettingsStore.getState().expertCharacterPromptLayoutEnabled && c.negativeEnabled === false
                                    ? ''
                                    : removePromptComments(c.negative)
                                const processedPrompt = await processWildcards(characterPrompt)
                                const processedNegative = await processWildcards(characterNegative)
                                return {
                                    ...c,
                                    prompt: processedPrompt,
                                    negative: processedNegative,
                                    enabled: true,
                                }
                            })
                        )

                        // Check if streaming is enabled and get image format
                        const { useStreaming, imageFormat } = useSettingsStore.getState()

                        // Helper function to round to nearest multiple of 64 (NovelAI requirement)
                        const roundTo64 = (value: number): number => Math.round(value / 64) * 64

                        // For I2I and Inpainting, use source image dimensions instead of global resolution
                        let finalWidth = roundTo64(selectedResolution.width)
                        let finalHeight = roundTo64(selectedResolution.height)

                        if (sourceImage) {
                            // Extract dimensions from base64 image
                            try {
                                const img = new Image()
                                await new Promise<void>((resolve, reject) => {
                                    img.onload = () => resolve()
                                    img.onerror = () => reject(new Error('Failed to load source image'))
                                    img.src = sourceImage
                                })
                                // Round source image dimensions to multiples of 64
                                finalWidth = roundTo64(img.width)
                                finalHeight = roundTo64(img.height)
                                console.log(`[Generate] Using source image dimensions: ${img.width}x${img.height} → ${finalWidth}x${finalHeight}`)
                                // MEMORY: Clear image reference
                                img.src = ''
                            } catch (e) {
                                console.warn('[Generate] Failed to get source image dimensions, using global resolution')
                            }
                        }

                        const generationParams = {
                            prompt: finalPrompt,
                            negative_prompt: removePromptComments(negativePrompt),
                            model,
                            width: finalWidth,
                            height: finalHeight,
                            steps,
                            cfg_scale: cfgScale,
                            cfg_rescale: cfgRescale,
                            sampler,
                            scheduler,
                            smea,
                            smea_dyn: smeaDyn,
                            variety,
                            seed: currentSeed,

                            // I2I & Inpainting
                            sourceImage: sourceImage || undefined,
                            strength,
                            noise,
                            mask: mask || undefined,

                            // File-backed originals are read and transferred by Rust.
                            charImages: characterImages.map(img => img.base64 || ''),
                            charImagePaths: characterImages.map(img => img.filePath || null),
                            charStrength: characterImages.map(img => img.strength),
                            charFidelity: characterImages.map(img => img.fidelity ?? 0.6),
                            charReferenceType: characterImages.map(img => img.referenceType ?? 'character&style'),
                            charCacheKeys: characterImages.map(img => img.cacheKey || null),

                            vibeImages: vibeImages.map(img => img.base64 || ''),
                            vibeImagePaths: vibeImages.map(img => img.filePath || null),
                            vibeEncodedPaths: vibeImages.map(img => img.encodedVibePath || null),
                            vibeInfo: vibeImages.map(img => img.informationExtracted),
                            vibeStrength: vibeImages.map(img => img.strength),
                            preEncodedVibes: vibeImages.map(img => img.encodedVibe || null),

                            // Character Prompts (V4 char_captions with positions)
                            characterPrompts: processedCharacterPrompts,
                            characterPositionEnabled: positionEnabled,

                            // Image format (PNG or WebP)
                            imageFormat,

                            // NAI UI options (Quality Tags & UC Preset)
                            qualityToggle: get().qualityToggle,
                            ucPreset: get().ucPreset,

                            // Original prompt parts (pre-merge). Embedded into the image
                            // as nais2-params so re-importing restores each section instead
                            // of dumping everything into basePrompt.
                            promptParts: {
                                base: basePrompt,
                                additional: additionalPrompt,
                                detail: detailPrompt,
                                negative: negativePrompt,
                                inpainting: inpaintingPrompt,
                            },
                        }

                        // Reset progress
                        set({ streamProgress: 0 })

                        // Use streaming or non-streaming based on settings
                        // Streaming API supports I2I/Inpainting (same ImageGenerationRequest schema)
                        const canUseStreaming = useStreaming

                        let result
                        const streamMimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                        if (canUseStreaming) {
                            console.log('[Generate] Using streaming API...')
                            result = await generateImageStream(token, generationParams, (progress, partialImage) => {
                                // Update preview image directly (no null clearing - causes flicker)
                                if (partialImage) {
                                    set({ streamProgress: progress, previewImage: `data:${streamMimeType};base64,${partialImage}` })
                                } else {
                                    set({ streamProgress: progress })
                                }
                            })
                            set({ streamProgress: 0 })
                        } else {
                            console.log('[Generate] Using standard API...')
                            result = await generateImage(token, generationParams)
                        }

                        // Persist newly encoded vibes before releasing transient source data.
                        if (result.encodedVibes && result.encodedVibes.length > 0) {
                            const { vibeImages: storedVibes, updateVibeImage } = useCharacterStore.getState()
                            if (result.encodedVibeIndices) {
                                result.encodedVibeIndices.forEach((sourceIndex, encodedIndex) => {
                                    const selected = vibeImages[sourceIndex]
                                    if (selected && result.encodedVibes?.[encodedIndex]) {
                                        updateVibeImage(selected.id, { encodedVibe: result.encodedVibes[encodedIndex] })
                                    }
                                })
                            } else {
                                let encodedIndex = 0
                                for (let vi = 0; vi < storedVibes.length && encodedIndex < result.encodedVibes.length; vi++) {
                                    if (!storedVibes[vi].encodedVibe && !storedVibes[vi].encodedVibePath) {
                                        updateVibeImage(storedVibes[vi].id, { encodedVibe: result.encodedVibes[encodedIndex] })
                                        encodedIndex++
                                    }
                                }
                            }
                        }

                        // Reference originals are needed only while the API request is active.
                        generationParams.charImages = []
                        generationParams.charImagePaths = []
                        generationParams.vibeImages = []
                        generationParams.vibeImagePaths = []
                        generationParams.vibeEncodedPaths = []
                        generationParams.preEncodedVibes = []
                        characterImages.length = 0
                        vibeImages.length = 0
                        useCharacterStore.getState().releaseImageData()

                        // Check if cancelled or session changed after API call
                        if (get().isCancelled || get().generationSessionId !== sessionId) {
                            console.log('[Generate] Session invalidated after API call, discarding result')
                            break
                        }

                        const generationTime = Date.now() - startTime
                        set({ lastGenerationTime: generationTime })

                        if (result.success && result.imageData) {
                            const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                            const imageUrl = `data:${mimeType};base64,${result.imageData}`
                            set({ previewImage: imageUrl })

                            // Save Image: Try Tauri FS first, fallback to browser
                            const { savePath, autoSave, useAbsolutePath } = useSettingsStore.getState()

                            if (autoSave) {
                                try {
                                    const binaryString = atob(result.imageData)
                                    const bytes = new Uint8Array(binaryString.length)
                                    for (let j = 0; j < binaryString.length; j++) {
                                        bytes[j] = binaryString.charCodeAt(j)
                                    }

                                    // Determine generation type prefix
                                    let typePrefix = ''
                                    if (mask) {
                                        typePrefix = 'INPAINT_'
                                    } else if (sourceImage) {
                                        typePrefix = 'I2I_'
                                    }
                                    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                                    const fileName = `NAIS_${typePrefix}${Date.now()}.${fileExt}`
                                    const outputDir = savePath || 'NAIS_Output'

                                    let fullPath: string

                                    if (useAbsolutePath) {
                                        // Save to absolute path directly
                                        const dirExists = await exists(outputDir)
                                        if (!dirExists) {
                                            await mkdir(outputDir, { recursive: true })
                                        }
                                        fullPath = await join(outputDir, fileName)
                                        await writeFile(fullPath, bytes)
                                    } else {
                                        // Save relative to Pictures directory
                                        const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                                        if (!dirExists) {
                                            await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                                        }
                                        await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: BaseDirectory.Picture })
                                        const picPath = await pictureDir()
                                        fullPath = await join(picPath, outputDir, fileName)
                                    }

                                    // Notify HistoryPanel (file path only — HistoryPanel uses
                                    // convertFileSrc for file-based images, no base64 needed)
                                    try {
                                        window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                            detail: { path: fullPath }
                                        }))
                                    } catch (e) {
                                        console.warn('Failed to dispatch newImageGenerated event:', e)
                                    }
                                } catch (e) {
                                    console.warn('Tauri FS save failed, using download fallback:', e)
                                    const link = document.createElement('a')
                                    link.href = imageUrl
                                    const fallbackExt = imageFormat === 'webp' ? 'webp' : 'png'
                                    link.download = `NAIS_${Date.now()}.${fallbackExt}`
                                    document.body.appendChild(link)
                                    link.click()
                                    document.body.removeChild(link)
                                }
                            } else {
                                // Auto-save is OFF: Still notify HistoryPanel with memory-based path
                                // This allows viewing the generated image in history without saving to disk
                                try {
                                    const memExt = imageFormat === 'webp' ? 'webp' : 'png'
                                    const memoryPath = `memory://NAIS_${Date.now()}.${memExt}`
                                    window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                        detail: { path: memoryPath, data: imageUrl }
                                    }))
                                } catch (e) {
                                    console.warn('Failed to dispatch newImageGenerated event:', e)
                                }
                            }

                            // Refresh Anlas balance
                            useAuthStore.getState().refreshAnlas()

                            // Seed already advanced at generation start

                            // Apply generation delay between batches (not after the last one)
                            const { generationDelay } = useSettingsStore.getState()
                            if (i < batchCount - 1 && generationDelay > 0) {
                                await new Promise(resolve => setTimeout(resolve, generationDelay))
                            }
                        } else {
                            toast({
                                title: i18n.t('toast.generationFailed.title'),
                                description: result.error || i18n.t('toast.unknownError'),
                                variant: 'destructive',
                            })
                            break
                        }
                    }

                    // Show completion toast for batch
                    if (!get().isCancelled && batchCount > 1) {
                        toast({
                            title: i18n.t('toast.batchComplete.title'),
                            description: i18n.t('toast.batchComplete.desc', { count: batchCount }),
                            variant: 'success',
                        })
                    }

                } catch (error) {
                    if (get().isCancelled) {
                        return
                    }
                    console.error('Generation failed:', error)
                    toast({
                        title: i18n.t('toast.errorOccurred.title'),
                        description: i18n.t('toast.errorOccurred.desc'),
                        variant: 'destructive',
                    })
                } finally {
                    set({ isGenerating: false, generatingMode: null, currentBatch: 0, abortController: null })
                    // Release character/vibe base64 from memory after generation (~30-60MB)
                    // They will be reloaded from files on next generation
                    useCharacterStore.getState().releaseImageData(true)
                }
            },

            setPreviewImage: (url) => set({ previewImage: url }),
            setIsGenerating: (v) => set({ isGenerating: v, generatingMode: v ? 'main' : null }),
            setGeneratingMode: (mode) => set({ generatingMode: mode }),
            setStreamProgress: (progress) => set({ streamProgress: progress }),
        }),
        {
            name: 'nais2-forge-generation',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                // Prompts
                basePrompt: state.basePrompt,
                additionalPrompt: state.additionalPrompt,
                detailPrompt: state.detailPrompt,
                negativePrompt: state.negativePrompt,
                // Model & Parameters
                model: state.model,
                steps: state.steps,
                cfgScale: state.cfgScale,
                cfgRescale: state.cfgRescale,
                sampler: state.sampler,
                scheduler: state.scheduler,
                smea: state.smea,
                smeaDyn: state.smeaDyn,
                variety: state.variety,
                qualityToggle: state.qualityToggle,
                ucPreset: state.ucPreset,
                // Seed - only save if locked
                ...(state.seedLocked ? { seed: state.seed } : {}),
                seedLocked: state.seedLocked,
                selectedResolution: state.selectedResolution,
                // Batch
                batchCount: state.batchCount,
                // Timing (for estimated time)
                lastGenerationTime: state.lastGenerationTime,
                // I2I & Inpainting state - DO NOT persist sourceImage/mask (large Base64 data, 1MB+ each)
                // Only persist lightweight settings
                i2iMode: state.i2iMode,
                strength: state.strength,
                noise: state.noise,
                inpaintingPrompt: state.inpaintingPrompt,
            }),
            merge: (persistedState, currentState) => {
                const persistedWithoutHistory = { ...(persistedState || {}) } as Record<string, unknown>
                delete persistedWithoutHistory.history
                return { ...currentState, ...persistedWithoutHistory } as GenerationState
            },
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[GenerationStore] Hydration failed:', error)
                    return
                }
                if (state) {
                    console.log('[GenerationStore] Hydrated successfully')
                }
            },
        }
    )
)
