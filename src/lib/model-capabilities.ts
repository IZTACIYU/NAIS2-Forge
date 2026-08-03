export interface ModelCapabilities {
    maxCharacterPrompts: number
    maxPromptTokens: number
}

export interface AvailableModel extends ModelCapabilities {
    id: string
    name: string
}

const V4_CAPABILITIES: ModelCapabilities = {
    maxCharacterPrompts: 6,
    maxPromptTokens: 512,
}

// Add new model versions and their limits here. All UI and generation paths use this table.
export const AVAILABLE_MODELS: readonly AvailableModel[] = [
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-4-curated-preview', name: 'NAI Diffusion V4 Curated', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-4-full', name: 'NAI Diffusion V4 Full', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-3', name: 'NAI Diffusion V3 (Anime)', ...V4_CAPABILITIES },
    { id: 'nai-diffusion-furry-3', name: 'NAI Diffusion Furry V3', ...V4_CAPABILITIES },
]

export const getModelCapabilities = (modelId: string): ModelCapabilities =>
    AVAILABLE_MODELS.find(model => model.id === modelId) || V4_CAPABILITIES
