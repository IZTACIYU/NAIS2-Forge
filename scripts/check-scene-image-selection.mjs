import assert from 'node:assert/strict'
import { pickSceneRepresentativeImage } from '../src/lib/scene-image-selection.ts'

const image = (id, timestamp, isFavorite = false) => ({ id, url: id, timestamp, isFavorite })

assert.equal(pickSceneRepresentativeImage([]), null)
assert.equal(pickSceneRepresentativeImage([image('old', 1), image('new', 3), image('middle', 2)])?.id, 'new')
assert.equal(pickSceneRepresentativeImage([
    image('newest', 4),
    image('favorite-old', 2, true),
    image('favorite-new', 3, true),
])?.id, 'favorite-new')

console.log('Scene representative image selection checks passed.')
