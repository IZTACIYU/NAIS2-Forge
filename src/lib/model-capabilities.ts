export type UcPresetId = 0 | 1 | 2 | 3 | 4

export interface UcPresetOption {
    value: UcPresetId
    label: 'heavy' | 'light' | 'furryFocus' | 'humanFocus' | 'none'
}

export interface ModelCapabilities {
    maxCharacterPrompts: number
    maxPromptTokens: number
    ucPresets: readonly UcPresetOption[]
}

export interface AvailableModel extends ModelCapabilities {
    id: string
    name: string
}

const V4_CAPABILITIES: ModelCapabilities = {
    maxCharacterPrompts: 6,
    maxPromptTokens: 512,
    ucPresets: [
        { value: 0, label: 'heavy' },
        { value: 1, label: 'light' },
        { value: 4, label: 'none' },
    ],
}

const V45_CAPABILITIES: ModelCapabilities = {
    ...V4_CAPABILITIES,
    ucPresets: [
        { value: 0, label: 'heavy' },
        { value: 1, label: 'light' },
        { value: 2, label: 'furryFocus' },
        { value: 3, label: 'humanFocus' },
        { value: 4, label: 'none' },
    ],
}

// Add new model versions and their limits here. All UI and generation paths use this table.
export const AVAILABLE_MODELS: readonly AvailableModel[] = [
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated', ...V45_CAPABILITIES },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full', ...V45_CAPABILITIES },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-3', name: 'NAI Diffusion V3 (Anime)', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-furry-3', name: 'NAI Diffusion Furry V3', ...V4_CAPABILITIES },
]

export const getModelCapabilities = (modelId: string): ModelCapabilities =>
    AVAILABLE_MODELS.find(model => model.id === modelId) || V4_CAPABILITIES

export const normalizeUcPreset = (modelId: string, preset: number): UcPresetId => {
    const options = getModelCapabilities(modelId).ucPresets
    return options.some(option => option.value === preset)
        ? preset as UcPresetId
        : options[0].value
}
