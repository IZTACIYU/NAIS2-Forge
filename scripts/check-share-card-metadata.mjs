import assert from 'node:assert/strict'
import { readPngTextMetadata, writePngTextMetadata } from '../src/lib/png-metadata-editor.ts'
import { embedNais2Params, readNais2Params } from '../src/lib/nais2-png-meta.ts'

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
console.log('Share card metadata round-trip passed')
