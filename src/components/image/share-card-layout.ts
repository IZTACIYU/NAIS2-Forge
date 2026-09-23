const PADDING = 32
const PROMPT_HEIGHT = (lines: number) => 55 + Math.max(1, lines) * 23

export function getShareCardLayout(imageWidth: number, imageHeight: number, positiveLines: number, negativeLines: number) {
    const sideBySide = imageWidth <= imageHeight
    const width = sideBySide ? 1700 : 720
    const image = sideBySide
        ? { x: PADDING, y: PADDING, width: 464, height: 676 }
        : { x: PADDING, y: PADDING, width: 656, height: 400 }
    const textX = sideBySide ? 528 : PADDING
    const textY = sideBySide ? PADDING : PADDING + image.height + 24
    const textWidth = sideBySide ? 350 : width - PADDING * 2
    const negativeX = sideBySide ? 898 : textX
    const parametersX = sideBySide ? 1268 : textX
    const parametersWidth = sideBySide ? 400 : textWidth
    const textHeight = 78 + PROMPT_HEIGHT(positiveLines) + 12
        + PROMPT_HEIGHT(negativeLines) + 12 + 85 * 4
    const horizontalContentBottom = Math.max(
        textY + PROMPT_HEIGHT(positiveLines),
        textY + PROMPT_HEIGHT(negativeLines),
        textY + 78 + 85 * 4,
    )
    const height = Math.max(image.y + image.height, sideBySide ? horizontalContentBottom : textY + textHeight) + PADDING
    return { sideBySide, width, height, image, textX, textY, textWidth, negativeX, parametersX, parametersWidth }
}
