import {
    AVAILABLE_MODELS,
    getModelCapabilities,
    normalizeModelMode,
    normalizeQualityTagPreset,
    normalizeUcPreset,
    type ModelMode,
    type QualityTagPresetId,
} from './model-capabilities.ts'

export interface ModelSpecificOptions {
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean
    modelMode: ModelMode
    qualityToggle: boolean
    qualityTagPreset: QualityTagPresetId
    ucPreset: number
    transparentBackground: boolean
    selectedResolution: {
        label: string
        width: number
        height: number
    }
}

export type ModelOptionMemory = Record<string, ModelSpecificOptions>

export const normalizeModelSpecificOptions = (
    model: string,
    options?: Partial<ModelSpecificOptions>,
    fallback?: Partial<ModelSpecificOptions>,
): ModelSpecificOptions => {
    const numberValue = (key: 'steps' | 'cfgScale' | 'cfgRescale', defaultValue: number) => {
        const value = options?.[key] ?? fallback?.[key]
        return typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
    }
    const stringValue = (key: 'sampler' | 'scheduler', defaultValue: string) => {
        const value = options?.[key] ?? fallback?.[key]
        return typeof value === 'string' && value.length > 0 ? value : defaultValue
    }
    const booleanValue = (key: 'smea' | 'smeaDyn' | 'variety' | 'qualityToggle', defaultValue: boolean) => {
        const value = options?.[key] ?? fallback?.[key]
        return typeof value === 'boolean' ? value : defaultValue
    }
    const resolution = options?.selectedResolution ?? fallback?.selectedResolution
    const selectedResolution = resolution
        && Number.isFinite(resolution.width) && resolution.width > 0
        && Number.isFinite(resolution.height) && resolution.height > 0
        ? {
            label: typeof resolution.label === 'string' ? resolution.label : `${resolution.width}x${resolution.height}`,
            width: resolution.width,
            height: resolution.height,
        }
        : { label: 'Portrait', width: 832, height: 1216 }

    return {
        steps: numberValue('steps', 28),
        cfgScale: numberValue('cfgScale', 5),
        cfgRescale: numberValue('cfgRescale', 0),
        sampler: stringValue('sampler', 'k_euler_ancestral'),
        scheduler: stringValue('scheduler', 'karras'),
        smea: booleanValue('smea', true),
        smeaDyn: booleanValue('smeaDyn', true),
        variety: booleanValue('variety', false),
        modelMode: normalizeModelMode(model, options?.modelMode ?? fallback?.modelMode ?? 'anime'),
        qualityToggle: booleanValue('qualityToggle', true),
        qualityTagPreset: normalizeQualityTagPreset(
            model,
            options?.qualityTagPreset ?? fallback?.qualityTagPreset ?? 'standard',
        ),
        ucPreset: normalizeUcPreset(model, options?.ucPreset ?? fallback?.ucPreset ?? 0),
        transparentBackground: getModelCapabilities(model).supportsTransparentBackground
            && (options?.transparentBackground ?? fallback?.transparentBackground) === true,
        selectedResolution,
    }
}

export const initializeModelOptionMemory = (
    currentModel: string,
    currentOptions: Partial<ModelSpecificOptions>,
    memory?: ModelOptionMemory,
): ModelOptionMemory => {
    const current = normalizeModelSpecificOptions(currentModel, currentOptions)
    const initialized: ModelOptionMemory = memory && typeof memory === 'object' && !Array.isArray(memory)
        ? { ...memory }
        : {}

    for (const model of AVAILABLE_MODELS) {
        if (model.id !== currentModel) {
            initialized[model.id] = normalizeModelSpecificOptions(model.id, memory?.[model.id], current)
        }
    }
    delete initialized[currentModel]
    return initialized
}

export const transitionModelSpecificOptions = (
    currentModel: string,
    nextModel: string,
    currentOptions: Partial<ModelSpecificOptions>,
    memory?: ModelOptionMemory,
) => {
    const nextMemory: ModelOptionMemory = memory && typeof memory === 'object' && !Array.isArray(memory)
        ? { ...memory }
        : {}
    if (currentModel !== nextModel) {
        nextMemory[currentModel] = normalizeModelSpecificOptions(currentModel, currentOptions)
    }

    const options = normalizeModelSpecificOptions(
        nextModel,
        currentModel === nextModel ? currentOptions : nextMemory[nextModel],
        currentOptions,
    )
    delete nextMemory[nextModel]

    return { options, memory: nextMemory }
}
