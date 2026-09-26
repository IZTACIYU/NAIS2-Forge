import { AVAILABLE_MODELS, getModelCapabilities, type ModelMode, type QualityTagPresetId } from './model-capabilities.ts'
import { calculateGenerationAnlasCost, type ImageGenerationEntitlement } from './anlas-calculator.ts'

export const REMOTE_SAMPLERS = ['k_euler', 'k_euler_ancestral', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m', 'k_dpmpp_2m_sde', 'k_dpmpp_sde', 'ddim']
export const REMOTE_SCHEDULERS = ['native', 'karras', 'exponential', 'polyexponential']
export const REMOTE_MAX_BATCH = 100
export interface RemoteGenerationSettings {
    basePrompt: string
    additionalPrompt: string
    detailPrompt: string
    negativePrompt: string
    inpaintingPrompt: string
    model: string
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
    seed: number
    seedLocked: boolean
    selectedResolution: { label: string; width: number; height: number }
    strength: number
    noise: number
}
export interface RemoteCostContext {
    entitlement: ImageGenerationEntitlement | null
    characterReferenceCount: number
    uncachedVibeCount: number
    sourceDimensions: { width: number; height: number } | null
}
export const remoteModelOptions = () => AVAILABLE_MODELS.map(model => ({
    id: model.id, name: model.name, modes: model.modes.map(({ value, label }) => ({ value, label })),
    qualityTagPresets: model.qualityTagPresets.map(({ value, label }) => ({ value, label })),
    ucPresets: model.ucPresets.map(({ value, label }) => ({ value, label })),
    supportsSmea: model.supportsSmea, supportsVariety: model.supportsVariety,
    supportsTransparentBackground: model.supportsTransparentBackground,
}))
export interface RemoteSnapshot {
    settings: RemoteGenerationSettings
    costContext: RemoteCostContext
    models: ReturnType<typeof remoteModelOptions>
    samplers: string[]
    schedulers: string[]
    resolutions: { label: string; width: number; height: number }[]
    batchCount: number
    maxBatch: number
    i2iMode: 'i2i' | 'inpaint' | null
}
const textFields = ['basePrompt', 'additionalPrompt', 'detailPrompt', 'negativePrompt', 'inpaintingPrompt'] as const
const booleans = ['smea', 'smeaDyn', 'variety', 'qualityToggle', 'transparentBackground', 'seedLocked'] as const
const ranges = { steps: [1, 50], cfgScale: [1, 10], cfgRescale: [0, 1], seed: [0, 4294967295], strength: [0, 1], noise: [0, 1] } as const
const keys = [...textFields, ...booleans, ...Object.keys(ranges), 'model', 'sampler', 'scheduler', 'modelMode', 'qualityTagPreset', 'ucPreset', 'selectedResolution']

export function pickRemoteSettings(state: RemoteGenerationSettings): RemoteGenerationSettings {
    return Object.fromEntries(keys.map(key => [key, structuredClone(state[key as keyof RemoteGenerationSettings])])) as unknown as RemoteGenerationSettings
}

// Only this allowlist crosses the remote command boundary: never paths, tokens, or actions.
export function validateRemoteSettings(value: unknown): RemoteGenerationSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings')
    const input = value as Record<string, unknown>
    if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Unknown setting')
    for (const key of textFields) if (typeof input[key] !== 'string' || (input[key] as string).length > 100_000) throw new Error('Invalid prompt')
    for (const key of booleans) if (typeof input[key] !== 'boolean') throw new Error('Invalid boolean')
    for (const [key, [min, max]] of Object.entries(ranges)) {
        const number = input[key]
        if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max ||
            (['steps', 'seed'].includes(key) && !Number.isInteger(number))) throw new Error('Invalid number')
    }
    if (!AVAILABLE_MODELS.some(model => model.id === input.model) || !REMOTE_SAMPLERS.includes(input.sampler as string) ||
        !REMOTE_SCHEDULERS.includes(input.scheduler as string)) throw new Error('Invalid model or sampler')
    const capabilities = getModelCapabilities(input.model as string)
    if (!['anime', 'furry'].includes(input.modelMode as string) ||
        !capabilities.qualityTagPresets.some(preset => preset.value === input.qualityTagPreset) ||
        !capabilities.ucPresets.some(preset => preset.value === input.ucPreset)) throw new Error('Invalid preset')
    const resolution = input.selectedResolution as Record<string, unknown> | null
    if (!resolution || typeof resolution !== 'object' || Object.keys(resolution).some(key => !['label', 'width', 'height'].includes(key)) ||
        typeof resolution.label !== 'string' || resolution.label.length > 100 ||
        ![resolution.width, resolution.height].every(number => typeof number === 'number' && Number.isInteger(number) && number >= 64 && number <= 4096 && number % 64 === 0) ||
        (resolution.width as number) * (resolution.height as number) > 4096 * 4096) throw new Error('Invalid resolution')
    return pickRemoteSettings(input as unknown as RemoteGenerationSettings)
}

export function validateRemoteBatch(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > REMOTE_MAX_BATCH) throw new Error('Invalid batch')
    return value
}

export function remoteGenerationCost(settings: RemoteGenerationSettings, batchCount: number, context: RemoteCostContext): number | null {
    return calculateGenerationAnlasCost({ ...context, ...(context.sourceDimensions ?? settings.selectedResolution), steps: settings.steps, imageCount: batchCount })
}
