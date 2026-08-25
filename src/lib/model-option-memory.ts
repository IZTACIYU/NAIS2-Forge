import {
    getModelCapabilities,
    normalizeModelMode,
    normalizeQualityTagPreset,
    normalizeUcPreset,
    type ModelMode,
    type QualityTagPresetId,
} from './model-capabilities.ts'

export interface ModelSpecificOptions {
    smea: boolean
    smeaDyn: boolean
    variety: boolean
    modelMode: ModelMode
    qualityToggle: boolean
    qualityTagPreset: QualityTagPresetId
    ucPreset: number
    transparentBackground: boolean
}

export type ModelOptionMemory = Record<string, ModelSpecificOptions>

export const normalizeModelSpecificOptions = (
    model: string,
    options?: Partial<ModelSpecificOptions>,
): ModelSpecificOptions => ({
    smea: typeof options?.smea === 'boolean' ? options.smea : true,
    smeaDyn: typeof options?.smeaDyn === 'boolean' ? options.smeaDyn : true,
    variety: typeof options?.variety === 'boolean' ? options.variety : false,
    modelMode: normalizeModelMode(model, options?.modelMode ?? 'anime'),
    qualityToggle: typeof options?.qualityToggle === 'boolean' ? options.qualityToggle : true,
    qualityTagPreset: normalizeQualityTagPreset(model, options?.qualityTagPreset ?? 'standard'),
    ucPreset: normalizeUcPreset(model, options?.ucPreset ?? 0),
    transparentBackground: getModelCapabilities(model).supportsTransparentBackground
        && options?.transparentBackground === true,
})

export const transitionModelSpecificOptions = (
    currentModel: string,
    nextModel: string,
    currentOptions: Partial<ModelSpecificOptions>,
    memory?: ModelOptionMemory,
) => {
    const nextMemory: ModelOptionMemory = memory && !Array.isArray(memory) ? { ...memory } : {}
    if (currentModel !== nextModel) {
        nextMemory[currentModel] = normalizeModelSpecificOptions(currentModel, currentOptions)
    }

    const options = normalizeModelSpecificOptions(
        nextModel,
        currentModel === nextModel ? currentOptions : nextMemory[nextModel],
    )
    delete nextMemory[nextModel]

    return { options, memory: nextMemory }
}
