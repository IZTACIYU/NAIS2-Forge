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
const { shouldIgnoreGlobalNavigation } = await import('../src/lib/utils.ts')
const event = (target, defaultPrevented = false) => ({ target, defaultPrevented })

for (const tag of ['input', 'textarea', 'select']) {
    assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement(tag))), true)
}
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('div', true))), true)
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('button'), true)), true)
assert.equal(shouldIgnoreGlobalNavigation(event(new MockElement('button'))), false)
