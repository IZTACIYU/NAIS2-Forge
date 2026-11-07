import { readFile } from '@tauri-apps/plugin-fs'
import { readNais2Params } from '@/lib/nais2-png-meta'
import { parseNAIMetadata } from '@/lib/metadata-parser'
import { getForgeCharacterNames, sceneCharacterImageKey, type SceneCharacterIndex } from '@/lib/scene-character-groups'
import type { SceneCard } from '@/stores/scene-store'

export async function indexSceneCharacters(scenes: readonly Pick<SceneCard, 'images'>[], cache: SceneCharacterIndex, shouldContinue: () => boolean) {
    for (const scene of scenes) {
        for (const image of scene.images) {
            if (!shouldContinue()) return
            const key = sceneCharacterImageKey(image)
            if (cache.has(key)) continue
            try {
                const bytes = image.url.startsWith('data:')
                    ? new Uint8Array(await (await fetch(image.url)).arrayBuffer())
                    : await readFile(image.url)
                if (!shouldContinue()) return
                const own = readNais2Params(bytes)
                const sources = own?.generationSources ?? (await parseNAIMetadata(bytes))?.generationSources
                if (!shouldContinue()) return
                cache.set(key, { names: getForgeCharacterNames(sources) })
            } catch {
                if (!shouldContinue()) return
                cache.set(key, { names: [], failed: true })
            }
        }
    }
}
