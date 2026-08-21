export const CHARACTER_POSITION_GRID_SIZE = 5
export type CharacterPositionMode = 'grid' | 'free'

export interface CharacterPositionRect {
    left: number
    top: number
    width: number
    height: number
}

export function clampCharacterPosition(value: number) {
    return Math.max(0, Math.min(1, value))
}

export function snapCharacterPosition(value: number) {
    const clamped = clampCharacterPosition(value)
    const cell = Math.min(
        CHARACTER_POSITION_GRID_SIZE - 1,
        Math.floor(clamped * CHARACTER_POSITION_GRID_SIZE)
    )
    return (cell + 0.5) / CHARACTER_POSITION_GRID_SIZE
}

export function resolveCharacterPosition(value: number, mode: CharacterPositionMode) {
    return mode === 'grid' ? snapCharacterPosition(value) : clampCharacterPosition(value)
}

export function fitCharacterPositionRect(
    container: CharacterPositionRect,
    aspectRatio: number,
    padding = 24,
): CharacterPositionRect {
    const availableWidth = Math.max(1, container.width - padding * 2)
    const availableHeight = Math.max(1, container.height - padding * 2)
    const width = Math.min(availableWidth, availableHeight * aspectRatio)
    const height = width / aspectRatio
    return {
        left: container.left + (container.width - width) / 2,
        top: container.top + (container.height - height) / 2,
        width,
        height,
    }
}

export function getContainedImageRect(
    container: CharacterPositionRect,
    imageWidth: number,
    imageHeight: number,
): CharacterPositionRect {
    return fitCharacterPositionRect(container, imageWidth / imageHeight, 0)
}

export function getCharacterPositionBoardAspectRatio(width: number, height: number) {
    if (width === height) return 1
    return width > height ? 3 / 2 : 2 / 3
}
