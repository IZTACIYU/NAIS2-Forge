import type { SceneCard } from '@/stores/scene-store'
import { pickSceneRepresentativeImage } from './scene-image-selection'
import { getUniqueSceneOutputFileName, type SceneExportNamePart } from './scene-export-name'

export function createSceneZipEntries(scenes: readonly SceneCard[], format: string, enabled: boolean, part: SceneExportNamePart) {
    const usedFileNames = new Set<string>()
    const entries: Array<{ source: string; fileName: string }> = []
    for (const scene of scenes) {
        const image = pickSceneRepresentativeImage(scene.images)
        if (image) entries.push({ source: image.url, fileName: getUniqueSceneOutputFileName({
            sceneName: scene.name, enabled, part, extension: format === 'jpeg' ? 'jpg' : format,
            usedFileNames, fallback: `Scene_${entries.length}`,
        }) })
    }
    return entries
}

export function getCharacterZipName(name: string, used: Set<string>) {
    const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120) || 'Character'
    return getUniqueSceneOutputFileName({ sceneName: /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe,
        enabled: false, part: 'prefix', extension: 'zip', usedFileNames: used, fallback: 'Character' })
}
