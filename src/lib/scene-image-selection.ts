import type { SceneImage } from '@/stores/scene-store'

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
