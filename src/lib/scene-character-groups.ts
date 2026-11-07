import type { SceneCard, SceneImage } from '@/stores/scene-store'
import { getRandomCharacterDisplayName } from './random-character-selection'
import { pickSceneRepresentativeImage } from './scene-image-selection'

export interface SceneImageCharacters {
    names: string[]
    failed?: boolean
}
export type SceneCharacterIndex = Map<string, SceneImageCharacters>
export const sceneCharacterImageKey = (image: SceneImage) => image.url.startsWith('data:') ? image.url : JSON.stringify([image.id, image.url, image.timestamp])

export function getForgeCharacterNames(value: unknown): string[] {
    if (!value || typeof value !== 'object') return []
    const entries = (value as { characterPrompts?: unknown }).characterPrompts
    if (!Array.isArray(entries)) return []
    return [...new Set(entries.flatMap(entry => {
        if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return []
        const name = getRandomCharacterDisplayName({ name: entry.name, prompt: entry.name }).normalize('NFC')
        return name ? [name] : []
    }))].sort()
}

export function groupSceneCharacterImages(images: readonly SceneImage[], index: SceneCharacterIndex) {
    const groups = new Map<string, { key: string; names: string[]; images: SceneImage[] }>()
    for (const [position, image] of images.entries()) {
        const names = index.get(sceneCharacterImageKey(image))?.names || []
        // Unknown images stay separate; missing metadata must not hide other images.
        const key = names.length ? JSON.stringify(names) : JSON.stringify(['image', position, image.id, image.timestamp])
        const group = groups.get(key)
        if (group) group.images.push(image)
        else groups.set(key, { key, names, images: [image] })
    }
    return [...groups.values()].map(group => {
        const top = pickSceneRepresentativeImage(group.images)!
        return { ...group, top, images: [top, ...group.images.filter(image => image !== top)] }
    })
}

export function collectSceneCharacterNames(scenes: readonly SceneCard[], index: SceneCharacterIndex) {
    return [...new Set(scenes.slice(0, 4).flatMap(scene => scene.images.flatMap(image =>
        index.get(sceneCharacterImageKey(image))?.names || [],
    )))].sort()
}

export function selectCharacterExportScenes(scenes: readonly SceneCard[], index: SceneCharacterIndex, selected: ReadonlySet<string>, stacks: boolean) {
    const byCharacter = new Map([...selected].map(name => [name, [] as SceneCard[]]))
    let unknown = 0, ambiguous = 0, failed = 0
    for (const scene of scenes) {
        const candidates = new Map<string, SceneImage[]>()
        const groups = groupSceneCharacterImages(scene.images, index)
        for (const group of groups) {
            const matching = group.names.filter(name => selected.has(name))
            const images = stacks ? [group.top] : group.images
            for (const image of images) {
                const info = index.get(sceneCharacterImageKey(image))
                if (info?.failed) { failed++; continue }
                if (!info?.names.length) { unknown++; continue }
                if (matching.length > 1) { ambiguous++; continue }
                if (matching.length === 1) {
                    const bucket = candidates.get(matching[0]) || []
                    bucket.push(image); candidates.set(matching[0], bucket)
                }
            }
        }
        for (const [name, images] of candidates) {
            const representative = pickSceneRepresentativeImage(images)
            if (representative) byCharacter.get(name)!.push({ ...scene, images: [representative] })
        }
    }
    return { byCharacter, unknown, ambiguous, failed }
}
