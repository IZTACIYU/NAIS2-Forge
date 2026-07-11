export const QUALITY_TAGS_SUFFIX = ', very aesthetic, masterpiece, no text'

const UC_HEAVY = 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page'

const UC_PRESETS: Record<number, string> = {
    0: UC_HEAVY,
    1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    2: '',
    3: `${UC_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`,
    4: '',
}

export const mergeQualityTags = (prompt: string, enabled: boolean) => enabled ? `${prompt}${QUALITY_TAGS_SUFFIX}` : prompt

export const mergeUcPreset = (negativePrompt: string, presetIndex: number) => {
    const preset = UC_PRESETS[presetIndex] || ''
    return preset ? (negativePrompt ? `${preset}, ${negativePrompt}` : preset) : negativePrompt
}

export const officialVarietySigma = (model: string, enabled: boolean, width: number, height: number) => {
    if (!enabled) return null
    const coefficient = model.includes('nai-diffusion-4-5') ? 58 : 19
    return coefficient * Math.sqrt((width * height) / (832 * 1216))
}
