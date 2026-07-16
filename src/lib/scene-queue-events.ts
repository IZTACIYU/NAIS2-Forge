type QueueListener = () => void

const sceneListeners = new Map<string, Set<QueueListener>>()
const presetListeners = new Map<string, Set<QueueListener>>()

const sceneKey = (presetId: string, sceneId: string) => `${presetId}\u0000${sceneId}`

function subscribe(
    listeners: Map<string, Set<QueueListener>>,
    key: string,
    listener: QueueListener,
) {
    let listenersForKey = listeners.get(key)
    if (!listenersForKey) {
        listenersForKey = new Set()
        listeners.set(key, listenersForKey)
    }
    listenersForKey.add(listener)

    return () => {
        listenersForKey?.delete(listener)
        if (listenersForKey?.size === 0) listeners.delete(key)
    }
}

export function subscribeSceneQueue(
    presetId: string,
    sceneId: string,
    listener: QueueListener,
) {
    return subscribe(sceneListeners, sceneKey(presetId, sceneId), listener)
}

export function subscribePresetQueue(presetId: string, listener: QueueListener) {
    return subscribe(presetListeners, presetId, listener)
}

export function notifySceneQueueChanged(presetId: string, sceneIds: readonly string[]) {
    for (const sceneId of sceneIds) {
        sceneListeners.get(sceneKey(presetId, sceneId))?.forEach(listener => listener())
    }
    presetListeners.get(presetId)?.forEach(listener => listener())
}
