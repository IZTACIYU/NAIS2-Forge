import assert from 'node:assert/strict'

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
const { appendBoundedHistory, getHistoryShortcut, shouldIgnoreGlobalNavigation } = await import('../src/lib/utils.ts')
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
