import assert from 'node:assert/strict'
import { readPngTextMetadata, writePngTextMetadata } from '../src/lib/png-metadata-editor.ts'
import { embedNais2Params, readNais2Params } from '../src/lib/nais2-png-meta.ts'
import { getShareCardLayout } from '../src/components/image/share-card-layout.ts'

const blankPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7p8AAAAASUVORK5CYII='
const official = {
    Source: 'NovelAI Diffusion V5 Full',
    Description: 'fur dataset, test, very aesthetic, masterpiece, no text',
    Comment: JSON.stringify({ prompt: 'fur dataset, test, very aesthetic, masterpiece, no text', uc: 'bad quality', steps: 28, tag_hint_qt: 1 }),
}
const cardPng = writePngTextMetadata(blankPng, official)
let binary = ''
for (const byte of cardPng) binary += String.fromCharCode(byte)
const app = {
    qualityToggle: true,
    ucPreset: 4,
    promptParts: { base: 'test', additional: '', detail: '', negative: '' },
    generationSources: { characterPrompts: [], characterReferences: [], vibeReferences: [], characterPositionEnabled: false },
}
const withApp = embedNais2Params(btoa(binary), app)
const dataUrl = `data:image/png;base64,${withApp}`
const { 'nais2-params': appChunk, ...officialRoundTrip } = readPngTextMetadata(dataUrl)
assert.ok(appChunk)
assert.deepEqual(officialRoundTrip, official)
assert.deepEqual(readNais2Params(Uint8Array.from(atob(withApp), c => c.charCodeAt(0))), { version: 1, ...app })
assert.equal(JSON.parse(readPngTextMetadata(dataUrl).Comment).tag_hint_qt, 1)
const wide = getShareCardLayout(1216, 832, 2, 2)
const square = getShareCardLayout(1024, 1024, 2, 2)
const tall = getShareCardLayout(832, 1216, 2, 2)
assert.equal(wide.width, 720)
assert.ok(wide.textY > wide.image.y + wide.image.height)
assert.equal(square.width, 1700)
assert.equal(tall.width, square.width)
assert.ok(square.textX >= square.image.x + square.image.width)
assert.ok(square.negativeX >= square.textX + square.textWidth)
assert.ok(square.parametersX >= square.negativeX + square.textWidth)
assert.ok(square.parametersX + square.parametersWidth <= square.width - 32)
assert.ok(tall.height >= tall.image.y + tall.image.height + 32)
assert.ok(getShareCardLayout(832, 1216, 30, 20).height > tall.height)
console.log('Share card metadata and layout checks passed')
