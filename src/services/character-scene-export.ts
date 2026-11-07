import { exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import type { SceneCard } from '@/stores/scene-store'
import type { ImageOutputFormat } from '@/components/ui/image-output-options'
import { selectCharacterExportScenes, type SceneCharacterIndex } from '@/lib/scene-character-groups'
import { createSceneZipEntries, getCharacterZipName } from '@/lib/scene-zip-entries'
import type { SceneExportNamePart } from '@/lib/scene-export-name'
import { indexSceneCharacters } from './scene-character-images'
import { exportSceneZip } from './scene-zip'

export async function exportCharacterScenes(options: {
    scenes: SceneCard[]; index: SceneCharacterIndex; selected: Set<string>; stacks: boolean;
    directory: string; format: ImageOutputFormat; quality: number; namingEnabled: boolean; namePart: SceneExportNamePart;
    shouldContinue: () => boolean; onProgress: (name: string, current: number, total: number, percent: number) => void;
}) {
    await indexSceneCharacters(options.scenes, options.index, options.shouldContinue)
    const plan = selectCharacterExportScenes(options.scenes, options.index, options.selected, options.stacks)
    const usedNames = new Set<string>()
    let archives = 0, images = 0, skipped = 0, current = 0
    for (const [name, scenes] of plan.byCharacter) {
        if (!options.shouldContinue()) break
        current++
        const entries = createSceneZipEntries(scenes, options.format, options.namingEnabled, options.namePart)
        if (!entries.length) continue
        let path: string
        do { path = await join(options.directory, getCharacterZipName(name, usedNames)) }
        while (await exists(path) || await exists(`${path}.partial`))
        options.onProgress(name, current, options.selected.size, 0)
        const result = await exportSceneZip(path, entries, options.format, options.quality,
            percent => options.onProgress(name, current, options.selected.size, percent))
        if (result.exportedCount > 0) archives++
        images += result.exportedCount; skipped += result.skippedCount
    }
    return { archives, images, skipped, unknown: plan.unknown, ambiguous: plan.ambiguous, failed: plan.failed }
}
