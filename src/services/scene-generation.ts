import { toast } from '@/components/ui/use-toast'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore } from '@/stores/auth-store'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { BaseDirectory, writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { buildGenerationRequest } from '@/lib/generation-request'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { useCharacterStore } from '@/stores/character-store'
import { getRandomCharacterCandidates, pickRandomCharacters } from '@/lib/random-character-selection'
import { SCENE_IMAGE_GENERATED_EVENT } from '@/lib/scene-review-generation'
import {
    createSceneCustomCharacters,
    getSceneMultiCharacterNegativePromptMap,
    getSceneMultiCharacterPositionMap,
    getSceneMultiCharacterPromptMap,
    getVariantStackKey,
    selectSceneCharacters,
} from '@/lib/scene-character-prompts'

import i18n from '@/i18n'
import type { SceneCard, SceneCharacterSequenceEntry } from '@/stores/scene-store'
import type { RemoteGenerationSettings, RemoteSceneDraft } from '@/lib/remote-generation'

export async function generateSceneImage(options: {
    presetId: string; scene: SceneCard; sequenceEntry?: SceneCharacterSequenceEntry | null;
    settings?: RemoteGenerationSettings; draft?: RemoteSceneDraft;
}): Promise<string | undefined> {
    const { scene, presetId: activePresetId, sequenceEntry = null } = options
    const { savePath, useStreaming: streamingView } = useSettingsStore.getState()
    const { addImageToScene, setStreamingData, setGenerationProgress } = useSceneStore.getState()
    const t = i18n.t.bind(i18n)
    // Get fresh generation store state
    const genState = options.settings ? { ...useGenerationStore.getState(), ...options.settings } : useGenerationStore.getState()

    // Get Character & Vibe Data (활성화된 이미지만 필터링)
    const referenceState = useCharacterStore.getState()
    const latestPromptStore = useCharacterPromptStore.getState()
    const latestSceneStore = useSceneStore.getState()
    const latestSettingsStore = useSettingsStore.getState()
    const sequenceMode = !!sequenceEntry
    const sceneConfig = latestSceneStore.sceneCharacterAdditions[activePresetId]?.[scene.id] || null
    const sceneAdditionMode = latestSettingsStore.sceneCharacterAdditionMode
    const originalAddition = latestSettingsStore.expertSceneCharacterAdditionsEnabled
        && (sceneAdditionMode !== 'preset' || latestSceneStore.sceneCharacterAdditionsEnabled)
        && (sceneConfig?.mode || 'preset') === sceneAdditionMode
        ? sceneConfig
        : null
    const sceneAddition = options.draft ? {
        mode: 'scene' as const, characterPromptIds: options.draft.characterPromptIds,
        characterReferenceIds: originalAddition?.mode === 'custom' ? [] : originalAddition?.characterReferenceIds || [],
        vibeReferenceIds: originalAddition?.mode === 'custom' ? [] : originalAddition?.vibeReferenceIds || [],
    } : originalAddition
    const usesCustomSceneCharacters = sceneAddition?.mode === 'custom'
    const uniqueIds = (ids: string[]) => Array.from(new Set(ids))
    const characterReferenceIds = sequenceMode
        ? sequenceEntry.characterReferenceIds
        : referenceState.characterImages.filter(img => img.enabled !== false).map(img => img.id)
    const vibeReferenceIds = sequenceMode
        ? sequenceEntry.vibeReferenceIds
        : referenceState.vibeImages.filter(img => img.enabled !== false).map(img => img.id)
    const randomCharacterCandidates = !options.draft && !sequenceMode
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
    const maxCharacterPrompts = getModelCapabilities(genState.model).maxCharacterPrompts
    const randomCharacterIds = randomCharacterCandidates.length > 0
        ? pickRandomCharacters(
            randomCharacterCandidates,
            Math.min(latestSettingsStore.sceneRandomCharacterCount, maxCharacterPrompts),
        ).map(character => character.id)
        : null
    const characterPromptIds = sequenceMode
        ? sequenceEntry.characterPromptIds
        : randomCharacterIds
            ?? latestPromptStore.characters.filter(character => character.enabled).map(character => character.id)
    const finalCharacterReferenceIds = uniqueIds([
        ...characterReferenceIds,
        ...(usesCustomSceneCharacters ? [] : sceneAddition?.characterReferenceIds || []),
    ])
    const finalVibeReferenceIds = uniqueIds([
        ...vibeReferenceIds,
        ...(usesCustomSceneCharacters ? [] : sceneAddition?.vibeReferenceIds || []),
    ])
    const finalCharacterPromptIds = uniqueIds([
        ...characterPromptIds,
        ...(usesCustomSceneCharacters ? [] : sceneAddition?.characterPromptIds || []),
    ])
    const mainCharacterPromptIds = uniqueIds([
        ...characterPromptIds,
        ...(sceneAddition?.mode === 'preset' ? sceneAddition.characterPromptIds : []),
    ])
    const latestCharStore = useCharacterStore.getState()
    const characterImages = latestCharStore.characterImages.filter(img => finalCharacterReferenceIds.includes(img.id) && (img.filePath || img.base64 || img.cacheKey))
    const vibeImages = latestCharStore.vibeImages.filter(img => finalVibeReferenceIds.includes(img.id) && (img.filePath || img.base64 || img.encodedVibe || img.encodedVibePath))
    const requestedVariantIndex = !options.draft && latestSettingsStore.expertSceneCharacterVariantOverrideEnabled
        && latestSettingsStore.expertCharacterPromptVariantsEnabled
        ? sceneConfig?.characterVariantIndex
        : undefined
    const costumeOverride = !options.draft && latestSettingsStore.expertSceneCharacterCostumeOverrideEnabled
        && latestSettingsStore.expertCharacterPromptLayoutEnabled
        ? sceneConfig?.characterCostumeEnabled
        : undefined
    const selectedCharacters = selectSceneCharacters(
        latestPromptStore.characters,
        finalCharacterPromptIds,
        requestedVariantIndex,
    )
    const mainCharacters = selectSceneCharacters(
        latestPromptStore.characters,
        mainCharacterPromptIds,
        requestedVariantIndex,
    )
    const characterPrompts = [
        ...selectedCharacters,
        ...(options.draft ? createSceneCustomCharacters(scene.id, options.draft.npcs) : usesCustomSceneCharacters
            ? createSceneCustomCharacters(scene.id, sceneAddition?.customCharacters)
            : []),
    ].slice(0, maxCharacterPrompts)
    const multiCharacterPromptMap = getSceneMultiCharacterPromptMap(
        latestSettingsStore.expertSceneMultiCharacterEnabled ? scene.multiCharacterSlots : undefined,
        characterPrompts,
        latestPromptStore.characters,
    )
    const multiCharacterNegativePromptMap = getSceneMultiCharacterNegativePromptMap(
        latestSettingsStore.expertSceneMultiCharacterEnabled ? scene.multiCharacterSlots : undefined,
        characterPrompts,
        latestPromptStore.characters,
    )
    const multiCharacterPositionMap = getSceneMultiCharacterPositionMap(
        latestSettingsStore.expertSceneMultiCharacterEnabled ? scene.multiCharacterSlots : undefined,
        characterPrompts,
        latestPromptStore.characters,
    )

    if (!options.draft && (sequenceMode || requestedVariantIndex !== undefined)) {
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

    const params = await buildGenerationRequest({
        positiveParts: [
            { value: genState.basePrompt },
            { value: genState.sourceImage && genState.mask && genState.i2iMode === 'inpaint' ? genState.inpaintingPrompt : '' },
            { value: genState.additionalPrompt },
            { value: scene.scenePrompt },
            { value: genState.detailPrompt },
        ],
        negativeParts: [
            { value: genState.negativePrompt },
            { value: scene.sceneNegativePrompt || '' },
        ],
        characterInputs: characterPrompts.map(character => ({
            character,
            appendedPrompts: multiCharacterPromptMap.get(character.id),
            appendedNegativePrompts: multiCharacterNegativePromptMap.get(character.id),
            costumeEnabled: costumeOverride,
            position: multiCharacterPositionMap.get(character.id) || character.position,
        })),
        mainCharacterInputs: mainCharacters.map(character => ({ character })),
        characterPromptLayoutEnabled: latestSettingsStore.expertCharacterPromptLayoutEnabled,
        characterPositionEnabled: latestPromptStore.positionEnabled || multiCharacterPositionMap.size > 0,
        characterImages,
        vibeImages,
        model: genState.model,
        width: finalWidth,
        height: finalHeight,
        steps: genState.steps,
        cfgScale: genState.cfgScale,
        cfgRescale: genState.cfgRescale,
        sampler: genState.sampler,
        scheduler: genState.scheduler,
        smea: genState.smea,
        smeaDyn: genState.smeaDyn,
        variety: genState.variety ?? false,
        modelMode: genState.modelMode,
        seed: finalSeed,
        sourceImage: genState.sourceImage || undefined,
        strength: genState.strength,
        noise: genState.noise,
        mask: genState.mask || undefined,
        imageFormat: latestSettingsStore.imageFormat,
        qualityToggle: genState.qualityToggle,
        qualityTagPreset: genState.qualityTagPreset,
        ucPreset: genState.ucPreset,
        transparentBackground: genState.transparentBackground,
        promptWhitespaceMode: latestSettingsStore.promptWhitespaceMode,
        removeEmptyPromptSeparators: latestSettingsStore.removeEmptyPromptSeparators,
        insertBlankLinesBetweenPromptParts: latestSettingsStore.insertBlankLinesBetweenPromptParts,
        promptParts: {
            base: genState.basePrompt,
            additional: genState.additionalPrompt,
            detail: genState.detailPrompt,
            negative: genState.negativePrompt,
            inpainting: genState.inpaintingPrompt,
        },
    })

    const streamMimeType = params.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    const result = await useAuthStore.getState().runGenerationWithAccountFallback(async generationToken => {
        if (!streamingView) return generateImage(generationToken, params)
        // Streaming Generation - real-time preview updates
        return generateImageStream(generationToken, params, (progress, image) => {
            if (image) {
                setStreamingData(scene.id, `data:${streamMimeType};base64,${image}`, progress / 100)
            } else {
                // Progress-only update
                setStreamingData(scene.id, null, progress / 100)
            }
        })
    })

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
            let sceneFolderPath: string
            const existingSceneFolderPath = scene.folderPath && await exists(scene.folderPath)
                ? scene.folderPath
                : null

            if (existingSceneFolderPath) {
                sceneFolderPath = existingSceneFolderPath
                fullPath = await join(sceneFolderPath, fileName)
                await writeFile(fullPath, binaryData)
            } else if (useAbsolutePath && savePath) {
                // Save to absolute path: savePath/NAIS_Scene/presetName/sceneName/
                const naisSceneDir = await join(savePath, 'NAIS_Scene')
                const presetDir = await join(naisSceneDir, safePresetName)
                const sceneDir = await join(presetDir, safeSceneName)
                sceneFolderPath = sceneDir

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
                sceneFolderPath = await join(baseDir, presetSceneDir)
            }

            // Notify HistoryPanel immediately (file path only — no base64 needed,
            // HistoryPanel uses convertFileSrc for file-based images)
            window.dispatchEvent(new CustomEvent(SCENE_IMAGE_GENERATED_EVENT, {
                detail: { path: fullPath, presetId: activePresetId, sceneId: scene.id }
            }))

            addImageToScene(activePresetId, scene.id, fullPath, sceneFolderPath)

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

    return result.success && result.imageData ? (result.imageData.startsWith('data:') ? result.imageData : `data:${streamMimeType};base64,${result.imageData}`) : undefined
}
