import assert from 'node:assert/strict'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'
import {
    initializeModelOptionMemory,
    transitionModelSpecificOptions,
} from '../src/lib/model-option-memory.ts'
import { mergeQualityTags, stripQualityTags, stripUcPreset } from '../src/lib/nai-presets.ts'
import {
    appendQuotedTextPrompt,
    appendTransparentBackgroundPrompt,
    stripQuotedTextPrompt,
    stripTransparentBackgroundPrompt,
} from '../src/lib/prompt-formatting.ts'

const full = getModelCapabilities('nai-diffusion-5-full')
const curated = getModelCapabilities('nai-diffusion-5-curated')

assert.equal(full.maxPromptTokens, 1471)
assert.equal(full.promptTokenizer, 'qwen3.5')
assert.equal(full.maxCharacterPrompts, 32)
assert.equal(full.supportsVariety, false)
assert.equal(full.supportsTransparentBackground, true)
assert.equal(full.supportsQuotedTextPrompt, true)
assert.equal(full.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(full.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
assert.deepEqual(full.qualityTagPresets.map(preset => preset.tagHint), [1, 3, 0])
assert.deepEqual(full.ucPresets.map(preset => preset.tagHint), [2, 3, 5, 4, 0])
assert.equal(curated.maxPromptTokens, 703)
assert.equal(curated.promptTokenizer, 'qwen3.5')
assert.equal(curated.maxCharacterPrompts, 32)
assert.equal(curated.supportsVariety, false)
assert.equal(curated.supportsTransparentBackground, true)
assert.equal(curated.supportsQuotedTextPrompt, true)
assert.equal(curated.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(curated.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
assert.deepEqual(curated.ucPresets.map(preset => preset.value), [0, 1, 2, 3, 4])
assert.deepEqual(curated.qualityTagPresets.map(preset => preset.tagHint), [1, 3, 0])
assert.deepEqual(curated.ucPresets.map(preset => preset.tagHint), [2, 3, 5, 4, 0])
assert.equal(getModelCapabilities('nai-diffusion-4-5-full').supportsTransparentBackground, false)
assert.equal(getModelCapabilities('nai-diffusion-4-5-full').promptTokenizer, 't5')
assert.equal(getModelCapabilities('nai-diffusion-4-5-full').supportsQuotedTextPrompt, false)

const v5Options = {
    steps: 35,
    cfgScale: 6.2,
    cfgRescale: 0.4,
    sampler: 'k_dpmpp_2m',
    scheduler: 'exponential',
    smea: true,
    smeaDyn: true,
    variety: false,
    modelMode: 'furry',
    qualityToggle: true,
    qualityTagPreset: 'light',
    ucPreset: 2,
    transparentBackground: true,
    selectedResolution: { label: 'Custom', width: 1024, height: 768 },
}
const legacyActive = transitionModelSpecificOptions(
    'nai-diffusion-5-full',
    'nai-diffusion-5-full',
    v5Options,
)
assert.deepEqual(legacyActive.options, v5Options)
assert.deepEqual(legacyActive.memory, {})

const initializedMemory = initializeModelOptionMemory(
    'nai-diffusion-5-full',
    v5Options,
    { futureModel: v5Options },
)
assert.equal(initializedMemory['nai-diffusion-4-5-full'].steps, v5Options.steps)
assert.equal(initializedMemory['nai-diffusion-4-5-full'].cfgScale, v5Options.cfgScale)
assert.equal(initializedMemory['nai-diffusion-4-5-full'].sampler, v5Options.sampler)
assert.deepEqual(initializedMemory['nai-diffusion-4-5-full'].selectedResolution, v5Options.selectedResolution)
assert.equal(initializedMemory.futureModel, v5Options)

const toV45 = transitionModelSpecificOptions(
    'nai-diffusion-5-full',
    'nai-diffusion-4-5-full',
    v5Options,
    initializedMemory,
)
assert.equal(toV45.options.steps, 35)
assert.equal(toV45.options.cfgScale, 6.2)
assert.equal(toV45.options.ucPreset, 2)
assert.equal(toV45.options.qualityTagPreset, 'standard')
assert.equal(toV45.options.transparentBackground, false)
assert.deepEqual(toV45.memory['nai-diffusion-5-full'], v5Options)

const v45Options = {
    ...toV45.options,
    steps: 22,
    cfgScale: 4.3,
    selectedResolution: { label: 'Landscape', width: 1216, height: 832 },
    variety: true,
    qualityToggle: false,
    ucPreset: 4,
}
const backToV5 = transitionModelSpecificOptions(
    'nai-diffusion-4-5-full',
    'nai-diffusion-5-full',
    v45Options,
    toV45.memory,
)
assert.deepEqual(backToV5.options, v5Options)
assert.equal(backToV5.memory['nai-diffusion-5-full'], undefined)
assert.deepEqual(backToV5.memory['nai-diffusion-4-5-full'], v45Options)

const backToV45 = transitionModelSpecificOptions(
    'nai-diffusion-5-full',
    'nai-diffusion-4-5-full',
    backToV5.options,
    backToV5.memory,
)
assert.deepEqual(backToV45.options, v45Options)
assert.equal(backToV45.memory['nai-diffusion-4-5-full'], undefined)

const migratedPartialMemory = initializeModelOptionMemory(
    'nai-diffusion-5-full',
    v5Options,
    { 'nai-diffusion-4-5-full': { ucPreset: 4, qualityToggle: false } },
)
assert.equal(migratedPartialMemory['nai-diffusion-4-5-full'].ucPreset, 4)
assert.equal(migratedPartialMemory['nai-diffusion-4-5-full'].qualityToggle, false)
assert.equal(migratedPartialMemory['nai-diffusion-4-5-full'].steps, v5Options.steps)
assert.deepEqual(
    migratedPartialMemory['nai-diffusion-4-5-full'].selectedResolution,
    v5Options.selectedResolution,
)

const normalizedCurated = transitionModelSpecificOptions(
    'nai-diffusion-4-5-curated',
    'nai-diffusion-4-5-curated',
    v5Options,
    { 'nai-diffusion-4-5-curated': v45Options },
)
assert.equal(normalizedCurated.options.modelMode, 'anime')
assert.equal(normalizedCurated.options.qualityTagPreset, 'standard')
assert.equal(normalizedCurated.options.ucPreset, 0)
assert.equal(normalizedCurated.options.transparentBackground, false)
assert.equal(normalizedCurated.memory['nai-diffusion-4-5-curated'], undefined)

const standardSuffix = full.qualityTagPresets.find(preset => preset.value === 'standard').suffix
const heavyPrefix = full.ucPresets.find(preset => preset.value === 0).prefix
assert.equal(stripQualityTags(`A${standardSuffix}`, 'nai-diffusion-5-full', 'standard'), 'A')
assert.equal(stripQualityTags(`A${standardSuffix}`, 'nai-diffusion-5-full', 'light'), `A${standardSuffix}`)
assert.equal(stripQualityTags(`A${standardSuffix}${standardSuffix}`, 'nai-diffusion-5-full', 'standard'), `A${standardSuffix}`)
assert.equal(stripUcPreset(`${heavyPrefix}, custom`, 'nai-diffusion-5-full', 0), 'custom')
assert.equal(stripUcPreset(heavyPrefix, 'nai-diffusion-5-full', 0), '')
assert.equal(stripUcPreset(`custom, ${heavyPrefix}`, 'nai-diffusion-5-full', 0), `custom, ${heavyPrefix}`)

const combinedPrompt = appendQuotedTextPrompt(
    mergeQualityTags(
        appendTransparentBackgroundPrompt('A "hello"', true),
        'nai-diffusion-5-full',
        true,
        'standard',
    ),
    true,
)
assert.equal(combinedPrompt, `A "hello", transparent background${standardSuffix}, teXt: hello`)
assert.equal(
    stripTransparentBackgroundPrompt(
        stripQualityTags(
            stripQuotedTextPrompt(combinedPrompt, true),
            'nai-diffusion-5-full',
            'standard',
        ),
        true,
    ),
    'A "hello"',
)
