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

export function getSceneImageExtension(url: string) {
    const match = url.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#)?$/)
    if (match?.[1] === 'jpeg') return 'jpg'
    return match?.[1] || 'png'
}

export function getUniqueSceneOutputFileName({
    sceneName,
    enabled,
    part,
    extension,
    usedFileNames,
    fallback,
}: {
    sceneName: string
    enabled: boolean
    part: SceneExportNamePart
    extension: string
    usedFileNames: Set<string>
    fallback: string
}) {
    const exportName = getSceneExportName(sceneName, enabled, part)
    const safeName = exportName.replace(/[<>:"/\\|?*]/g, '_').trim() || fallback
    let fileName = `${safeName}.${extension}`
    let duplicateIndex = 2
    while (usedFileNames.has(fileName.toLocaleLowerCase())) {
        fileName = `${safeName}_${duplicateIndex}.${extension}`
        duplicateIndex++
    }
    usedFileNames.add(fileName.toLocaleLowerCase())
    return fileName
}
