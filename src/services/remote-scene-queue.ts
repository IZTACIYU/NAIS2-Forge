import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import { useSettingsStore } from '@/stores/settings-store'
import { calculateGenerationDelay } from '@/lib/generation-delay'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { selectSceneCharacters } from '@/lib/scene-character-prompts'
import type { RemoteSceneDraft, RemoteGenerationSettings, RemoteCostContext } from '@/lib/remote-generation'
import { generateSceneImage } from './scene-generation'
import type { RemoteResolvedWorkspace } from './remote-workspace'

// Runtime-only owner: never inserted into the PC's queue or persisted scene settings.
let running = false
export const isRemoteSceneQueueRunning = () => running

export function remoteSceneCostContext(item: RemoteSceneDraft, base: RemoteCostContext, workspace?: RemoteResolvedWorkspace): RemoteCostContext {
    const settings = useSettingsStore.getState()
    const sceneState = useSceneStore.getState()
    const config = sceneState.sceneCharacterAdditions[item.presetId]?.[item.sceneId]
    const addition = settings.expertSceneCharacterAdditionsEnabled && (settings.sceneCharacterAdditionMode !== 'preset' || sceneState.sceneCharacterAdditionsEnabled)
        && (config?.mode || 'preset') === settings.sceneCharacterAdditionMode && config?.mode !== 'custom' ? config : null
    const refs = workspace ?? useCharacterStore.getState()
    const characters = refs.characterImages.filter(image => image.enabled !== false || addition?.characterReferenceIds.includes(image.id))
    const vibes = refs.vibeImages.filter(image => image.enabled !== false || addition?.vibeReferenceIds.includes(image.id))
    return { ...base, characterReferenceCount: characters.length, uncachedVibeCount: vibes.filter(image => !image.encodedVibe && !image.encodedVibePath).length }
}

export function resolveRemoteScene(draft: RemoteSceneDraft, model: string, workspace?: RemoteResolvedWorkspace) {
    const state = useSceneStore.getState(), existing = state.getScene(draft.presetId, draft.sceneId), preset = state.presets.find(preset => preset.id === draft.presetId)
    if (draft.newScene && (!preset || !existing && preset.scenes.some(scene => scene.name.replace(/[<>:"/\\|?*]/g, '_').trim().toLowerCase() === draft.newScene!.name.trim().toLowerCase()))) throw new Error('Invalid new scene name')
    const scene = existing ?? (draft.newScene && preset ? { id: draft.sceneId, ...draft.newScene, scenePrompt: '', queueCount: 0, images: [], createdAt: Date.now() } : undefined)
    const characters = workspace?.characters ?? useCharacterPromptStore.getState().characters
    if (!scene || draft.characterPromptIds.some(id => !characters.some(character => character.id === id))) throw new Error('Scene or character no longer exists')
    if (draft.multiCharacterSlots?.some(slot => slot.target === 'manual' && slot.characterId && !characters.some(character => character.id === slot.characterId))) throw new Error('Slot character no longer exists')
    const selected = selectSceneCharacters(characters, [...characters.filter(character => character.enabled).map(character => character.id), ...draft.characterPromptIds])
    if (selected.length + draft.npcs.filter(npc => npc.enabled !== false && (npc.prompt.trim() || npc.negative.trim())).length > getModelCapabilities(model).maxCharacterPrompts) throw new Error('Too many scene characters')
    return { ...scene, scenePrompt: draft.scenePrompt, sceneNegativePrompt: draft.sceneNegativePrompt, multiCharacterSlots: draft.multiCharacterSlots ?? scene.multiCharacterSlots }
}

export async function runRemoteSceneQueue(options: {
    settings: RemoteGenerationSettings; queue: RemoteSceneDraft[]; shouldContinue: () => boolean;
    workspace?: RemoteResolvedWorkspace;
    onImage: (image: string, index: number, item: RemoteSceneDraft) => Promise<void>;
}) {
    const sceneState = useSceneStore.getState()
    const generation = useGenerationStore.getState()
    if (running || sceneState.isGenerating || generation.isGenerating || generation.generatingMode) throw new Error('Generation busy')
    options.queue.forEach(item => resolveRemoteScene(item, options.settings.model, options.workspace))
    running = true
    const sessionId = sceneState.generationSessionId
    const total = options.queue.reduce((sum, item) => sum + item.count, 0)
    // Claim existing UI locks without resetting the PC queue/sequence or changing active preset.
    useSceneStore.setState({ isGenerating: true, isCancelling: false, completedCount: 0, totalQueuedCount: total })
    generation.setGeneratingMode('scene')
    let completed = 0
    const current = () => options.shouldContinue() && useSceneStore.getState().generationSessionId === sessionId && !useSceneStore.getState().isCancelling
    try {
        for (const item of options.queue) {
            for (let repeat = 0; repeat < item.count; repeat++) {
                if (!current()) return completed
                const scene = resolveRemoteScene(item, options.settings.model, options.workspace)
                const image = await generateSceneImage({ presetId: item.presetId, scene, settings: options.settings, draft: item, workspace: options.workspace })
                if (!image) throw new Error('Scene generation failed')
                if (!current()) return completed
                await options.onImage(image, completed + 1, item)
                completed++
                if (completed < total) {
                    const settings = useSettingsStore.getState()
                    const delay = calculateGenerationDelay(settings.generationDelay, settings.generationDelayJitter)
                    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
                }
            }
        }
        return completed
    } finally {
        useSceneStore.getState().setStreamingData(null, null, 0)
        useSceneStore.setState({ isGenerating: false, isCancelling: false, completedCount: 0, totalQueuedCount: 0 })
        useGenerationStore.getState().setGeneratingMode(null)
        useCharacterStore.getState().releaseImageData(true)
        running = false
    }
}
