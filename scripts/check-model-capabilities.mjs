import assert from 'node:assert/strict'
import { getModelCapabilities } from '../src/lib/model-capabilities.ts'

const full = getModelCapabilities('nai-diffusion-5-full')

assert.equal(full.maxPromptTokens, 1471)
assert.equal(full.maxCharacterPrompts, 32)
assert.equal(full.supportsVariety, false)
assert.equal(full.modes.find(mode => mode.value === 'furry')?.promptPrefix, 'fur dataset')
assert.deepEqual(full.qualityTagPresets.map(preset => preset.value), ['standard', 'light', 'none'])
