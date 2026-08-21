export type UcPresetId = 0 | 1 | 2 | 3 | 4
export type ModelMode = 'anime' | 'furry'
export type QualityTagPresetId = 'standard' | 'light' | 'none'

export interface UcPresetOption {
    value: UcPresetId
    label: 'heavy' | 'light' | 'furryFocus' | 'humanFocus' | 'none'
    prefix?: string
}

export interface ModelModeOption {
    value: ModelMode
    label: 'Anime' | 'Furry'
    promptPrefix?: string
}

export interface QualityTagPresetOption {
    value: QualityTagPresetId
    label: 'Standard' | 'Light' | 'None'
    suffix: string
}

export interface ModelCapabilities {
    maxCharacterPrompts: number
    maxPromptTokens: number
    ucPresets: readonly UcPresetOption[]
    qualityTagPresets: readonly QualityTagPresetOption[]
    modes: readonly ModelModeOption[]
    supportsSmea: boolean
    supportsVariety: boolean
}

export interface AvailableModel extends ModelCapabilities {
    id: string
    name: string
}

const NONE_QUALITY_TAGS: QualityTagPresetOption = { value: 'none', label: 'None', suffix: '' }
const V5_MODES: readonly ModelModeOption[] = [
    { value: 'anime', label: 'Anime' },
    { value: 'furry', label: 'Furry', promptPrefix: 'fur dataset' },
]

const V4_CAPABILITIES: ModelCapabilities = {
    maxCharacterPrompts: 6,
    maxPromptTokens: 512,
    supportsSmea: false,
    supportsVariety: true,
    modes: [],
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', no text, best quality, very aesthetic, absurdres' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'nsfw, blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page' },
        { value: 1, label: 'light', prefix: 'nsfw, blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page' },
        { value: 4, label: 'none' },
    ],
}

const V4_CURATED_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', rating:general, best quality, very aesthetic, absurdres' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page' },
        { value: 1, label: 'light', prefix: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page' },
        { value: 4, label: 'none' },
    ],
}

const V45_FULL_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', very aesthetic, masterpiece, no text' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
        { value: 1, label: 'light', prefix: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page' },
        { value: 2, label: 'furryFocus', prefix: 'nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
        { value: 3, label: 'humanFocus', prefix: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
        { value: 4, label: 'none' },
    ],
}

const V45_CURATED_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', very aesthetic, masterpiece, no text, -0.8::feet::, rating:general' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page' },
        { value: 1, label: 'light', prefix: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page' },
        { value: 3, label: 'humanFocus', prefix: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page' },
        { value: 4, label: 'none' },
    ],
}

const V5_FULL_CAPABILITIES: ModelCapabilities = {
    ...V45_FULL_CAPABILITIES,
    maxCharacterPrompts: 32,
    maxPromptTokens: 1471,
    supportsVariety: false,
    modes: V5_MODES,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', very aesthetic, masterpiece, no text' },
        { value: 'light', label: 'Light', suffix: ', very aesthetic, amazing quality, no text' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
        { value: 1, label: 'light', prefix: 'nsfw, lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::' },
        { value: 2, label: 'furryFocus', prefix: 'nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
        { value: 3, label: 'humanFocus', prefix: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
        { value: 4, label: 'none' },
    ],
}

const V5_CURATED_CAPABILITIES: ModelCapabilities = {
    ...V45_CURATED_CAPABILITIES,
    maxCharacterPrompts: 32,
    maxPromptTokens: 703,
    supportsVariety: false,
    modes: V5_MODES,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', very aesthetic, masterpiece, no text' },
        { value: 'light', label: 'Light', suffix: ', very aesthetic, amazing quality, no text' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page' },
        { value: 1, label: 'light', prefix: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::' },
        { value: 2, label: 'furryFocus', prefix: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic' },
        { value: 3, label: 'humanFocus', prefix: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy' },
        { value: 4, label: 'none' },
    ],
}

const V3_ANIME_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    supportsSmea: true,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', best quality, amazing quality, very aesthetic, absurdres' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]' },
        { value: 1, label: 'light', prefix: 'nsfw, lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing' },
        { value: 3, label: 'humanFocus', prefix: 'nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes' },
        { value: 4, label: 'none' },
    ],
}

const V3_FURRY_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    supportsSmea: true,
    qualityTagPresets: [
        { value: 'standard', label: 'Standard', suffix: ', {best quality}, {amazing quality}' },
        NONE_QUALITY_TAGS,
    ],
    ucPresets: [
        { value: 0, label: 'heavy', prefix: 'nsfw, {{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast' },
        { value: 1, label: 'light', prefix: 'nsfw, {worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text' },
        { value: 4, label: 'none' },
    ],
}

// Add new model versions and their complete parameter definitions here.
export const AVAILABLE_MODELS: readonly AvailableModel[] = [
    { id: 'nai-diffusion-5-curated', name: 'NAI Diffusion V5 Curated', ...V5_CURATED_CAPABILITIES },
    { id: 'nai-diffusion-5-full', name: 'NAI Diffusion V5 Full', ...V5_FULL_CAPABILITIES },
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated', ...V45_CURATED_CAPABILITIES },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full', ...V45_FULL_CAPABILITIES },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated', ...V4_CURATED_CAPABILITIES },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-3', name: 'NAI Diffusion V3 (Anime)', ...V3_ANIME_CAPABILITIES },
    { id: 'nai-diffusion-furry-3', name: 'NAI Diffusion Furry V3', ...V3_FURRY_CAPABILITIES },
]

export const getModelCapabilities = (modelId: string): ModelCapabilities =>
    AVAILABLE_MODELS.find(model => model.id === modelId) || V4_CAPABILITIES

export const normalizeUcPreset = (modelId: string, preset: number): UcPresetId => {
    const options = getModelCapabilities(modelId).ucPresets
    return options.some(option => option.value === preset) ? preset as UcPresetId : options[0].value
}

export const normalizeModelMode = (modelId: string, mode: ModelMode): ModelMode => {
    const options = getModelCapabilities(modelId).modes
    return options.some(option => option.value === mode) ? mode : options[0]?.value ?? 'anime'
}

export const normalizeQualityTagPreset = (
    modelId: string,
    preset: QualityTagPresetId,
): QualityTagPresetId => {
    const options = getModelCapabilities(modelId).qualityTagPresets
    return options.some(option => option.value === preset) ? preset : options[0]?.value ?? 'none'
}
