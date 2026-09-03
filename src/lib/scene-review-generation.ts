export const SCENE_IMAGE_GENERATED_EVENT = 'newImageGenerated'

export interface SceneImageGeneratedDetail {
    path?: string
    presetId?: string
    sceneId?: string
}

export function addUniqueReviewHistoryImage<T extends { sceneId: string; url: string }>(
    history: T[],
    image: T,
    position: 'start' | 'end',
) {
    if (history.some(item => item.sceneId === image.sceneId && item.url === image.url)) return history
    return position === 'start' ? [image, ...history] : [...history, image]
}

export function isTrackedReviewGeneration(
    detail: SceneImageGeneratedDetail,
    activePresetId: string | null,
    trackedSceneIds: ReadonlySet<string>,
): detail is SceneImageGeneratedDetail & { path: string; sceneId: string } {
    return Boolean(
        detail.path
        && detail.sceneId
        && detail.presetId === activePresetId
        && trackedSceneIds.has(detail.sceneId),
    )
}

export function findNextReviewItem<T extends { sceneId: string }>(
    before: readonly T[],
    after: readonly T[],
    currentSceneId: string,
): T | null {
    const previousIndex = before.findIndex(item => item.sceneId === currentSceneId)
    const remainingIndex = after.findIndex(item => item.sceneId === currentSceneId)
    const nextIndex = remainingIndex >= 0 ? remainingIndex + 1 : Math.max(0, previousIndex)
    return after[nextIndex] || null
}
