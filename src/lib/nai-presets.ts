import {
    getModelCapabilities,
    normalizeQualityTagPreset,
    type QualityTagPresetId,
} from './model-capabilities.ts'

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

export const stripQualityTags = (
    prompt: string,
    model: string,
    selectedPreset: QualityTagPresetId,
) => {
    const suffix = getModelCapabilities(model).qualityTagPresets
        .find(option => option.value === selectedPreset)?.suffix
    return suffix && prompt.endsWith(suffix) ? prompt.slice(0, -suffix.length) : prompt
}

export const stripUcPreset = (negativePrompt: string, model: string, preset: number) => {
    const prefix = getModelCapabilities(model).ucPresets.find(option => option.value === preset)?.prefix
    if (!prefix) return negativePrompt
    if (negativePrompt === prefix) return ''
    const mergedPrefix = prefix + ', '
    return negativePrompt.startsWith(mergedPrefix)
        ? negativePrompt.slice(mergedPrefix.length)
        : negativePrompt
}
