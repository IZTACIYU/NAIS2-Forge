import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { calculateGenerationDelay } from '@/lib/generation-delay'
import { useAuthStore } from '@/stores/auth-store'
import { useCharacterStore } from '@/stores/character-store'
import { sendSystemNotification } from '@/lib/system-notification'
import { generateSceneImage } from '@/services/scene-generation'
import { isRemoteSceneQueueRunning } from '@/services/remote-scene-queue'


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
            if (isProcessing || isRemoteSceneQueueRunning()) {
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
                await generateSceneImage({ presetId: activePresetId, scene, sequenceEntry })

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
                    const { generationDelay, generationDelayJitter } = useSettingsStore.getState()
                    const delay = calculateGenerationDelay(generationDelay, generationDelayJitter)
                    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
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
