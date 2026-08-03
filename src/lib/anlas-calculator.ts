/**
 * NovelAI Anlas Cost Calculator
 * Based on official pricing structure
 */

// Free generation limit (Opus tier)
const FREE_PIXEL_LIMIT = 1024 * 1024  // 1 megapixel
const FREE_STEPS_LIMIT = 28

// Base cost for paid generations
const BASE_ANLAS_COST = 5

export interface UnlimitedImageGenerationLimit {
    resolution: number
    maxPrompts: number
}

export interface ImageGenerationEntitlement {
    unlimitedImageGeneration: boolean
    limits: UnlimitedImageGenerationLimit[]
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

function isUnlimitedBaseGeneration(input: GenerationCostInput): boolean {
    if (!input.entitlement?.unlimitedImageGeneration || input.usesSourceImage || input.steps > FREE_STEPS_LIMIT) {
        return false
    }

    const limits = input.entitlement.limits.length > 0
        ? input.entitlement.limits
        : [{ resolution: FREE_PIXEL_LIMIT, maxPrompts: 1 }]
    const pixels = input.width * input.height

    return limits.some(limit => pixels <= limit.resolution && input.imageCount <= limit.maxPrompts)
}

/** Returns null until NovelAI has provided the current entitlement state. */
export function calculateGenerationAnlasCost(input: GenerationCostInput): number | null {
    if (!input.entitlement) return null

    const pixels = input.width * input.height
    let baseCost = 0

    if (!isUnlimitedBaseGeneration(input)) {
        baseCost = BASE_ANLAS_COST
        if (pixels > FREE_PIXEL_LIMIT) baseCost *= Math.ceil(pixels / FREE_PIXEL_LIMIT)
        if (input.steps > FREE_STEPS_LIMIT) baseCost *= Math.ceil(input.steps / FREE_STEPS_LIMIT)
    }

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
    if (totalPixels <= FREE_PIXEL_LIMIT) return 'normal'
    return 'large'
}
