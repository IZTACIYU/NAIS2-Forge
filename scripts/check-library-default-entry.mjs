import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/stores/library-store.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const original = {
  items: [{ id: 'stack', name: 'Stack', path: '/original/a.png', width: 832, height: 1216, createdAt: 1, folderId: 'a',
    isStack: true, stackItems: [{ id: 'image', name: 'Image', path: '/original/a.png', width: 832, height: 1216, createdAt: 1, folderId: 'a' }] }],
  folders: [{ id: 'a', name: 'A', collapsed: true }, { id: 'b', name: 'B', parentId: 'a' }],
  gridColumns: 6, thumbnailLayout: 'square',
}
let serialized = JSON.stringify({ state: original, version: 0 })
async function loadStore() {
  const exports = {}
  vm.runInNewContext(code, { exports, crypto, require(name) {
    if (name === '@/lib/indexed-db') return { createNativeDeferredJSONStorage(debounce, maxWait) {
      assert.equal(debounce, 1000); assert.equal(maxWait, 5000)
      return { async getItem(key) { assert.equal(key, 'nais2-forge-library'); return JSON.parse(serialized) },
        async setItem(key, value) { assert.equal(key, 'nais2-forge-library'); serialized = JSON.stringify(value) } }
    } }
    return require(name)
  } })
  const store = exports.useLibraryStore
  if (!store.persist.hasHydrated()) await new Promise(resolve => { const unsubscribe = store.persist.onFinishHydration(() => { unsubscribe(); resolve() }) })
  return { ...exports, store }
}
const libraryExports = await loadStore()
let { store, resolveLibraryDefaultFolderId: resolve, LIBRARY_ALL_FOLDER_ID: all, LIBRARY_UNGROUPED_FOLDER_ID: ungrouped } = libraryExports
assert.equal(store.getState().defaultFolderId, null, 'legacy data defaults without migration')
assert.equal(resolve(undefined, original.folders), all)
assert.equal(resolve(null, original.folders), all)
assert.equal(resolve('missing', original.folders), all)
const preserved = () => {
  const saved = JSON.parse(serialized).state
  for (const field of Object.keys(original)) assert.deepEqual(saved[field], original[field], `${field} must not change when setting entry`)
}
for (const folderId of ['a', 'b', ungrouped, all, null]) {
  store.getState().setDefaultFolderId(folderId)
  preserved()
  ;({ store } = await loadStore())
  assert.equal(store.getState().defaultFolderId, folderId, 'entry survives a new store instance')
  assert.equal(resolve(folderId, store.getState().folders), folderId ?? all)
}
store.getState().setDefaultFolderId('b')
store.getState().setDefaultFolderId('missing')
assert.equal(store.getState().defaultFolderId, 'b', 'invalid assignments must not overwrite the setting')
store.getState().updateFolder('b', { name: 'Renamed' })
store.getState().moveFolder('b', undefined)
store.getState().reorderFolder('b', 'up')
assert.equal(store.getState().defaultFolderId, 'b', 'rename/move/reorder must retain stable folder identity')
store.getState().deleteFolder('a')
assert.equal(store.getState().defaultFolderId, 'b', 'deleting another folder must preserve the default')
store.getState().deleteFolder('b')
assert.equal(store.getState().defaultFolderId, null, 'deleting the default restores all view')
assert.equal(resolve(store.getState().defaultFolderId, store.getState().folders), all)
assert.equal(store.getState().items[0].stackItems[0].path, '/original/a.png')

// Verify the actual page boundary mounts only after hydration, and captures the
// saved entry on mount rather than rendering all images then changing in an effect.
const page = readFileSync(new URL('../src/pages/Library.tsx', import.meta.url), 'utf8')
const boundary = page.slice(page.indexOf('function subscribeLibraryHydration'), page.indexOf('function LibraryContent'))
let libraryReady = false, settingsReady = false, subscriptions = 0
const hydration = () => ({ hasHydrated: () => libraryReady, onHydrate: subscribe, onFinishHydration: subscribe })
function subscribe() { subscriptions++; return () => subscriptions-- }
const context = { exports: {}, useLibraryStore: { persist: hydration() },
  useSettingsStore: { persist: { ...hydration(), hasHydrated: () => settingsReady } },
  useSyncExternalStore: (_, snapshot) => snapshot(), LibraryContent() {}, React: { createElement: component => component } }
vm.runInNewContext(ts.transpileModule(boundary + '\nexports.subscribe = subscribeLibraryHydration;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }, fileName: 'boundary.tsx',
}).outputText, context)
assert.equal(context.exports.default(), null)
libraryReady = true
assert.equal(context.exports.default(), null, 'settings must hydrate before applying folder filtering')
settingsReady = true
assert.equal(context.exports.default(), context.LibraryContent)
const unsubscribe = context.exports.subscribe(() => {})
assert.equal(subscriptions, 4); unsubscribe(); assert.equal(subscriptions, 0)
const initializer = page.match(/useState<LibraryFolderSelection>\((\(\) => resolveLibraryDefaultFolderId\(defaultFolderId, folders\))\)/)?.[1]
assert.ok(initializer, 'first render must initialize from saved default')
assert.equal(vm.runInNewContext(`(${initializer})()`, { resolveLibraryDefaultFolderId: resolve, defaultFolderId: 'b', folders: original.folders }), 'b')
const viewBody = page.match(/const viewItems = useMemo\(\(\) => \{([\s\S]*?)\}, \[/)?.[1]
assert.ok(viewBody)
const view = { items: [{ id: 'a', folderId: 'a' }, { id: 'b', folderId: 'b' }, { id: 'u' }], currentStackId: null, currentStack: null,
  expertLibraryFolderBrowserEnabled: true, selectedFolderId: 'b', folderIds: new Set(['a', 'b']), LIBRARY_ALL_FOLDER_ID: all, LIBRARY_UNGROUPED_FOLDER_ID: ungrouped }
const visible = () => Array.from(vm.runInNewContext(`(() => {${viewBody}})()`, view), item => item.id)
assert.deepEqual(visible(), ['b'], 'initial custom entry must not render the all-image grid')
view.selectedFolderId = ungrouped; assert.deepEqual(visible(), ['u'])
view.expertLibraryFolderBrowserEnabled = false; assert.deepEqual(visible(), ['a', 'b', 'u'])
view.currentStackId = 'stack'; view.currentStack = { stackItems: [{ id: 'inside' }] }; assert.deepEqual(visible(), ['inside'])

for (const lang of ['ko', 'en', 'ja']) {
  const translations = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${lang}.json`, import.meta.url), 'utf8'))
  for (const key of ['setDefaultEntry', 'clearDefaultEntry', 'defaultEntry']) assert.ok(translations.library[key])
}
// Render the real sidebar and exercise its menu callbacks. Only platform/UI
// wrappers are stubbed; the actual Zustand actions above remain in use.
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
serialized = JSON.stringify({ state: { ...original, defaultFolderId: 'a' }, version: 0 })
;({ store } = await loadStore())
let menus = []
const sidebarModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/library/LibraryFolderSidebar.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: 'sidebar.tsx',
}).outputText, { module: sidebarModule, exports: sidebarModule.exports, require(name) {
  if (name === '@/stores/library-store') return { ...libraryExports, useLibraryStore: () => store.getState() }
  if (name === 'react-i18next') return { useTranslation: () => ({ t: key => key }) }
  if (name === '@dnd-kit/core') return { useDroppable: () => ({ isOver: false, setNodeRef() {} }) }
  if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') }
  if (name === '@/stores/character-prompt-store') return { FOLDER_COLORS: [{ icon: '' }] }
  if (name.startsWith('@/components/')) return new Proxy({}, { get(_, key) {
    return props => {
      if (key === 'ContextMenuItem' && props.onSelect) menus.push(props)
      const { children } = props
      return React.createElement('div', { 'data-component': key }, children)
    }
  } })
  return require(name)
} })
function renderSidebar() {
  menus = []
  return renderToStaticMarkup(React.createElement(sidebarModule.exports.LibraryFolderSidebar, {
    items: store.getState().items, selectedFolderId: 'b', onSelectFolder() {}, isDraggingItem: false,
  }))
}
store.getState().toggleFolderCollapsed('a')
let markup = renderSidebar()
assert.equal(menus.length, 4, 'all/ungrouped/folder/child must each have one default menu action')
assert.equal(menus[2].children[1], 'library.clearDefaultEntry')
assert.equal((markup.match(/ring-1 ring-inset ring-primary\/70/g) ?? []).length, 1)
menus[2].onSelect(); assert.equal(store.getState().defaultFolderId, null)
renderSidebar(); menus[1].onSelect(); assert.equal(store.getState().defaultFolderId, ungrouped)
renderSidebar(); menus[0].onSelect(); assert.equal(store.getState().defaultFolderId, all)
renderSidebar(); menus[0].onSelect(); assert.equal(store.getState().defaultFolderId, null)
console.log('Library default entry passed: legacy/reload/data preservation, set/clear/all/ungrouped/nested, stable identity, deletion fallback and hydration-first mount.')

// Optional actual browser check: pass the installed Playwright package path.
if (process.argv[2]) {
  const { build } = await import('esbuild')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const bundle = await build({ absWorkingDir: root, write: false, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
    alias: { '@': `${root}/src` },
    plugins: [{ name: 'library-test', setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/indexed-db$/ }, () => ({ path: 'storage', namespace: 'test' }))
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const indexedDBStorage = { async getItem(){ return null }, async setItem(){}, async removeItem(){} };
          export function createNativeDeferredJSONStorage(){ return indexedDBStorage }` }))
    } }], stdin: { resolveDir: root, loader: 'tsx', contents: `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
          import {DndContext} from '@dnd-kit/core'; import i18next from 'i18next'; import {initReactI18next} from 'react-i18next';
          import ko from './src/i18n/locales/ko.json'; import en from './src/i18n/locales/en.json'; import ja from './src/i18n/locales/ja.json';
          import {LibraryFolderSidebar} from './src/components/library/LibraryFolderSidebar'; import {useLibraryStore} from './src/stores/library-store';
          async function start(){
          await i18next.use(initReactI18next).init({lng:'ko', resources:{ko:{translation:ko},en:{translation:en},ja:{translation:ja}}});
          await useLibraryStore.persist.rehydrate(); useLibraryStore.setState(${JSON.stringify(original)});
          window.testStore=useLibraryStore; window.testLanguage=lng=>i18next.changeLanguage(lng);
          function Test(){const [selected,setSelected]=useState('__all__');return <DndContext><LibraryFolderSidebar
            items={useLibraryStore(s=>s.items)} selectedFolderId={selected} onSelectFolder={setSelected} isDraggingItem={false}/></DndContext>}
          createRoot(document.getElementById('root')).render(<Test/>)}; start();` } })
  const browser = await require(process.argv[2]).chromium.launch({ channel: 'msedge', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } })
    page.setDefaultTimeout(30000)
    const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    const { readdirSync } = await import('node:fs')
    const css = readdirSync(new URL('../dist/assets/', import.meta.url)).find(name => /^index-.*\.css$/.test(name))
    assert.ok(css, 'build the app before running the optional browser check')
    await page.setContent(`<html class="dark"><style>${readFileSync(new URL(`../dist/assets/${css}`, import.meta.url), 'utf8')}</style><body><div id="root" style="display:flex;height:100vh"></div></body></html>`)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const row = name => page.locator('aside').getByText(name, { exact: true })
    await row('전체 보기').click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem').count(), 1)
    await page.getByRole('menuitem', { name: '기본 진입으로 설정', exact: true }).click()
    assert.equal(await page.evaluate(() => testStore.getState().defaultFolderId), all)
    await row('미분류').click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem').count(), 1)
    await page.getByRole('menuitem', { name: '기본 진입으로 설정', exact: true }).click()
    assert.equal(await page.evaluate(() => testStore.getState().defaultFolderId), ungrouped)
    await row('A').click({ button: 'right' })
    assert.equal(await page.getByRole('menuitem').last().innerText(), '기본 진입으로 설정')
    await page.getByRole('menuitem').last().click()
    assert.equal(await page.evaluate(() => testStore.getState().defaultFolderId), 'a')
    assert.ok((await page.locator('aside [title="기본 진입 위치"]').getAttribute('class')).includes('ring-primary/70'))
    await row('A').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '기본 진입 설정 해제', exact: true }).click()
    assert.equal(await page.evaluate(() => testStore.getState().defaultFolderId), null)
    for (const lang of ['ko', 'en', 'ja']) {
      await page.evaluate(lang => window.testLanguage(lang), lang)
      for (const width of [360, 800, 1400]) {
        await page.setViewportSize({ width, height: 640 })
        await page.locator('aside button').filter({ has: page.locator('svg') }).nth(1).click({ button: 'right' })
        const box = await page.getByRole('menu').boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'menu must remain within the viewport')
        await page.keyboard.press('Escape')
      }
    }
    assert.deepEqual(errors, [])
    console.log('Browser sidebar passed: real context menus, set/clear callbacks, only-one special menu, last folder action, and 3 languages × 3 widths.')
  } finally { await browser.close() }
}
