interface SceneImagePathLike {
    url: string
}

export interface SceneFolderPathMapping {
    oldFolder: string
    newFolder: string
}

interface ScenePresetPathLike {
    id: string
    scenes: Array<{ id: string; images: SceneImagePathLike[] }>
}

export function sanitizeSceneFolderName(name: string, fallback = 'Untitled_Scene'): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || fallback
}

export function getSceneFolderFromImages(images: SceneImagePathLike[]): string | undefined {
    for (const image of images) {
        const path = image.url.trim()
        if (!path || path.startsWith('data:') || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue

        const separatorIndex = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
        if (separatorIndex > 0) return path.slice(0, separatorIndex)
    }

    return undefined
}

export function findSceneImageOwner(presets: ScenePresetPathLike[], sourcePath?: string) {
    if (!sourcePath) return undefined
    for (const preset of presets) {
        const scene = preset.scenes.find(candidate => candidate.images.some(image => image.url === sourcePath))
        if (scene) return { presetId: preset.id, sceneId: scene.id }
    }
    return undefined
}

export function replaceSceneFolderPrefix(path: string, oldFolder: string, newFolder: string): string {
    const normalizedPath = path.toLocaleLowerCase()
    const normalizedFolder = oldFolder.toLocaleLowerCase()
    if (normalizedPath !== normalizedFolder
        && !normalizedPath.startsWith(normalizedFolder + '\\')
        && !normalizedPath.startsWith(normalizedFolder + '/')) {
        return path
    }

    return newFolder + path.slice(oldFolder.length)
}

export function replaceSceneFolderPrefixes(path: string, mappings: SceneFolderPathMapping[]): string {
    return mappings.reduce(
        (current, mapping) => replaceSceneFolderPrefix(current, mapping.oldFolder, mapping.newFolder),
        path,
    )
}
