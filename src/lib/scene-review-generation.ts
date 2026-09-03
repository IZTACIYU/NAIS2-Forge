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
