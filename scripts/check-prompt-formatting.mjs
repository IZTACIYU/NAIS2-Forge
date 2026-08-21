import assert from 'node:assert/strict'
import {
    appendQuotedTextPrompt,
    appendTransparentBackgroundPrompt,
    normalizePromptCommas,
    removeExactEmptyPromptSeparators,
    stripTransparentBackgroundPrompt,
    stripQuotedTextPrompt,
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
assert.equal(stripTransparentBackgroundPrompt('A, transparent background', true), 'A')
assert.equal(stripTransparentBackgroundPrompt('A, transparent background', false), 'A, transparent background')

const quotedPrompt = `artist:'kankan33333', id "angel0903", reply "angel0903"`
const quotedPromptWithText = `${quotedPrompt}, teXt: kankan33333\n\nangel0903\n\nangel0903`
assert.equal(appendQuotedTextPrompt(quotedPrompt, true), quotedPromptWithText)
assert.equal(appendQuotedTextPrompt(quotedPrompt, false), quotedPrompt)
assert.equal(stripQuotedTextPrompt(quotedPromptWithText, true), quotedPrompt)
assert.equal(stripQuotedTextPrompt(`${quotedPrompt}, teXt: different`, true), `${quotedPrompt}, teXt: different`)
