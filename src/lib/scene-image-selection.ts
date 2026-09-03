import type { SceneCard, SceneImage } from '@/stores/scene-store'

export interface SceneReviewDecision {
    status: 'passed' | 'failed'
    image: SceneImage
}

export type SceneReviewDecisions = Record<string, SceneReviewDecision>

export function pickSceneRepresentativeImage(images: readonly SceneImage[]): SceneImage | null {
    let newest: SceneImage | null = null
    let newestFavorite: SceneImage | null = null

    for (const image of images) {
        if (!newest || image.timestamp > newest.timestamp) newest = image
        if (image.isFavorite && (!newestFavorite || image.timestamp > newestFavorite.timestamp)) {
            newestFavorite = image
        }
    }

    return newestFavorite || newest
}

export function applySceneReviewDecisions(scenes: SceneCard[], decisions: SceneReviewDecisions | null): SceneCard[] {
    if (decisions === null) return scenes

    return scenes.flatMap(scene => {
        const decision = decisions[scene.id]
        if (decision?.status !== 'passed') return []
        const image = scene.images.find(candidate => candidate.url === decision.image.url)
        return image ? [{ ...scene, images: [image] }] : []
    })
}
