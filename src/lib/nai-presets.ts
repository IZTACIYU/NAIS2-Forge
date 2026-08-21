import {
    getModelCapabilities,
    normalizeQualityTagPreset,
    type QualityTagPresetId,
} from '@/lib/model-capabilities'

export const mergeQualityTags = (
    prompt: string,
    model: string,
    enabled: boolean,
    selectedPreset: QualityTagPresetId = 'standard',
) => {
    const capabilities = getModelCapabilities(model)
    const preset = capabilities.qualityTagPresets.find(option =>
        option.value === normalizeQualityTagPreset(
            model,
            capabilities.qualityTagPresets.length > 2
                ? selectedPreset
                : enabled ? 'standard' : 'none',
        )
    )
    return preset?.suffix ? prompt + preset.suffix : prompt
}

export const mergeUcPreset = (negativePrompt: string, model: string, preset: number) => {
    const prefix = getModelCapabilities(model).ucPresets.find(option => option.value === preset)?.prefix
    if (!prefix) return negativePrompt
    return negativePrompt ? prefix + ', ' + negativePrompt : prefix
}
