import assert from 'node:assert/strict'
import { calculateGenerationAnlasCost as cost } from '../src/lib/anlas-calculator.ts'

const input = {
    width: 832, height: 1216, steps: 28, imageCount: 1,
    characterReferenceCount: 0, uncachedVibeCount: 0,
    entitlement: { unlimitedImageGeneration: true },
}

// Source images (I2I/inpaint) must not independently disqualify free generation.
// Keep the former input here to catch a reintroduced source-image exclusion.
for (const usesSourceImage of [false, true]) {
    const request = { ...input, usesSourceImage }
    assert.equal(cost(request), 0)
    assert.equal(cost({ ...request, imageCount: 4 }), 0)
    assert.equal(cost({ ...request, width: 1024, height: 1024 }), 0)
    assert.ok(cost({ ...request, steps: 29 }) > 0)
    assert.ok(cost({ ...request, width: 1536, height: 1536 }) > 0)
    assert.equal(cost({ ...request, entitlement: null }), null)
    assert.equal(cost({ ...request, entitlement: { unlimitedImageGeneration: false } }), 20)
    assert.equal(cost({ ...request, characterReferenceCount: 1, uncachedVibeCount: 1, imageCount: 3 }), 21)
}
console.log('Anlas free-source, paid, entitlement, batch and reference checks passed.')
