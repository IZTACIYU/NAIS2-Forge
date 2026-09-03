export const SCENE_IMAGE_GENERATED_EVENT = 'newImageGenerated'

export interface SceneImageGeneratedDetail {
    path?: string
    presetId?: string
    sceneId?: string
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
