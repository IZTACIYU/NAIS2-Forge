import assert from 'node:assert/strict'
import {
    fitCharacterPositionRect,
    getContainedImageRect,
    resolveCharacterPosition,
} from '../src/lib/character-position-grid.ts'

assert.equal(resolveCharacterPosition(0.31, 'grid'), 0.3)
assert.equal(resolveCharacterPosition(0.31, 'free'), 0.31)
assert.equal(resolveCharacterPosition(1.2, 'free'), 1)
assert.deepEqual(
    fitCharacterPositionRect({ left: 0, top: 0, width: 1000, height: 500 }, 1),
    { left: 274, top: 24, width: 452, height: 452 },
)
assert.deepEqual(
    getContainedImageRect({ left: 0, top: 0, width: 1000, height: 500 }, 500, 1000),
    { left: 375, top: 0, width: 250, height: 500 },
)
