export type SceneExportNamePart = 'prefix' | 'middle' | 'suffix'

export function getSceneExportName(sceneName: string, enabled: boolean, part: SceneExportNamePart) {
    if (!enabled) return sceneName

    const parts = sceneName
        .split(/[\p{P}\p{S}]+/gu)
        .map(value => value.trim())
        .filter(Boolean)

    if (parts.length < 2) return sceneName
    if (part === 'prefix') return parts[0]
    if (part === 'suffix') return parts[parts.length - 1]
    return parts.length > 2 ? parts[Math.floor(parts.length / 2)] : sceneName
}
