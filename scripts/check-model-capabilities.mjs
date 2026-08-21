import assert from 'node:assert/strict'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'
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
assert.equal(full.maxCharacterPrompts, 32)
assert.equal(full.supportsVariety, false)
assert.equal(full.supportsTransparentBackground, true)
assert.equal(full.supportsQuotedTextPrompt, true)
assert.equal(full.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(full.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
assert.deepEqual(full.qualityTagPresets.map(preset => preset.tagHint), [1, 3, 0])
assert.deepEqual(full.ucPresets.map(preset => preset.tagHint), [2, 3, 5, 4, 0])
assert.equal(curated.maxPromptTokens, 703)
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
assert.equal(getModelCapabilities('nai-diffusion-4-5-full').supportsQuotedTextPrompt, false)

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
