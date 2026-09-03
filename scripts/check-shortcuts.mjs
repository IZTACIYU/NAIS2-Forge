import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

class MockElement {
    constructor(tag, isContentEditable = false) {
        this.tag = tag
        this.isContentEditable = isContentEditable
    }

    matches(selector) {
        return selector.split(', ').includes(this.tag)
    }
}

globalThis.HTMLElement = MockElement
const {
    appendBoundedHistory,
    describeTextEdit,
    getHistoryShortcut,
    groupTextEdit,
    shouldIgnoreGlobalNavigation,
} = await import('../src/lib/utils.ts')
const event = (target, defaultPrevented = false) => ({ target, defaultPrevented })

for (const tag of ['input', 'textarea', 'select']) {
    assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement(tag))), true)
}
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('div', true))), true)
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('button'), true)), true)
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('button'))), false)

const shortcut = (key, options = {}) => ({
    target: new MockElement(options.tag ?? 'button'),
    defaultPrevented: options.defaultPrevented ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    key,
})
assert.equal(getHistoryShortcut(shortcut('z', { ctrlKey: true })), 'undo')
assert.equal(getHistoryShortcut(shortcut('Z', { ctrlKey: true, shiftKey: true })), 'redo')
assert.equal(getHistoryShortcut(shortcut('y', { ctrlKey: true })), 'redo')
assert.equal(getHistoryShortcut(shortcut('z', { metaKey: true })), 'undo')
assert.equal(getHistoryShortcut(shortcut('z', { ctrlKey: true, tag: 'input' })), null)
assert.equal(getHistoryShortcut(shortcut('z', { ctrlKey: true, defaultPrevented: true })), null)

assert.deepEqual(appendBoundedHistory(['a', 'b', 'redo'], 2, 'c', 3), ['a', 'b', 'c'])
assert.deepEqual(appendBoundedHistory(['a', 'b', 'c'], 3, 'd', 3), ['b', 'c', 'd'])

assert.deepEqual(describeTextEdit('abc', 'abXc'), { start: 2, removed: '', inserted: 'X' })
assert.deepEqual(describeTextEdit('abXc', 'abc'), { start: 2, removed: 'X', inserted: '' })
assert.deepEqual(describeTextEdit('abc', 'aXc'), { start: 1, removed: 'b', inserted: 'X' })

const firstInsert = groupTextEdit(null, describeTextEdit('a', 'ab'), 2, 1000)
assert.equal(firstInsert.merge, false)
assert.equal(groupTextEdit(firstInsert.group, describeTextEdit('ab', 'abc'), 3, 1699).merge, true)
assert.equal(groupTextEdit(firstInsert.group, describeTextEdit('ab', 'abc'), 3, 1701).merge, false)
assert.equal(groupTextEdit(firstInsert.group, describeTextEdit('ab', 'ab,'), 3, 1100).group, null)
assert.equal(groupTextEdit(firstInsert.group, describeTextEdit('ab', 'aXb'), 2, 1100).merge, false)

const firstBackspace = groupTextEdit(null, describeTextEdit('abc', 'ab'), 2, 1000)
assert.equal(groupTextEdit(firstBackspace.group, describeTextEdit('ab', 'a'), 1, 1100).merge, true)
const firstDelete = groupTextEdit(null, describeTextEdit('abc', 'ac'), 1, 1000)
assert.equal(groupTextEdit(firstDelete.group, describeTextEdit('ac', 'a'), 1, 1100).merge, true)
assert.equal(groupTextEdit(null, describeTextEdit('a', 'paste'), 5, 1000).group, null)

const [shortcutStoreSource, shortcutHookSource, promptPanelSource, layoutSource, reviewDialogSource] = await Promise.all([
    readFile(new URL('../src/stores/shortcut-store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/useShortcuts.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/layout/PromptPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/layout/ThreeColumnLayout.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/scene/SceneReviewDialog.tsx', import.meta.url), 'utf8'),
])
assert.match(shortcutStoreSource, /'action:copyDanbooruTags': \{ key: 'e', ctrl: true/)
assert.match(shortcutHookSource, /COPY_DANBOORU_TAGS/)
assert.match(shortcutHookSource, /location\.pathname !== '\/web' \|\| shouldIgnoreGlobalNavigation\(e\)/)
assert.match(shortcutHookSource, /isSceneReviewDialogOpen\(\).*GENERATE_SCENE_REVIEW/s)
assert.match(promptPanelSource, /isSceneReviewDialogOpen\(\)/)
assert.match(layoutSource, /isSceneReviewDialogOpen\(\)/)
assert.match(reviewDialogSource, /data-scene-review-dialog="true"/)
assert.match(reviewDialogSource, /<SourceImagePanel \/>/)
assert.match(reviewDialogSource, /GENERATE_SCENE_REVIEW/)
