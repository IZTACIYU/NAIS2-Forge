import assert from 'node:assert/strict'
import { buildSceneQueueOrder, findNextQueuedSceneIndex } from '../src/lib/scene-queue-order.ts'

const scenes = [
    { id: 'A', queueCount: 3 },
    { id: 'B', queueCount: 3 },
    { id: 'C', queueCount: 3 },
]

assert.deepEqual(buildSceneQueueOrder(scenes, false), ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C'])
assert.deepEqual(buildSceneQueueOrder(scenes, true), ['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B', 'C'])
assert.deepEqual(
    buildSceneQueueOrder([{ id: 'A', queueCount: 2 }, { id: 'B', queueCount: 1 }, { id: 'C', queueCount: 3 }], true),
    ['A', 'B', 'C', 'A', 'C', 'C'],
)
assert.equal(findNextQueuedSceneIndex(scenes, null, true), 0)
assert.equal(findNextQueuedSceneIndex([{ ...scenes[0], queueCount: 2 }, scenes[1], scenes[2]], 'A', true), 1)
assert.equal(findNextQueuedSceneIndex([{ ...scenes[0], queueCount: 2 }, { ...scenes[1], queueCount: 0 }, scenes[2]], 'A', true), 2)
assert.equal(findNextQueuedSceneIndex([{ ...scenes[0], queueCount: 2 }, { ...scenes[1], queueCount: 0 }, { ...scenes[2], queueCount: 0 }], 'A', true), 0)
