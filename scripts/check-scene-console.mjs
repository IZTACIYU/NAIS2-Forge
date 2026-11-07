import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createStore } from 'zustand/vanilla'
import { persist, createJSONStorage } from 'zustand/middleware'

function compile(path, require, extra = {}) {
    const exports = {}
    vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
        { exports, require, console, TextDecoder, TextEncoder, atob, btoa, Uint8Array, DataView, crypto, ...extra })
    return exports
}
if (!process.argv.includes('--ui-only')) {
const cache = new Map()
function load(name) {
    if (cache.has(name)) return cache.get(name)
    const path = name.replace(/^@\/lib\//, '').replace(/^\.\//, '').replace(/\.ts$/, '')
    const result = compile(`src/lib/${path}.ts`, load)
    cache.set(name, result); return result
}
const commands = load('scene-feature-command')
for (const feature of ['stack', 'czip']) for (const value of ['on', 'off']) {
    assert.equal(commands.parseSceneFeatureCommand(`scene.${feature} ${value}`).enabled, value === 'on')
}
for (const invalid of ['eval(1)', 'scene.stack on; alert(1)', 'scene.czip yes', 'scene.czip on\nscene.stack on']) assert.equal(commands.parseSceneFeatureCommand(invalid), null)
const shortcut = { code: 'Backquote', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false }
assert.equal(commands.isSceneConsoleShortcut(shortcut, false), true)
assert.equal(commands.isSceneConsoleShortcut(shortcut, true), false)
for (const update of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { shiftKey: false }, { ctrlKey: false }, { altKey: true }, { code: 'KeyA' }]) assert.equal(commands.isSceneConsoleShortcut({ ...shortcut, ...update }, false), false)

// Exercise actual settings persistence, using only isolated synthetic storage.
const key = 'nais2-forge-settings'
const original = { savePath: 'keep/path', r2Bucket: 'unchanged', exportWebpQuality: 87, customResolutions: [{ id: 'keep', label: 'Keep', width: 832, height: 1216 }], futureSetting: { keep: true } }
let serialized = JSON.stringify({ state: original, version: 0 }), writes = 0
async function settings() {
    const exports = compile('src/stores/settings-store.ts', name => name === 'zustand' ? { create: () => createStore }
        : name === 'zustand/middleware' ? { persist, createJSONStorage }
        : { indexedDBStorage: { getItem: async () => serialized, setItem: async (name, value) => { assert.equal(name, key); writes++; serialized = value } } })
    const store = exports.useSettingsStore
    if (!store.persist.hasHydrated()) await new Promise(resolve => store.persist.onFinishHydration(resolve))
    return store
}
const first = await settings()
assert.equal(writes, 0)
assert.equal(first.getState().consoleSceneStacksEnabled, false)
assert.equal(first.getState().consoleCharacterZipEnabled, false)
first.getState().setConsoleFeature('stack', true); first.getState().setConsoleFeature('czip', true)
const next = await settings()
assert.equal(writes, 2, 'Reopening must not write default settings')
assert.equal(next.getState().consoleSceneStacksEnabled, true)
assert.equal(next.getState().consoleCharacterZipEnabled, true)
next.getState().setConsoleFeature('stack', false)
assert.equal(next.getState().consoleCharacterZipEnabled, true)
for (const [field, value] of Object.entries(original)) assert.deepEqual(JSON.parse(serialized).state[field], value)

const grouping = load('scene-character-groups'), naming = load('scene-zip-entries')
assert.deepEqual([...grouping.getForgeCharacterNames({ characterPrompts: [{ name: 'A - abc123 - 2' }, { name: 'A - abc123 - 1' }, { prompt: 'not a name' }] })], ['A'])
const image = (id, names, timestamp, isFavorite = false) => ({ id, url: `/fixtures/${id}.png`, timestamp, isFavorite, names })
const a1 = image('a1', ['A'], 5), a2 = image('a2', ['A'], 2, true), b = image('b', ['B'], 3)
const unknown = image('unknown', [], 1), unknown2 = image('unknown2', [], 2), multi = image('multi', ['A', 'B'], 9)
const scenes = Array.from({ length: 5 }, (_, i) => ({ id: `scene${i}`, name: `Scene ${i}`, images: i === 0 ? [a1, a2, b, unknown, unknown2, multi] : i === 4 ? [image('z', ['Z'], 10)] : [image(`A${i}`, ['A'], i)] }))
const index = new Map(scenes.flatMap(scene => scene.images.map(img => [grouping.sceneCharacterImageKey(img), { names: img.names }])))
assert.deepEqual([...grouping.collectSceneCharacterNames(scenes, index)], ['A', 'B'], 'Only the first four scenes supply names')
const groups = grouping.groupSceneCharacterImages(scenes[0].images, index)
assert.equal(groups.length, 5, 'Unknown images stay separate')
assert.equal(groups.find(group => group.names.length === 1 && group.names[0] === 'A').top.id, 'a2')
const baseline = JSON.stringify(scenes)
const plan = grouping.selectCharacterExportScenes(scenes, index, new Set(['A', 'B']), true)
assert.equal(plan.byCharacter.get('A').length, 4)
assert.equal(plan.byCharacter.get('B').length, 1)
assert.equal(plan.byCharacter.get('A')[0].images[0].id, 'a2')
assert.equal(plan.ambiguous, 1); assert.equal(plan.unknown, 2)
assert.equal(JSON.stringify(scenes), baseline)
const used = new Set()
for (const name of ['../A', '../A', 'a', 'A', 'CON', '...', 'long'.repeat(80)]) {
    const filename = naming.getCharacterZipName(name, used)
    assert.ok(!/[<>:"/\\|?*]/.test(filename) && !filename.startsWith('..'))
}
for (const format of ['png', 'jpeg', 'webp']) {
    const entries = naming.createSceneZipEntries(scenes.slice(0, 2), format, false, 'prefix')
    assert.equal(entries[0].source, a2.url)
    assert.ok(entries[0].fileName.endsWith(format === 'jpeg' ? '.jpg' : `.${format}`))
}

// Real metadata reader, batching and common native transport; file/codec I/O is mocked.
const png = load('nais2-png-meta')
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII='
const tagged = png.embedNais2Params(pixel, { generationSources: { characterPrompts: [{ name: 'A - abc123 - 0' }], characterReferences: [], vibeReferences: [], characterPositionEnabled: false } })
let reads = 0, released = 0, inFlight = 0
const invoked = []
const reader = compile('src/services/scene-character-images.ts', name => {
    if (name === '@tauri-apps/plugin-fs') return { readFile: async () => { reads++; return Uint8Array.from(Buffer.from(tagged, 'base64')) } }
    if (name.endsWith('metadata-parser')) return { parseNAIMetadata: async () => { throw Error('Tagged PNG must not decode pixels') } }
    return load(name)
})
const readIndex = new Map()
await reader.indexSceneCharacters(scenes.slice(0, 4), readIndex, () => true)
assert.equal(reads, scenes.slice(0, 4).reduce((sum, scene) => sum + scene.images.length, 0))
assert.equal(JSON.stringify([...readIndex.values()][0].names), JSON.stringify(['A']))
const callsBefore = reads
await reader.indexSceneCharacters(scenes, readIndex, () => false)
assert.equal(reads, callsBefore)
const transport = compile('src/services/scene-zip.ts', name => name.includes('/event') ? { listen: async () => () => { released++ } } : {
    invoke: async (command, args) => {
        assert.equal(command, 'export_scene_images_zip'); assert.equal(inFlight++, 0)
        invoked.push(args); await new Promise(setImmediate); inFlight--
        return { exportedCount: args.entries.length, skippedCount: 0 }
    },
})
const batch = compile('src/services/character-scene-export.ts', name => {
    if (name === '@tauri-apps/plugin-fs') return { exists: async path => path.endsWith('/A.zip') }
    if (name === '@tauri-apps/api/path') return { join: async (...parts) => parts.join('/') }
    if (name === './scene-character-images') return { indexSceneCharacters: async () => {} }
    if (name === './scene-zip') return transport
    return load(name)
})
for (const format of ['png', 'webp', 'jpeg']) {
    const result = await batch.exportCharacterScenes({ scenes, index, selected: new Set(['A', 'B']), stacks: true,
        directory: '/output', format, quality: 83, namingEnabled: false, namePart: 'prefix', shouldContinue: () => true, onProgress() {} })
    assert.equal(result.archives, 2); assert.equal(result.images, 5)
    assert.ok(invoked[invoked.length - 2].outputPath.endsWith('/A_2.zip'), 'Existing ZIP must not be selected for overwrite')
    assert.equal(invoked[invoked.length - 1].quality, format === 'webp' ? 83 : 90)
}
assert.equal(released, 6); assert.equal(inFlight, 0)
assert.equal(JSON.stringify(scenes), baseline)
for (const language of ['ko', 'en', 'ja']) {
    const locale = JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8'))
    assert.equal(Object.keys(locale.scenePrivate).length, 15)
}
console.log('Scene console passed: exact commands/focus/IME, isolated persistent flags and old fields, metadata names, first-four discovery, stack tops, ambiguity/missing scenes, safe names, PNG reader and sequential shared PNG/WebP/JPEG export transport. No user DB/files or real ZIPs used.')
}

if (process.argv[2] && process.argv[3]) {
    const { chromium } = createRequire(import.meta.url)(process.argv[2])
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
        const page = await browser.newPage()
        page.on('pageerror', error => console.error(error.message))
        await page.route('**/__scene_console_test__', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
            import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
            window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
            await import('/src/styles/globals.css'); await import('/src/i18n/index.ts');
            const {default: React}=await import('/node_modules/.vite/deps/react.js');
            const {default: ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
            const {SceneCommandConsole}=await import('/src/components/SceneCommandConsole.tsx');
            const {CharacterZipDialog}=await import('/src/components/scene/CharacterZipDialog.tsx');
            const {useSettingsStore}=await import('/src/stores/settings-store.ts');
            if(!useSettingsStore.persist.hasHydrated()) await new Promise(resolve=>useSettingsStore.persist.onFinishHydration(resolve));
            window.testSettings=useSettingsStore;
            const {embedNais2Params}=await import('/src/lib/nais2-png-meta.ts');
            const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
            const source=name=>'data:image/png;base64,'+embedNais2Params(canvas.toDataURL().split(',')[1],{generationSources:{characterPrompts:[{name}],characterReferences:[],vibeReferences:[],characterPositionEnabled:false}});
            window.scenes=Array.from({length:5},(_,i)=>({id:'s'+i,name:'Scene '+i,images:[{id:'i'+i,url:source(i===4?'Outside four':'Character A'),timestamp:i,isFavorite:false}]}));
            const root=ReactDOM.createRoot(document.getElementById('root'));
            window.showZip=()=>root.render(React.createElement(CharacterZipDialog,{open:true,onOpenChange:()=>{},scenes:window.scenes}));
            window.showStack=async()=>{
                const {useSceneStore}=await import('/src/stores/scene-store.ts');
                if(!useSceneStore.persist.hasHydrated()) await new Promise(resolve=>useSceneStore.persist.onFinishHydration(resolve));
                const scene={...window.scenes[0],scenePrompt:'',queueCount:0,createdAt:1,images:[window.scenes[0].images[0],{...window.scenes[0].images[0],id:'second',timestamp:20}]};
                useSceneStore.setState({presets:[{id:'p',name:'Fixture',scenes:[scene],createdAt:1}],activePresetId:'p'});
                useSettingsStore.getState().setConsoleFeature('stack',true);
                const script=await(await fetch('/src/pages/SceneDetail.tsx')).text();
                const routerPath=script.match(/from "([^"]*react-router-dom[^"]*)"/)[1];
                const {MemoryRouter,Routes,Route}=await import(routerPath);
                const {TooltipProvider}=await import('/src/components/ui/tooltip.tsx');
                const {default:SceneDetail}=await import('/src/pages/SceneDetail.tsx');
                root.render(React.createElement(TooltipProvider,null,React.createElement(MemoryRouter,{initialEntries:['/scenes/s0']},React.createElement(Routes,null,React.createElement(Route,{path:'/scenes/:id',element:React.createElement(SceneDetail)})))));
            };
            root.render(React.createElement(React.Fragment,null,React.createElement('input',{'aria-label':'Focus test'}),React.createElement(SceneCommandConsole)));
            </script>` }))
        await page.goto(`${process.argv[3]}/__scene_console_test__`)
        await page.waitForFunction(() => window.testSettings)
        await page.getByLabel('Focus test').focus()
        await page.keyboard.press('Control+Shift+Backquote')
        assert.equal(await page.getByRole('dialog').count(), 0)
        await page.getByLabel('Focus test').evaluate(element => element.blur())
        await page.keyboard.press('Control+Shift+Backquote')
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog.locator('input').fill('scene.czip on'); await dialog.locator('input').press('Enter')
        await page.waitForFunction(() => window.testSettings.getState().consoleCharacterZipEnabled)
        await page.keyboard.press('Escape')
        await page.evaluate(() => window.showZip())
        await page.getByText('Character A', { exact: true }).waitFor()
        assert.equal(await page.getByText('Outside four', { exact: true }).count(), 0)
        assert.equal(await page.getByRole('checkbox').count(), 1)
        for (const language of ['ko', 'en', 'ja']) {
            await page.evaluate(async language => (await import('/src/i18n/index.ts')).default.changeLanguage(language), language)
            for (const width of [360, 1024]) {
                await page.setViewportSize({ width, height: 800 })
                assert.ok(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth))
            }
        }
        await page.evaluate(() => window.showStack())
        await page.waitForFunction(() => document.querySelectorAll('img[alt="Scene Image"]').length === 1 && document.querySelector('div.bg-purple-500'))
        await page.locator('div.bg-purple-500').locator('..').click()
        await page.waitForFunction(() => document.querySelectorAll('img[alt="Scene Image"]').length === 2)
        await page.getByRole('button').filter({ hasText: 'Character A' }).click()
        await page.waitForFunction(() => document.querySelectorAll('img[alt="Scene Image"]').length === 1)
        console.log('Isolated real UI passed: editable focus guard, console command, C.zip first-four name list, checkboxes and 3-language narrow/wide layout.')
    } finally { await browser.close() }
}
