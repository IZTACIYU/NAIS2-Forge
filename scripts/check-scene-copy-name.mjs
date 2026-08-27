import assert from 'node:assert/strict'
import { getUniqueDuplicateName } from '../src/lib/scene-copy-name.ts'

assert.equal(getUniqueDuplicateName('A', ['A']), 'A (복사본)')
assert.equal(getUniqueDuplicateName('A (복사본)', ['A', 'A (복사본)']), 'A (복사본 2)')
assert.equal(getUniqueDuplicateName('A (복사본 2)', ['A', 'A (복사본)', 'A (복사본 2)']), 'A (복사본 3)')
assert.equal(getUniqueDuplicateName('A/B', ['A_B (복사본)']), 'A/B (복사본 2)')
