import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

const source = readFileSync('src/components/ui/AutocompleteTextarea.tsx', 'utf8')
const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function initializer(name) {
    let result
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast)
        ts.forEachChild(node, visit)
    }
    visit(ast)
    assert.ok(result, name)
    return result
}
const helpers = source.slice(source.indexOf('    const getCurrentWord ='), source.indexOf('    const showSuggestionsAtCaret ='))
const implementation = ts.transpileModule(`${helpers}
    return { getCurrentWord, getDirectiveWord,
        checkAutocomplete: ${initializer('checkAutocomplete')},
        insertSuggestion: ${initializer('insertSuggestion')},
    }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const run = new Function('env', `const {
    useCallback, DIRECTIVE_SUGGESTIONS, maxSuggestions, fragmentFiles, searchTags,
    autocompleteRequestRef, textareaRef, internalValue, suggestionMode, commitProgrammaticText,
    setSuggestions, setSuggestionMode, setSelectedIndex, setIsVisible, setCoords,
    getCaretCoordinates, showSuggestionsAtCaret, requestAnimationFrame, scrollToCaret,
} = env; ${implementation}`)

for (const [input, query, expected, cursor] of [
    ['#del-bl', 'bl', '#del-blue eyes, '],
    ['  #DEL-bl', 'bl', '  #DEL-blue eyes, '],
    ['sky\r\n#del-bl', 'bl', 'sky\r\n#del-blue eyes, '],
    ['#del-red hair, bl', 'bl', '#del-red hair, blue eyes, '],
    ['#del-bl eyes, red hair', 'bl', '#del-blue eyes, red hair', 7],
    ['#if+bl', 'bl', '#if+blue eyes'],
    ['#if-bl', 'bl', '#if-blue eyes'],
    ['#if+girl&bl', 'bl', '#if+girl&blue eyes'],
    ['#if+girl / bl', 'bl', '#if+girl / blue eyes'],
    ['#if+bl eyes&girl: smile', 'bl', '#if+blue eyes&girl: smile', 6],
    ['#if+bl: smile', 'bl', '#if+blue eyes: smile', 6],
    ['#if+girl: bl', 'bl', '#if+girl:blue eyes, '],
    ['#rChara<100, bl', 'bl', '#rChara<100, blue eyes, '],
    ['sky, bl', 'bl', 'sky, blue eyes, '],
    ['2::bl', 'bl', '2::blue eyes, '],
]) {
    const pos = cursor ?? input.length
    const queries = []
    let committed, visible, suggestions
    const noop = () => {}
    const env = {
        useCallback: fn => fn, DIRECTIVE_SUGGESTIONS: [], maxSuggestions: 15, fragmentFiles: [],
        searchTags: async word => { queries.push(word); return [{ label: 'blue eyes', value: 'blue eyes', type: 'general' }] },
        autocompleteRequestRef: { current: 0 }, textareaRef: { current: { selectionEnd: pos } },
        internalValue: input, suggestionMode: 'tag', commitProgrammaticText: (value, caret) => { committed = { value, caret } },
        setSuggestions: value => { suggestions = value }, setSuggestionMode: noop, setSelectedIndex: noop,
        setIsVisible: value => { visible = value }, setCoords: noop,
        getCaretCoordinates: () => ({ top: 0, left: 0 }), showSuggestionsAtCaret: noop,
        requestAnimationFrame: noop, scrollToCaret: noop,
    }
    const editor = run(env)
    assert.equal(editor.getDirectiveWord(input, pos), null, input)
    assert.equal(editor.getCurrentWord(input, pos), query, input)
    globalThis.window = { scrollX: 0, scrollY: 0 }
    await editor.checkAutocomplete(input, { selectionEnd: pos, getBoundingClientRect: () => ({ top: 0, left: 0 }) })
    assert.deepEqual(queries, [query], input)
    assert.equal(visible, true, input)
    editor.insertSuggestion(suggestions[0])
    assert.equal(committed.value, expected, input)
    assert.equal(committed.caret, expected.indexOf('blue eyes') + 'blue eyes'.length + (expected.slice(0, -2).endsWith('blue eyes') ? 2 : 0), input)
}
const editor = run({ useCallback: fn => fn, maxSuggestions: 15, fragmentFiles: [] })
for (const value of ['#', '#i', '#if', '#r', '#rChara', '#rArtist<100']) {
    assert.equal(editor.getDirectiveWord(value, value.length), value)
}
assert.equal(editor.getDirectiveWord('#if base: bl', 12), null)
console.log('Directive condition queries and actual suggestion insertion passed: prefixes, AND/OR, deletion lists, middle caret, CRLF and normal/random/weighted tags.')

// Optional isolated UI check with the real tag worker: Playwright path, then local Vite URL.
if (process.argv[2] && process.argv[3]) {
    const { chromium } = createRequire(import.meta.url)(process.argv[2])
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
        const page = await browser.newPage()
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => console.error(error.message))
        await page.route('**/__directive_test__', route => route.fulfill({ contentType: 'text/html', body: `
            <div id="root" style="width:600px;height:220px"></div><script type="module">
            import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
            window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
            await import('/src/styles/globals.css');
            const {default: React} = await import('/node_modules/.vite/deps/react.js');
            const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
            const {AutocompleteTextarea} = await import('/src/components/ui/AutocompleteTextarea.tsx');
            function TestEditor() {
                const [value, setValue] = React.useState('');
                return React.createElement(AutocompleteTextarea, {value, onChange: event => setValue(event.target.value)});
            }
            ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(TestEditor));
            </script>` }))
        for (const [input, expected, tab] of [
            ['#if+blue e', '#if+blue eyes', true],
            ['#if-girl&blue e', '#if-girl&blue eyes', false],
            ['#del-red hair, blue e', '#del-red hair, blue eyes, ', false],
        ]) {
            await page.goto(`${process.argv[3]}/__directive_test__`)
            const textarea = page.locator('textarea')
            await textarea.fill(input)
            const suggestion = page.getByText('blue eyes', { exact: true })
            await suggestion.waitFor()
            if (tab) {
                const index = await suggestion.locator('../..').evaluate(element => Array.from(element.parentElement.children).indexOf(element))
                for (let i = 0; i < index; i++) await textarea.press('ArrowDown')
                await textarea.press('Tab')
            } else await suggestion.click()
            await page.waitForFunction(expected => document.querySelector('textarea').value === expected, expected)
            await textarea.press('Control+z')
            await page.waitForFunction(input => document.querySelector('textarea').value === input, input)
            await textarea.press('Control+Shift+z')
            await page.waitForFunction(expected => document.querySelector('textarea').value === expected, expected)
        }
        console.log('Real editor + bundled tag worker passed: condition/delete completion, Tab/click selection and Undo/Redo, using isolated browser storage.')
    } finally { await browser.close() }
}
