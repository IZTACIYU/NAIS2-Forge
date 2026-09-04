import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getUniqueSceneOutputFileName } from '../src/lib/scene-export-name.ts'
import { addUniqueReviewHistoryImage, findNextReviewItem, isTrackedReviewGeneration } from '../src/lib/scene-review-generation.ts'
import { findSceneImageOwner, getSceneFolderFromImages } from '../src/lib/scene-path.ts'

const tracked = new Set(['scene-a'])

assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), true)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-b', sceneId: 'scene-a' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ path: 'a.png', presetId: 'preset-a', sceneId: 'scene-b' }, 'preset-a', tracked), false)
assert.equal(isTrackedReviewGeneration({ presetId: 'preset-a', sceneId: 'scene-a' }, 'preset-a', tracked), false)

const initial = { sceneId: 'scene-a', url: 'initial.png' }
const generated = { sceneId: 'scene-a', url: 'generated.png' }
const history = addUniqueReviewHistoryImage(addUniqueReviewHistoryImage([], initial, 'end'), generated, 'start')
assert.deepEqual(history, [generated, initial])
assert.equal(addUniqueReviewHistoryImage(history, initial, 'end'), history)

const reviewItems = [{ sceneId: 'a' }, { sceneId: 'b' }, { sceneId: 'c' }]
assert.deepEqual(findNextReviewItem(reviewItems, reviewItems, 'a'), { sceneId: 'b' })
assert.deepEqual(findNextReviewItem(reviewItems, reviewItems.filter(item => item.sceneId !== 'b'), 'b'), { sceneId: 'c' })
assert.equal(findNextReviewItem(reviewItems, reviewItems, 'c'), null)
assert.equal(findNextReviewItem(reviewItems, [], 'a'), null)

const usedFileNames = new Set()
assert.equal(getUniqueSceneOutputFileName({ sceneName: 'A/B', enabled: false, part: 'prefix', extension: 'png', usedFileNames, fallback: 'Scene' }), 'A_B.png')
assert.equal(getUniqueSceneOutputFileName({ sceneName: 'A:B', enabled: false, part: 'prefix', extension: 'png', usedFileNames, fallback: 'Scene' }), 'A_B_2.png')

const scenePresets = [{ id: 'preset-a', scenes: [{ id: 'scene-a', images: [{ url: 'C:\\Scenes\\A\\source.png' }] }] }]
assert.deepEqual(findSceneImageOwner(scenePresets, 'C:\\Scenes\\A\\source.png'), { presetId: 'preset-a', sceneId: 'scene-a' })
assert.equal(findSceneImageOwner(scenePresets, 'C:\\Scenes\\B\\source.png'), undefined)
assert.equal(getSceneFolderFromImages([{ url: 'C:\\Scenes\\A\\source.png' }]), 'C:\\Scenes\\A')

const reviewDialogSource = await readFile(new URL('../src/components/scene/SceneReviewDialog.tsx', import.meta.url), 'utf8')
const sceneContextMenuSource = await readFile(new URL('../src/components/scene/SceneImageContextMenu.tsx', import.meta.url), 'utf8')
const drawOverDialogSource = await readFile(new URL('../src/components/tools/DrawOverDialog.tsx', import.meta.url), 'utf8')
const drawOverHostSource = await readFile(new URL('../src/components/tools/DrawOverHost.tsx', import.meta.url), 'utf8')
const toolsStoreSource = await readFile(new URL('../src/stores/tools-store.ts', import.meta.url), 'utf8')
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const mainModeSource = await readFile(new URL('../src/pages/MainMode.tsx', import.meta.url), 'utf8')
const toolsModeSource = await readFile(new URL('../src/pages/ToolsMode.tsx', import.meta.url), 'utf8')
const historyPanelSource = await readFile(new URL('../src/components/layout/HistoryPanel.tsx', import.meta.url), 'utf8')
const libraryMenuSource = await readFile(new URL('../src/components/library/LibraryContextMenu.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(reviewDialogSource, /\{ id: 'individual'/)
assert.match(reviewDialogSource, /tab === 'pending'.*status !== 'passed'/s)
assert.match(reviewDialogSource, /decision\?\.status === 'passed'/)
assert.match(reviewDialogSource, /reviewImages: gridImages/)
assert.match(reviewDialogSource, /subscribeScenePromptDraftFlush\(flushPrompt\)/)
assert.match(reviewDialogSource, /\{ id: 'final'/)
assert.match(reviewDialogSource, /scenes=\{usableOutputScenes\}/)
assert.match(reviewDialogSource, /excludedImageKeys\.has\(reviewImageKey\(scene\.id, image\.id\)\)/)
assert.match(reviewDialogSource, /onToggleExcluded=\{toggleExcludedImage\}/)
assert.match(reviewDialogSource, /status === 'passed' && 'border-sky-400'/)
assert.match(reviewDialogSource, /status === 'failed' && 'border-red-500'/)
assert.match(reviewDialogSource, /missing \? 'border-2 border-red-500\/90/)
assert.match(reviewDialogSource, /onError=\{\(\) => onImageError\(image\.url\)\}/)
assert.match(reviewDialogSource, /reviewImageNameExamples/)
assert.doesNotMatch(reviewDialogSource, /<DrawOverDialog/)
assert.match(sceneContextMenuSource, /openDrawOver\(base64, isFile \? image\.url : undefined\)/)
assert.match(drawOverDialogSource, /outputDirectory \|\| savePath \|\| 'NAIS_Output'/)
assert.match(drawOverDialogSource, /fileName = `\$\{fileNamePrefix\}_\$\{Date\.now\(\)\}\.png`/)
assert.match(drawOverHostSource, /getSceneFolderFromImages\(\[\{ url: request\.sourcePath \}\]\)/)
assert.match(drawOverHostSource, /findSceneImageOwner\(useSceneStore\.getState\(\)\.presets, request\?\.sourcePath\)/)
assert.match(drawOverHostSource, /addImageToScene\(owner\.presetId, owner\.sceneId, path, outputDirectory\)/)
assert.match(appSource, /<DrawOverHost \/>/)
assert.doesNotMatch(toolsStoreSource, /requestedTool/)
for (const source of [mainModeSource, toolsModeSource, historyPanelSource, libraryMenuSource, sceneContextMenuSource]) {
    assert.match(source, /openDrawOver\(/)
    assert.doesNotMatch(source, /setRequestedTool/)
}

console.log('Scene review generation checks passed.')
