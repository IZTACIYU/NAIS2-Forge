import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

const reviewDialogSource = await readFile(new URL('../src/components/scene/SceneReviewDialog.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(reviewDialogSource, /\{ id: 'individual'/)
assert.match(reviewDialogSource, /const gridImages = activeTab === 'all'/)
assert.match(reviewDialogSource, /status === 'passed' && 'border-sky-400'/)
assert.match(reviewDialogSource, /status === 'failed' && 'border-red-500'/)

console.log('Scene review generation checks passed.')
