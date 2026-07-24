import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateImage, generateImageStream, GenerationParams } from '@/services/novelai-api'
import { BaseDirectory, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { processWildcards } from '@/lib/fragment-processor'
import { removePromptComments } from '@/lib/prompt-comments'
import { useCharacterStore } from '@/stores/character-store'
import { sendSystemNotification } from '@/lib/system-notification'
import { getRandomCharacterCandidates, pickRandomCharacters } from '@/lib/random-character-selection'
import {
    buildSceneCharacterPrompt,
    getSceneMultiCharacterPromptMap,
    getVariantStackKey,
    selectSceneCharacters,
} from '@/lib/scene-character-prompts'

// Module-level variable to prevent concurrent processing
let isProcessing = false

export function useSceneGeneration() {
    const { t } = useTranslation()
    const token = useAuthStore(state => state.token)
    const { savePath, streamingView } = useSettingsStore(useShallow(state => ({
        savePath: state.savePath,
        streamingView: state.useStreaming,
    })))

    // NOTE: Do NOT use useGenerationStore() hook here — it subscribes to ALL store
    // changes (prompt typing, preview image, etc.) causing unnecessary re-renders.
    // Use useGenerationStore.getState() inside processQueue instead.

    const {
        isGenerating,
        setIsGenerating,
        activePresetId,
        getNextCharacterSequenceScene,
        getHasMoreSceneGeneration,
        addImageToScene,
        setStreamingData,
        initGenerationProgress,
        setGenerationProgress,
        completedCount,
        totalQueuedCount,
        generationSessionId
    } = useSceneStore(useShallow(state => ({
        isGenerating: state.isGenerating,
        setIsGenerating: state.setIsGenerating,
        activePresetId: state.activePresetId,
        getNextCharacterSequenceScene: state.getNextCharacterSequenceScene,
        getHasMoreSceneGeneration: state.getHasMoreSceneGeneration,
        addImageToScene: state.addImageToScene,
        setStreamingData: state.setStreamingData,
        initGenerationProgress: state.initGenerationProgress,
        setGenerationProgress: state.setGenerationProgress,
        completedCount: state.completedCount,
        totalQueuedCount: state.totalQueuedCount,
        generationSessionId: state.generationSessionId,
    })))

    useEffect(() => {
        const processQueue = async (sessionId: number) => {
            // CRITICAL: Prevent concurrent API requests (429 error fix)
            // Check and SET immediately to prevent race condition
            if (isProcessing) {
                return
            }
            
            // Session check: If session changed, this processQueue is stale
            if (sessionId !== useSceneStore.getState().generationSessionId) {
                isProcessing = false
                return
            }
            
            isProcessing = true

            // Check if cancelled - if so, stop generation after current API call completes
            const sceneState = useSceneStore.getState()
            if (sceneState.isCancelling || !isGenerating) {
                // If scene generation stopped or cancelled, ensure global mode is cleared
                if (useGenerationStore.getState().generatingMode === 'scene') {
                    useGenerationStore.getState().setGeneratingMode(null)
                }
                setIsGenerating(false)  // This will also reset isCancelling
                isProcessing = false
                return
            }

            // Conflict Check: If Main Mode is generating, stop Scene Mode
            if (useGenerationStore.getState().generatingMode === 'main') {
                setIsGenerating(false)
                isProcessing = false  // CRITICAL: Reset flag on early return
                toast({
                    title: t('common.error', '오류'),
                    description: t('generate.conflictMain', '메인 모드에서 생성 중입니다.'),
                    variant: 'destructive'
                })
                return
            }

            // Set global mode to scene
            if (useGenerationStore.getState().generatingMode !== 'scene') {
                useGenerationStore.getState().setGeneratingMode('scene')
            }

            if (!activePresetId || !token) {
                setIsGenerating(false)
                isProcessing = false  // CRITICAL: Reset flag on early return
                return
            }

            // Double-check session before modifying queue
            if (sessionId !== useSceneStore.getState().generationSessionId) {
                isProcessing = false
                return
            }

            const nextGeneration = getNextCharacterSequenceScene(activePresetId)
            const scene = nextGeneration?.scene
            const sequenceEntry = nextGeneration?.entry ?? null

            if (!scene) {
                setIsGenerating(false)
                // Global mode will be cleared by the effect or next loop
                useGenerationStore.getState().setGeneratingMode(null)

                // Reset progress
                setGenerationProgress(0, 0)
                isProcessing = false  // CRITICAL: Reset flag
                // Release character/vibe base64 from memory after all scene generation completes
                useCharacterStore.getState().releaseImageData(true)
                toast({ title: t('generate.complete', '생성 완료'), description: t('generate.allComplete', '모든 예약된 작업이 완료되었습니다.'), variant: 'success' })
                void sendSystemNotification(t('generate.complete', '생성 완료'), t('generate.allComplete', '모든 예약된 작업이 완료되었습니다.'))
                return
            }

            // Note: isProcessing is already set at the start of processQueue

            // Start Streaming State for this scene
            setStreamingData(scene.id, null, 0)

            try {
                // Get fresh generation store state
                const genState = useGenerationStore.getState()

                // Construct Prompt (including inpaintingPrompt if in inpaint mode)
                const parts = [
                    removePromptComments(genState.basePrompt),
                    // Add inpainting prompt after basePrompt (same as main mode)
                    genState.i2iMode === 'inpaint' ? removePromptComments(genState.inpaintingPrompt) : null,
                    removePromptComments(genState.additionalPrompt),
                    removePromptComments(scene.scenePrompt),
                    removePromptComments(genState.detailPrompt),
                ].filter(p => p && p.trim())

                // Apply wildcard/fragment processing to final prompt (async)
                // processWildcards handles both <filename> fragments and (a/b/c) random selection
                const finalPrompt = await processWildcards(parts.join(', '))

                // Get Character & Vibe Data (활성화된 이미지만 필터링)
                const referenceState = useCharacterStore.getState()
                const latestPromptStore = useCharacterPromptStore.getState()
                const latestSceneStore = useSceneStore.getState()
                const latestSettingsStore = useSettingsStore.getState()
                const sequenceMode = !!sequenceEntry
                const sceneConfig = latestSceneStore.sceneCharacterAdditions[activePresetId]?.[scene.id] || null
                const sceneAddition = latestSettingsStore.expertSceneCharacterAdditionsEnabled && latestSceneStore.sceneCharacterAdditionsEnabled
                    ? sceneConfig
                    : null
                const uniqueIds = (ids: string[]) => Array.from(new Set(ids))
                const characterReferenceIds = sequenceMode
                    ? sequenceEntry.characterReferenceIds
                    : referenceState.characterImages.filter(img => img.enabled !== false).map(img => img.id)
                const vibeReferenceIds = sequenceMode
                    ? sequenceEntry.vibeReferenceIds
                    : referenceState.vibeImages.filter(img => img.enabled !== false).map(img => img.id)
                const randomCharacterCandidates = !sequenceMode
                    && latestSettingsStore.expertSceneRandomCharactersEnabled
                    && latestSettingsStore.sceneRandomCharactersActive
                    ? getRandomCharacterCandidates(
                        latestPromptStore.characters,
                        latestPromptStore.groups,
                        latestSettingsStore.sceneRandomCharacterMode,
                        latestSettingsStore.sceneRandomCharacterIds,
                        latestSettingsStore.sceneRandomCharacterGroupIds,
                        latestSettingsStore.expertCharacterPromptGenderIndicatorEnabled
                            ? latestSettingsStore.sceneRandomCharacterGender
                            : 'all',
                    )
                    : []
                const randomCharacterIds = randomCharacterCandidates.length > 0
                    ? pickRandomCharacters(randomCharacterCandidates, latestSettingsStore.sceneRandomCharacterCount).map(character => character.id)
                    : null
                const characterPromptIds = sequenceMode
                    ? sequenceEntry.characterPromptIds
                    : randomCharacterIds
                        ?? latestPromptStore.characters.filter(character => character.enabled).map(character => character.id)
                const finalCharacterReferenceIds = uniqueIds([
                    ...characterReferenceIds,
                    ...(sceneAddition?.characterReferenceIds || []),
                ])
                const finalVibeReferenceIds = uniqueIds([
                    ...vibeReferenceIds,
                    ...(sceneAddition?.vibeReferenceIds || []),
                ])
                const finalCharacterPromptIds = uniqueIds([
                    ...characterPromptIds,
                    ...(sceneAddition?.characterPromptIds || []),
                ])
                const latestCharStore = useCharacterStore.getState()
                const characterImages = latestCharStore.characterImages.filter(img => finalCharacterReferenceIds.includes(img.id) && (img.filePath || img.base64 || img.cacheKey))
                const vibeImages = latestCharStore.vibeImages.filter(img => finalVibeReferenceIds.includes(img.id) && (img.filePath || img.base64 || img.encodedVibe || img.encodedVibePath))
                const requestedVariantIndex = latestSettingsStore.expertSceneCharacterVariantOverrideEnabled
                    && latestSettingsStore.expertCharacterPromptVariantsEnabled
                    ? sceneConfig?.characterVariantIndex
                    : undefined
                const costumeOverride = latestSettingsStore.expertSceneCharacterCostumeOverrideEnabled
                    && latestSettingsStore.expertCharacterPromptLayoutEnabled
                    ? sceneConfig?.characterCostumeEnabled
                    : undefined
                const characterPrompts = selectSceneCharacters(
                    latestPromptStore.characters,
                    finalCharacterPromptIds,
                    requestedVariantIndex,
                )
                const multiCharacterPromptMap = getSceneMultiCharacterPromptMap(
                    latestSettingsStore.expertSceneMultiCharacterEnabled ? scene.multiCharacterSlots : undefined,
                    characterPrompts,
                    latestPromptStore.characters,
                )

                if (sequenceMode || requestedVariantIndex !== undefined) {
                    const selectedStackKeys = new Set(characterPrompts.map(character => getVariantStackKey(character)))
                    const activeVariantIds = new Set(characterPrompts.map(character => character.id))
                    useCharacterPromptStore.setState(state => {
                        let changed = false
                        const characters = state.characters.map(character => {
                            if (!selectedStackKeys.has(getVariantStackKey(character))) return character
                            const enabled = activeVariantIds.has(character.id)
                            if (character.enabled === enabled) return character
                            changed = true
                            return { ...character, enabled }
                        })
                        return changed ? { characters } : {}
                    })
                }

                // Apply fragment/wildcard substitution to character prompts (async)
                const processedCharacterPrompts = await Promise.all(
                    characterPrompts.map(async c => {
                        const basePrompt = latestSettingsStore.expertCharacterPromptLayoutEnabled
                            ? buildSceneCharacterPrompt(c, costumeOverride)
                            : c.prompt
                        const appendedPrompts = multiCharacterPromptMap.get(c.id) || []
                        return {
                            prompt: await processWildcards([basePrompt, ...appendedPrompts].filter(Boolean).join('\n')),
                            negative: await processWildcards(latestSettingsStore.expertCharacterPromptLayoutEnabled && c.negativeEnabled === false ? '' : c.negative),
                            enabled: true,
                            position: c.position
                        }
                    })
                )

                // Determine Seed (Randomize if not locked)
                // If seed is 0, treat it as "random seed" request
                let finalSeed = genState.seedLocked ? genState.seed : Math.floor(Math.random() * 4294967295)
                if (finalSeed === 0) {
                    finalSeed = Math.floor(Math.random() * 4294967295)
                }

                // Helper function to round to nearest multiple of 64 (NovelAI requirement)
                const roundTo64 = (value: number): number => Math.round(value / 64) * 64

                // Scene output must remain independent from the main generator resolution.
                let finalWidth = roundTo64(scene.width && scene.width > 0 ? scene.width : 832)
                let finalHeight = roundTo64(scene.height && scene.height > 0 ? scene.height : 1216)

                if (genState.sourceImage) {
                    // Extract dimensions from base64 image
                    try {
                        const img = new Image()
                        await new Promise<void>((resolve, reject) => {
                            img.onload = () => resolve()
                            img.onerror = () => reject(new Error('Failed to load source image'))
                            img.src = genState.sourceImage!
                        })
                        // Round source image dimensions to multiples of 64
                        finalWidth = roundTo64(img.width)
                        finalHeight = roundTo64(img.height)
                        console.log(`[SceneGeneration] Using source image dimensions: ${img.width}x${img.height} → ${finalWidth}x${finalHeight}`)
                        // MEMORY: Clear image reference
                        img.src = ''
                    } catch (e) {
                        console.warn('[SceneGeneration] Failed to get source image dimensions, using scene/global resolution')
                    }
                }

                const params: GenerationParams = {
                    prompt: finalPrompt,
                    negative_prompt: [
                        removePromptComments(genState.negativePrompt),
                        removePromptComments(scene.sceneNegativePrompt || ''),
                    ].filter(prompt => prompt && prompt.trim()).join(', '),
                    steps: genState.steps,
                    cfg_scale: genState.cfgScale,
                    cfg_rescale: genState.cfgRescale,
                    sampler: genState.sampler,
                    scheduler: genState.scheduler,
                    smea: genState.smea,
                    smea_dyn: genState.smeaDyn,
                    variety: genState.variety ?? false,
                    seed: finalSeed,

                    width: finalWidth,
                    height: finalHeight,

                    model: genState.model,

                    // I2I / Inpainting parameters
                    sourceImage: genState.sourceImage || undefined,
                    strength: genState.strength,
                    noise: genState.noise,
                    mask: genState.mask || undefined,

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

                    // Character Prompts - already processed with fragment substitution
                    characterPrompts: processedCharacterPrompts,

                    // Image format from settings
                    imageFormat: useSettingsStore.getState().imageFormat,
                }

                let result

                const streamMimeType = params.imageFormat === 'webp' ? 'image/webp' : 'image/png'
                if (streamingView) {
                    // Streaming Generation - real-time preview updates
                    result = await generateImageStream(token, params, (progress, image) => {
                        if (image) {
                            setStreamingData(scene.id, `data:${streamMimeType};base64,${image}`, progress / 100)
                        } else {
                            // Progress-only update
                            setStreamingData(scene.id, null, progress / 100)
                        }
                    })
                } else {
                    // Normal Generation
                    result = await generateImage(token, params)
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
                params.charImages = []
                params.charImagePaths = []
                params.vibeImages = []
                params.vibeImagePaths = []
                params.vibeEncodedPaths = []
                params.preEncodedVibes = []
                characterImages.length = 0
                vibeImages.length = 0
                useCharacterStore.getState().releaseImageData()

                // NOTE: Removed isGenerating check here - it causes a race condition.
                // When queueCount changes to 0, useEffect re-runs and sets isGenerating=false
                // before the current generation finishes saving.

                if (result.success && result.imageData) {
                    // Get preset name for folder structure
                    const currentPreset = useSceneStore.getState().presets.find(p => p.id === activePresetId)
                    const safePresetName = (currentPreset?.name || 'Default').replace(/[<>:"/\\|?*]/g, '_').trim()
                    // Sanitize scene name for folder name
                    const safeSceneName = scene.name.replace(/[<>:"/\\|?*]/g, '_').trim() || 'Untitled_Scene'
                    const { imageFormat } = useSettingsStore.getState()
                    const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                    const fileName = `NAIS_SCENE_${Date.now()}.${fileExt}`

                    try {
                        const base64Data = result.imageData.replace(/^data:image\/(png|webp);base64,/, '')
                        const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

                        const { useAbsolutePath } = useSettingsStore.getState()
                        let fullPath: string

                        if (useAbsolutePath && savePath) {
                            // Save to absolute path: savePath/NAIS_Scene/presetName/sceneName/
                            const naisSceneDir = await join(savePath, 'NAIS_Scene')
                            const presetDir = await join(naisSceneDir, safePresetName)
                            const sceneDir = await join(presetDir, safeSceneName)

                            if (!(await exists(naisSceneDir))) {
                                await mkdir(naisSceneDir, { recursive: true })
                            }
                            if (!(await exists(presetDir))) {
                                await mkdir(presetDir, { recursive: true })
                            }
                            if (!(await exists(sceneDir))) {
                                await mkdir(sceneDir, { recursive: true })
                            }

                            fullPath = await join(sceneDir, fileName)
                            await writeFile(fullPath, binaryData)
                        } else {
                            // Save to Pictures/NAIS_Scene/presetName/sceneName/
                            const baseDir = await pictureDir()
                            const presetSceneDir = `NAIS_Scene/${safePresetName}/${safeSceneName}`

                            const naisSceneDir = 'NAIS_Scene'
                            if (!(await exists(naisSceneDir, { baseDir: BaseDirectory.Picture }))) {
                                await mkdir(naisSceneDir, { baseDir: BaseDirectory.Picture })
                            }

                            const presetDirPath = `NAIS_Scene/${safePresetName}`
                            if (!(await exists(presetDirPath, { baseDir: BaseDirectory.Picture }))) {
                                await mkdir(presetDirPath, { baseDir: BaseDirectory.Picture })
                            }

                            if (!(await exists(presetSceneDir, { baseDir: BaseDirectory.Picture }))) {
                                await mkdir(presetSceneDir, { baseDir: BaseDirectory.Picture })
                            }

                            await writeFile(`${presetSceneDir}/${fileName}`, binaryData, { baseDir: BaseDirectory.Picture })
                            fullPath = await join(baseDir, presetSceneDir, fileName)
                        }

                        // Notify HistoryPanel immediately (file path only — no base64 needed,
                        // HistoryPanel uses convertFileSrc for file-based images)
                        window.dispatchEvent(new CustomEvent('newImageGenerated', {
                            detail: { path: fullPath }
                        }))

                        addImageToScene(activePresetId, scene.id, fullPath)

                    } catch (saveError) {
                        console.error('Failed to save scene image file:', saveError)
                        // DON'T add base64 image to store - it will exceed localStorage quota
                        // Just show error and continue
                        toast({ title: t('common.saveFailed', '파일 저장 실패'), description: String(saveError), variant: 'destructive' })
                    }

                    // Refresh Anlas balance after each image
                    useAuthStore.getState().refreshAnlas()

                    // Update progress counter
                    const currentState = useSceneStore.getState()
                    setGenerationProgress(currentState.completedCount + 1, currentState.totalQueuedCount)

                } else {
                    console.error('Generation failed:', result.error)
                    toast({ title: t('common.error', '오류'), description: result.error || 'Generation failed', variant: 'destructive' })
                    // Don't stop on single failure, continue queue
                }

                // Reset Streaming Data
                setStreamingData(null, null, 0)

                // Check if there are more scenes to process AND session is still valid
                const sceneState = useSceneStore.getState()
                const sessionStillValid = sessionId === sceneState.generationSessionId
                const hasMoreScenes = sessionStillValid &&
                    sceneState.isGenerating &&
                    sceneState.getHasMoreSceneGeneration(activePresetId)

                // Apply generation delay only if there are more scenes
                if (hasMoreScenes) {
                    const { generationDelay } = useSettingsStore.getState()
                    if (generationDelay > 0) {
                        await new Promise(resolve => setTimeout(resolve, generationDelay))
                    }
                }

                // CRITICAL: Release processing lock AFTER delay
                isProcessing = false

                // Continue Queue - only if still generating AND same session
                const latestState = useSceneStore.getState()
                if (latestState.isGenerating && sessionId === latestState.generationSessionId) {
                    processQueue(sessionId)
                }

            } catch (e) {
                console.error('Process queue error:', e)
                useCharacterStore.getState().releaseImageData()
                isProcessing = false
                setStreamingData(null, null, 0)

                // Check if session is still valid before retrying
                const latestState = useSceneStore.getState()
                if (sessionId !== latestState.generationSessionId) {
                    return  // Session invalidated, don't retry
                }

                // Check if it's a 429 error and retry after delay
                const errorMessage = String(e)
                if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('too many requests')) {
                    console.log('429 error detected, retrying after 3 seconds...')
                    await new Promise(resolve => setTimeout(resolve, 3000))
                    const retryState = useSceneStore.getState()
                    if (retryState.isGenerating && sessionId === retryState.generationSessionId) {
                        processQueue(sessionId)
                    }
                } else {
                    toast({ title: t('common.error', '오류'), description: errorMessage, variant: 'destructive' })
                    setIsGenerating(false)
                }
            }
        }

        if (isGenerating && !isProcessing) {
            // Initialize progress tracking when generation starts
            if (completedCount === 0 && totalQueuedCount === 0) {
                initGenerationProgress()
            }
            // Pass current session ID to processQueue
            processQueue(generationSessionId)
        }
    }, [isGenerating, activePresetId, token, savePath, t, addImageToScene, getNextCharacterSequenceScene, getHasMoreSceneGeneration, setIsGenerating, streamingView, setStreamingData, initGenerationProgress, setGenerationProgress, completedCount, totalQueuedCount, generationSessionId])

    // Reset processing when generation stops
    useEffect(() => {
        if (!isGenerating) {
            isProcessing = false
            useCharacterStore.getState().releaseImageData(true)
        }
    }, [isGenerating])

    return {
        isGenerating
    }
}
