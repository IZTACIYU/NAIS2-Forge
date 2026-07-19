import { invoke } from '@tauri-apps/api/core'
import { join, pictureDir } from '@tauri-apps/api/path'
import type { LibraryItem } from '@/stores/library-store'
import type { ScenePreset } from '@/stores/scene-store'

export interface FolderMove {
    sourcePath: string
    destinationPath: string
}

export interface PathMapping {
    oldPath: string
    newPath: string
}

export interface FolderMigrationResult {
    filesMoved: number
    bytesMoved: number
    cleanupFailures: number
}

export interface SaveFolderMigration {
    moves: FolderMove[]
    sceneMappings: PathMapping[]
}

function normalizePath(path: string): string {
    return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase()
}

function trimTrailingSeparators(path: string): string {
    const trimmed = path.trim()
    if (trimmed === '/' || /^[A-Za-z]:[\\/]$/.test(trimmed)) return trimmed
    return trimmed.replace(/[\\/]+$/, '')
}

function pathsEqual(left: string, right: string): boolean {
    return normalizePath(left) === normalizePath(right)
}

function addMove(moves: FolderMove[], sourcePath: string, destinationPath: string) {
    if (!pathsEqual(sourcePath, destinationPath)) moves.push({ sourcePath, destinationPath })
}

function addMapping(mappings: PathMapping[], oldPath: string, newPath: string) {
    if (!pathsEqual(oldPath, newPath)) mappings.push({ oldPath, newPath })
}

export async function resolveConfiguredFolder(
    path: string,
    useAbsolutePath: boolean,
    fallback: string,
): Promise<string> {
    if (useAbsolutePath && path.trim()) return trimTrailingSeparators(path)
    return join(await pictureDir(), path.trim() || fallback)
}

export async function createSaveFolderMigration(
    currentPath: string,
    currentAbsolute: boolean,
    nextPath: string,
    nextAbsolute: boolean,
): Promise<SaveFolderMigration> {
    const pictures = await pictureDir()
    const oldMain = await resolveConfiguredFolder(currentPath, currentAbsolute, 'NAIS_Output')
    const newMain = await resolveConfiguredFolder(nextPath, nextAbsolute, 'NAIS_Output')
    const oldScene = currentAbsolute
        ? await join(oldMain, 'NAIS_Scene')
        : await join(pictures, 'NAIS_Scene')
    const newScene = nextAbsolute
        ? await join(newMain, 'NAIS_Scene')
        : await join(pictures, 'NAIS_Scene')
    const moves: FolderMove[] = []

    // When leaving an absolute root, move its nested scene folder first so the
    // parent migration cannot place it in the relative output directory.
    if (currentAbsolute && !nextAbsolute) {
        addMove(moves, oldScene, newScene)
        addMove(moves, oldMain, newMain)
    } else {
        addMove(moves, oldMain, newMain)
        if (currentAbsolute !== nextAbsolute) addMove(moves, oldScene, newScene)
    }

    const sceneMappings: PathMapping[] = []
    addMapping(sceneMappings, oldScene, newScene)
    return { moves, sceneMappings }
}

export function replacePathPrefix(path: string, mapping: PathMapping): string {
    const normalizedPath = normalizePath(path)
    const normalizedRoot = normalizePath(mapping.oldPath)
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(normalizedRoot + '\\')) {
        return path
    }
    return mapping.newPath + path.slice(mapping.oldPath.length)
}

export function remapPath(path: string, mappings: PathMapping[]): string {
    let nextPath = path
    for (const mapping of mappings) nextPath = replacePathPrefix(nextPath, mapping)
    return nextPath
}

export function remapLibraryItems(items: LibraryItem[], mappings: PathMapping[]): LibraryItem[] {
    let changed = false
    const nextItems = items.map(item => {
        const path = remapPath(item.path, mappings)
        const thumbnailPath = item.thumbnailPath
            ? remapPath(item.thumbnailPath, mappings)
            : undefined
        const stackItems = item.stackItems
            ? remapLibraryItems(item.stackItems, mappings)
            : undefined
        const itemChanged = path !== item.path
            || thumbnailPath !== item.thumbnailPath
            || stackItems !== item.stackItems
        if (!itemChanged) return item
        changed = true
        return { ...item, path, thumbnailPath, stackItems }
    })
    return changed ? nextItems : items
}

export function remapScenePresetImages(presets: ScenePreset[], mappings: PathMapping[]): ScenePreset[] {
    let changed = false
    const nextPresets = presets.map(preset => {
        let presetChanged = false
        const scenes = preset.scenes.map(scene => {
            let sceneChanged = false
            const images = scene.images.map(image => {
                const url = remapPath(image.url, mappings)
                if (url === image.url) return image
                sceneChanged = true
                return { ...image, url }
            })
            if (!sceneChanged) return scene
            presetChanged = true
            return { ...scene, images }
        })
        if (!presetChanged) return preset
        changed = true
        return { ...preset, scenes }
    })
    return changed ? nextPresets : presets
}

export async function migrateFolders(moves: FolderMove[]): Promise<FolderMigrationResult> {
    if (moves.length === 0) return { filesMoved: 0, bytesMoved: 0, cleanupFailures: 0 }
    return invoke<FolderMigrationResult>('migrate_folders', { moves })
}
