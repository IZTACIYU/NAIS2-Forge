import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { addUniqueReviewHistoryImage, findNextReviewItem, isTrackedReviewGeneration } from '../src/lib/scene-review-generation.ts'

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

const reviewItems = [{ sceneId: 'a' }, { sceneId: 'b' }, { sceneId: 'c' }]
assert.deepEqual(findNextReviewItem(reviewItems, reviewItems, 'a'), { sceneId: 'b' })
assert.deepEqual(findNextReviewItem(reviewItems, reviewItems.filter(item => item.sceneId !== 'b'), 'b'), { sceneId: 'c' })
assert.equal(findNextReviewItem(reviewItems, reviewItems, 'c'), null)
assert.equal(findNextReviewItem(reviewItems, [], 'a'), null)

const reviewDialogSource = await readFile(new URL('../src/components/scene/SceneReviewDialog.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(reviewDialogSource, /\{ id: 'individual'/)
assert.match(reviewDialogSource, /tab === 'pending'.*status !== 'passed'/s)
assert.match(reviewDialogSource, /decision\?\.status === 'passed'/)
assert.match(reviewDialogSource, /reviewImages: gridImages/)
assert.match(reviewDialogSource, /subscribeScenePromptDraftFlush\(flushPrompt\)/)
assert.match(reviewDialogSource, /\{ id: 'final'/)
assert.match(reviewDialogSource, /scenes=\{outputScenes\}/)
assert.match(reviewDialogSource, /status === 'passed' && 'border-sky-400'/)
assert.match(reviewDialogSource, /status === 'failed' && 'border-red-500'/)

console.log('Scene review generation checks passed.')
