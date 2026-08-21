import assert from 'node:assert/strict'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'

const full = getModelCapabilities('nai-diffusion-5-full')
const curated = getModelCapabilities('nai-diffusion-5-curated')

assert.equal(full.maxPromptTokens, 1471)
assert.equal(full.maxCharacterPrompts, 32)
assert.equal(full.supportsVariety, false)
assert.equal(full.supportsTransparentBackground, true)
assert.equal(full.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(full.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
assert.deepEqual(full.qualityTagPresets.map(preset => preset.tagHint), [1, 3, 0])
assert.deepEqual(full.ucPresets.map(preset => preset.tagHint), [2, 3, 5, 4, 0])
assert.equal(curated.maxPromptTokens, 703)
assert.equal(curated.maxCharacterPrompts, 32)
assert.equal(curated.supportsVariety, false)
assert.equal(curated.supportsTransparentBackground, true)
assert.equal(curated.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(curated.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
assert.deepEqual(curated.ucPresets.map(preset => preset.value), [0, 1, 2, 3, 4])
assert.deepEqual(curated.qualityTagPresets.map(preset => preset.tagHint), [1, 3, 0])
assert.deepEqual(curated.ucPresets.map(preset => preset.tagHint), [2, 3, 5, 4, 0])
assert.equal(getModelCapabilities('nai-diffusion-4-5-full').supportsTransparentBackground, false)
