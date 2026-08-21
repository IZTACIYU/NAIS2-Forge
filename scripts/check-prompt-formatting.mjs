import assert from 'node:assert/strict'
import {
    appendTransparentBackgroundPrompt,
    normalizePromptCommas,
    removeExactEmptyPromptSeparators,
} from '../src/lib/prompt-formatting.ts'

assert.equal(normalizePromptCommas('A,B'), 'A, B')
assert.equal(normalizePromptCommas('A,     B'), 'A,     B')
assert.equal(normalizePromptCommas('A , B'), 'A, B')
assert.equal(normalizePromptCommas('A  , B'), 'A , B')
assert.equal(normalizePromptCommas('A,\nB'), 'A, \nB')
assert.equal(normalizePromptCommas('A ,'), 'A,')
assert.equal(normalizePromptCommas('A  ,'), 'A ,')
assert.equal(normalizePromptCommas('A,   '), 'A,   ')
assert.equal(normalizePromptCommas('A  ,     '), 'A ,     ')
assert.equal(removeExactEmptyPromptSeparators(normalizePromptCommas('A,,B')), 'A, B')
assert.equal(appendTransparentBackgroundPrompt('A', true), 'A, transparent background')
assert.equal(appendTransparentBackgroundPrompt('A', false), 'A')
