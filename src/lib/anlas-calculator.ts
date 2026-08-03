/**
 * NovelAI Anlas Cost Calculator
 * Based on official pricing structure
 */

const NORMAL_PIXEL_LIMIT = 1024 * 1024
const FREE_STEPS_LIMIT = 28
const OPUS_FREE_BASE_COST_LIMIT = 20
const V4_PIXEL_COST = 2.951823174884865e-6
const V4_STEP_PIXEL_COST = 5.753298233447344e-7

export interface ImageGenerationEntitlement {
    unlimitedImageGeneration: boolean
}

interface GenerationCostInput {
    width: number
    height: number
    steps: number
    imageCount: number
    characterReferenceCount: number
    uncachedVibeCount: number
    usesSourceImage: boolean
    entitlement: ImageGenerationEntitlement | null
}

function calculateBaseImageGenerationCost(width: number, height: number, steps: number): number {
    const pixels = width * height
    return Math.ceil(V4_PIXEL_COST * pixels + V4_STEP_PIXEL_COST * pixels * steps)
}

function isUnlimitedBaseGeneration(input: GenerationCostInput, baseCost: number): boolean {
    if (!input.entitlement?.unlimitedImageGeneration || input.usesSourceImage || input.steps > FREE_STEPS_LIMIT) {
        return false
    }

    return input.imageCount === 1 && baseCost <= OPUS_FREE_BASE_COST_LIMIT
}

/** Returns null until NovelAI has provided the current entitlement state. */
export function calculateGenerationAnlasCost(input: GenerationCostInput): number | null {
    if (!input.entitlement) return null

    const calculatedBaseCost = calculateBaseImageGenerationCost(input.width, input.height, input.steps)
    const baseCost = isUnlimitedBaseGeneration(input, calculatedBaseCost) ? 0 : calculatedBaseCost

    const perImageCost = baseCost + calculateExtraCost(input.characterReferenceCount, input.uncachedVibeCount)
    return perImageCost * input.imageCount
}

/**
 * Calculate ONLY the extra costs from features (Char Ref, Vibe Transfer)
 * Does not include base cost (Resolution/Steps) or Batch multiplier
 */
export function calculateExtraCost(charCount: number, vibeCount: number): number {
    let cost = 0
    if (charCount > 0) cost += charCount * 5
    if (vibeCount > 0) cost += (vibeCount * 2)
    return cost
}

/**
 * Get pixel count category
 */
export function getPixelCategory(width: number, height: number): 'small' | 'normal' | 'large' {
    const totalPixels = width * height
    if (totalPixels < 512 * 512) return 'small'
    if (totalPixels <= NORMAL_PIXEL_LIMIT) return 'normal'
    return 'large'
}
