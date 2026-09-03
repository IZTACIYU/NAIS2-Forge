import assert from 'node:assert/strict'
import { applySceneReviewDecisions, pickSceneRepresentativeImage } from '../src/lib/scene-image-selection.ts'

const image = (id, timestamp, isFavorite = false) => ({ id, url: id, timestamp, isFavorite })

assert.equal(pickSceneRepresentativeImage([]), null)
assert.equal(pickSceneRepresentativeImage([image('old', 1), image('new', 3), image('middle', 2)])?.id, 'new')
assert.equal(pickSceneRepresentativeImage([
    image('newest', 4),
    image('favorite-old', 2, true),
    image('favorite-new', 3, true),
])?.id, 'favorite-new')

const scenes = [
    { id: 'scene-a', images: [image('a-old', 1), image('a-pass', 2)] },
    { id: 'scene-b', images: [image('b-fail', 1)] },
    { id: 'scene-c', images: [image('c-pending', 1)] },
]
assert.equal(applySceneReviewDecisions(scenes, null), scenes)
assert.deepEqual(applySceneReviewDecisions(scenes, {
    'scene-a': { status: 'passed', image: image('a-pass', 2) },
    'scene-b': { status: 'failed', image: image('b-fail', 1) },
}), [{ id: 'scene-a', images: [image('a-pass', 2)] }])
assert.deepEqual(applySceneReviewDecisions(scenes, {}), [])

console.log('Scene representative image selection checks passed.')
