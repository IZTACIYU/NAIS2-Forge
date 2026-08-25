type ScenePromptDraftFlusher = () => void

const flushers = new Set<ScenePromptDraftFlusher>()

export function subscribeScenePromptDraftFlush(flusher: ScenePromptDraftFlusher) {
    flushers.add(flusher)
    return () => {
        flushers.delete(flusher)
    }
}

export function flushScenePromptDrafts() {
    flushers.forEach(flusher => flusher())
}
