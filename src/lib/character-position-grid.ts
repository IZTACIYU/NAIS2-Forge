export const CHARACTER_POSITION_GRID_SIZE = 5

export function snapCharacterPosition(value: number) {
    const clamped = Math.max(0, Math.min(1, value))
    const cell = Math.min(
        CHARACTER_POSITION_GRID_SIZE - 1,
        Math.floor(clamped * CHARACTER_POSITION_GRID_SIZE)
    )
    return (cell + 0.5) / CHARACTER_POSITION_GRID_SIZE
}

export function getCharacterPositionBoardAspectRatio(width: number, height: number) {
    if (width === height) return 1
    return width > height ? 3 / 2 : 2 / 3
}
