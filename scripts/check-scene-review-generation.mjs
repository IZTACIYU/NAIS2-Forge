import assert from 'node:assert/strict'
import { addUniqueReviewHistoryImage, isTrackedReviewGeneration } from '../src/lib/scene-review-generation.ts'

const tracked = new Set(['scene-a'])

assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), true)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-b', sceneId: 'scene-a' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-b' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), false)

const initial = { sceneId: 'scene-a', url: 'initial.png' }
const generated = { sceneId: 'scene-a', url: 'generated.png' }
const history = addUniqueReviewHistoryImage(addUniqueReviewHistoryImage([], initial, 'end'), generated, 'start')
assert.deepEqual(history, [generated, initial])
assert.equal(addUniqueReviewHistoryImage(history, initial, 'end'), history)

console.log('Scene review generation checks passed.')
