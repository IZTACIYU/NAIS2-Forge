import assert from 'node:assert/strict'
import {
    appendQuotedTextPrompt,
    appendTransparentBackgroundPrompt,
    formatWeightedPrompt,
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
assert.equal(formatWeightedPrompt('11a', 1.1), '1.1:: 11a::')
assert.equal(formatWeightedPrompt('a11', 1.1), '1.1::a11 ::')
assert.equal(formatWeightedPrompt('11a11', 1.1), '1.1:: 11a11 ::')
assert.equal(formatWeightedPrompt('a11a', 1.1), '1.1::a11a::')
assert.equal(appendTransparentBackgroundPrompt('A', true), 'A, transparent background')
assert.equal(appendTransparentBackgroundPrompt('A', false), 'A')
assert.equal(stripTransparentBackgroundPrompt('A, transparent background', true), 'A')
assert.equal(stripTransparentBackgroundPrompt('A, transparent background', false), 'A, transparent background')

const quotedPrompt = `artist:'kankan33333', id "angel0903", reply "angel0903"`
const quotedPromptWithText = `${quotedPrompt}, teXt: angel0903\n\nangel0903`
const legacyQuotedPromptWithText = `${quotedPrompt}, teXt: kankan33333\n\nangel0903\n\nangel0903`
assert.equal(appendQuotedTextPrompt(quotedPrompt, true), quotedPromptWithText)
assert.equal(appendQuotedTextPrompt(quotedPrompt, false), quotedPrompt)
assert.equal(stripQuotedTextPrompt(quotedPromptWithText, true), quotedPrompt)
assert.equal(stripQuotedTextPrompt(legacyQuotedPromptWithText, true), quotedPrompt)
assert.equal(stripQuotedTextPrompt(`${quotedPrompt}, teXt: different`, true), `${quotedPrompt}, teXt: different`)

const possessivePrompt = `.3::hands on another's head::, head grab,
female all fours on floor, between legs,
2::looking at viewer::, dashed eyes,
hand on another's thigh,`
assert.equal(appendQuotedTextPrompt(possessivePrompt, true), possessivePrompt)
assert.equal(
    appendQuotedTextPrompt(`another's hand, sign "STOP", artist:'someone's name'`, true),
    `another's hand, sign "STOP", artist:'someone's name', teXt: STOP`,
)
assert.equal(appendQuotedTextPrompt(`artist:"someone", caption "HELLO"`, true), `artist:"someone", caption "HELLO", teXt: HELLO`)
