import assert from 'node:assert/strict'
import { isTrackedReviewGeneration } from '../src/lib/scene-review-generation.ts'

const tracked = new Set(['scene-a'])

assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), true)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-b', sceneId: 'scene-a' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-b' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), false)

console.log('Scene review generation checks passed.')
