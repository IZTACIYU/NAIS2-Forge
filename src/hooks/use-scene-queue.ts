import { useCallback, useSyncExternalStore } from 'react'
import { subscribePresetQueue, subscribeSceneQueue } from '@/lib/scene-queue-events'
import { useSceneStore } from '@/stores/scene-store'

function getSceneQueueCount(presetId: string | null, sceneId: string) {
    if (!presetId) return 0
    const preset = useSceneStore.getState().presets.find(candidate => candidate.id === presetId)
    return preset?.scenes.find(scene => scene.id === sceneId)?.queueCount ?? 0
}

function getPresetQueueTotal(presetId: string | null) {
    if (!presetId) return 0
    const preset = useSceneStore.getState().presets.find(candidate => candidate.id === presetId)
    return preset?.scenes.reduce((total, scene) => total + scene.queueCount, 0) ?? 0
}

export function useSceneQueueCount(presetId: string | null, sceneId: string) {
    const subscribe = useCallback(
        (listener: () => void) => presetId
            ? subscribeSceneQueue(presetId, sceneId, listener)
            : () => {},
        [presetId, sceneId],
    )
    const getSnapshot = useCallback(
        () => getSceneQueueCount(presetId, sceneId),
        [presetId, sceneId],
    )

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSceneQueueTotal(presetId: string | null) {
    const subscribe = useCallback(
        (listener: () => void) => presetId
            ? subscribePresetQueue(presetId, listener)
            : () => {},
        [presetId],
    )
    const getSnapshot = useCallback(() => getPresetQueueTotal(presetId), [presetId])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSceneQueueHasItems(presetId: string | null) {
    const subscribe = useCallback(
        (listener: () => void) => presetId
            ? subscribePresetQueue(presetId, listener)
            : () => {},
        [presetId],
    )
    const getSnapshot = useCallback(() => getPresetQueueTotal(presetId) > 0, [presetId])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
