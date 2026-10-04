import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes, createRequire } from 'node:module'
import { characterPreset, eligibleCharacters } from '../src/lib/danbooru-characters.ts'

assert.deepEqual(characterPreset('hatsune_miku_(append)', 'solo 1girl hatsune_miku_(append)'), {
    name: 'hatsune miku (append)', prompt: 'girl, hatsune miku (append)', negative: '',
})
assert.equal(characterPreset('test', '1boy solo').prompt, 'boy, test')
for (const tags of ['', '1boy 1girl', '1girl 2boys', '1girl genderswap', '1girl multiple_boys']) {
    assert.equal(characterPreset('test', tags).prompt, 'test')
}
const candidates = ['base', 'skin', 'missing', 'general'].map(tag => ({ tag }))
const tags = [
    { value: 'base', count: 100, type: 'character' },
    { value: 'skin', count: 99, type: 'character' },
    { value: 'general', count: 999, type: 'general' },
]
assert.deepEqual(eligibleCharacters(candidates, tags, 100), [{ tag: 'base' }])
assert.throws(() => eligibleCharacters(candidates, tags, -1))
assert.throws(() => eligibleCharacters(candidates, tags, NaN))
console.log('Danbooru character count and gender checks passed')

// Optional real DOM checks: pass a Playwright installation and a saved wiki HTML.
if (process.argv[2]) {
    const { chromium } = createRequire(import.meta.url)(process.argv[2])
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
        const page = await browser.newPage()
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => console.error(error.message))
        const source = stripTypeScriptTypes(await readFile(new URL('../src/lib/danbooru-characters.ts', import.meta.url), 'utf8')).replace(/export /g, '')
        const fixture = `<div id="wiki-page-body"><h4>Appearance</h4><media-gallery>
            <article data-type="post" data-id="123"><a class="dtext-wiki-link tag-type-4" href="/wiki_pages/base_(skin)">Skin</a></article>
            <a class="dtext-wiki-link tag-type-4" href="/wiki_pages/base_(skin)">Duplicate</a>
            <a class="dtext-wiki-link tag-type-4 dtext-wiki-does-not-exist" href="/wiki_pages/missing">Missing</a>
            <a class="dtext-wiki-link tag-type-0" href="/wiki_pages/clothes">General</a>
            <a class="dtext-wiki-link tag-type-4" href="https://example.com/wiki_pages/foreign">Foreign</a>
            </media-gallery><h4>Skins</h4><media-gallery>
            <article data-type="post" data-id="456"><a class="dtext-wiki-link tag-type-4" href="/wiki_pages/base_(costume)">Costume</a></article>
            </media-gallery><h4>Derivatives</h4><a class="dtext-wiki-link tag-type-4" href="/wiki_pages/other">Other</a></div>`
        const parse = (html, url = 'https://danbooru.donmai.us/wiki_pages/base') => page.evaluate(({ source, html, url }) => {
            const run = new Function('html', 'url', `${source}; return readWikiCharacters(new DOMParser().parseFromString(html, 'text/html'), url)`)
            return run(html, url)
        }, { source, html, url })
        assert.deepEqual(await parse(fixture), [{ tag: 'base', postId: '123' }, { tag: 'base_(skin)', postId: '123' }, { tag: 'base_(costume)', postId: '456' }])
        await assert.rejects(parse('<div>Not a wiki</div>'))
        if (process.argv[5]) {
            const saved = await readFile(process.argv[5], 'utf8')
            const wiki = await page.evaluate(html => {
                const document = new DOMParser().parseFromString(html, 'text/html')
                const body = [...document.querySelectorAll('div.prose')].find(element => [...element.querySelectorAll('h4')].some(heading => heading.textContent === 'Skins'))
                return `<div id="wiki-page-body">${body.innerHTML}</div>`
            }, saved)
            const result = await parse(wiki, 'https://danbooru.donmai.us/wiki_pages/ump45_(girls%27_frontline)')
            assert.equal(result.length, 10)
            assert.equal(result[0].postId, '2559537')
            assert.ok(result.some(item => item.tag === 'ump45_(mod3)_(girls\'_frontline)' && item.postId === '3991946'))
            assert.ok(result.some(item => item.tag === 'ump45_(diamond_flower)_(girls\'_frontline)' && item.postId === '3991968'))
            assert.ok(result.some(item => item.tag === 'ump45_(corona_sunset)_(girls\'_frontline)' && item.postId === '5703562'))
            console.log(`Saved UMP45 wiki content passed: ${result.length} base, appearance and skin candidates`)
        }
        if (process.argv[3]) {
            const result = await parse(await readFile(process.argv[3], 'utf8'))
            assert.equal(result[0].postId, '6549225')
            assert.equal(result.filter(item => item.tag === 'hatsune_miku_(vocaloid3)').length, 1)
            assert.ok(result.some(item => item.tag === 'hatsune_miku_(append)' && item.postId === '662258'))
            console.log(`Saved wiki DOM passed: ${result.length} unique candidates`)
        }
        console.log('Real DOM scope, link validity, duplicates and post association checks passed')
        const browserRead = await readFile(new URL('../src-tauri/src/danbooru-read.js', import.meta.url), 'utf8')
        const origin = 'https://danbooru.donmai.us'
        let wikiRequests = 0
        await page.route(`${origin}/wiki_pages/base`, route => {
            wikiRequests++
            return route.fulfill({ contentType: 'text/html', body: fixture })
        })
        await page.route(`${origin}/posts/123.json`, route => route.fulfill({
            status: route.request().headers().cookie?.includes('reader_test=accepted') ? 200 : 403,
            contentType: 'application/json', body: JSON.stringify({ tag_string: '1girl base' }),
        }))
        let reply
        await page.route('https://danbooru-reader.localhost/**', route => {
            reply = route.request().postDataJSON()
            return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin } })
        })
        await page.context().addCookies([{ name: 'reader_test', value: 'accepted', domain: 'danbooru.donmai.us', path: '/', secure: true, httpOnly: true }])
        await page.goto(`${origin}/wiki_pages/base`)
        const readInBrowser = target => page.evaluate(({ browserRead, target, origin }) =>
            new Function(`return (\n${browserRead}\n)`)()(target, origin, 'https://danbooru-reader.localhost/test'),
        { browserRead, target, origin })
        await readInBrowser(null)
        assert.ok(reply.html.includes('Appearance'))
        assert.equal(wikiRequests, 1, 'Current document must not be fetched again')
        assert.equal(await page.evaluate(async () => (await fetch('/posts/123.json', { credentials: 'omit' })).status), 403)
        await readInBrowser(`${origin}/posts/123.json`)
        assert.equal(JSON.parse(reply.html).tag_string, '1girl base')
        await readInBrowser('https://example.com/posts/123.json')
        assert.match(reply.error, /same-origin/)
        await page.context().clearCookies()
        await readInBrowser(`${origin}/posts/123.json`)
        assert.match(reply.error, /HTTP 403/)
        console.log('Browser-session regression passed: no document refetch, cookie-bound post read, explicit 403 and cross-origin rejection')
        if (process.argv[4]) {
            const html = await readFile(process.argv[3], 'utf8')
            await page.addInitScript(({ html }) => {
                localStorage.setItem('i18nextLng', 'ko')
                const existingPreset = { id: 'keep-preset', name: 'Existing preset', prompt: 'unchanged preset', negative: 'keep negative', groupId: 'keep-group' }
                const existingCharacter = { id: 'keep-character', name: 'Existing character', prompt: 'unchanged character', negative: 'keep negative', enabled: true, position: { x: 0.2, y: 0.7 } }
                const duplicateCharacter = { id: 'keep-miku', name: 'My Miku', prompt: 'girl, hatsune miku', negative: 'personal', enabled: false, position: { x: 0.5, y: 0.5 } }
                window.testState = { value: JSON.stringify({ state: { presets: [existingPreset], characters: [existingCharacter, duplicateCharacter], groups: [{ id: 'keep-group', name: 'Folder' }] }, version: 1 }), settings: {} }
                window.__TAURI_INTERNALS__ = {
                    invoke: async (command, args) => {
                        if (command === 'is_browser_open' || command === 'is_danbooru_browser_page') return true
                        if (command === 'plugin:store|load') return 1
                        if (command === 'plugin:store|get') return [window.testState.settings[args.key], args.key in window.testState.settings]
                        if (command === 'plugin:store|set') { window.testState.settings[args.key] = args.value; return }
                        if (command === 'state_db_get') return window.testState.value
                        if (command === 'state_db_set') { window.testState.value = args.value; return }
                        if (command === 'read_danbooru_page') return args.path?.includes('/posts/')
                            ? { html: JSON.stringify({ tag_string: '1girl hatsune_miku hatsune_miku_(append) hatsune_miku_(vocaloid3)' }) }
                            : { url: 'https://danbooru.donmai.us/wiki_pages/hatsune_miku', html }
                    },
                }
            }, { html })
            await page.route('**/__danbooru_test__', route => route.fulfill({ contentType: 'text/html', body: `<div id="root" style="height:100vh"></div><script type="module">
                import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
                await import('/src/styles/globals.css'); await import('/src/i18n/index.ts');
                const {default: React} = await import('/node_modules/.vite/deps/react.js');
                const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
                const {indexedDBStorage} = await import('/src/lib/indexed-db.ts');
                await indexedDBStorage.setItem('nais2-forge-character-prompts', window.testState.value);
                const {default: WebView} = await import('/src/pages/WebView.tsx');
                window.testStore = (await import('/src/stores/character-prompt-store.ts')).useCharacterPromptStore;
                const root = ReactDOM.createRoot(document.getElementById('root'));
                root.render(React.createElement(WebView));
                window.showCharacterPanel = async () => {
                    const panelSource = await (await fetch('/src/components/character/CharacterPromptPanel.tsx')).text();
                    const routerPath = panelSource.match(/from "([^"]*react-router-dom[^"]*)"/)[1];
                    const {MemoryRouter} = await import(routerPath);
                    const {TooltipProvider} = await import('/src/components/ui/tooltip.tsx');
                    const {CharacterPromptPanel} = await import('/src/components/character/CharacterPromptPanel.tsx');
                    root.render(React.createElement(MemoryRouter, null, React.createElement(TooltipProvider, null, React.createElement(CharacterPromptPanel, {open: true, onOpenChange: () => {}}))));
                };
                </script>` }))
            await page.goto(`${process.argv[4]}/__danbooru_test__`)
            const extract = page.getByRole('button', { name: '캐릭터 추출', exact: true })
            await extract.waitFor()
            await page.waitForFunction(() => window.testStore?.persist.hasHydrated())
            const before = await page.evaluate(() => ({ characters: window.testStore.getState().characters, presets: window.testStore.getState().presets }))
            await extract.click()
            await page.waitForFunction(() => window.testStore.getState().characters.length > 2)
            await page.waitForFunction(() => !document.querySelector('button[aria-label="캐릭터 추출"]').disabled)
            const first = await page.evaluate(() => ({ characters: window.testStore.getState().characters, presets: window.testStore.getState().presets }))
            assert.deepEqual(first.characters.slice(0, 2), before.characters)
            assert.deepEqual(first.presets, before.presets)
            assert.equal(first.characters.length, 9)
            assert.ok(first.characters.slice(2).every(character => !character.enabled && character.name === character.prompt && !character.negative))
            assert.ok(first.characters.some(character => character.name === 'girl, hatsune miku (append)'))
            await extract.click()
            await page.waitForFunction(() => !document.querySelector('button[aria-label="캐릭터 추출"]').disabled)
            assert.deepEqual(await page.evaluate(() => ({ characters: window.testStore.getState().characters, presets: window.testStore.getState().presets })), first)
            await page.evaluate(() => window.testStore.persist.rehydrate())
            assert.deepEqual(await page.evaluate(() => ({ characters: window.testStore.getState().characters, presets: window.testStore.getState().presets })), first)
            await page.getByTitle('단부루 태그 설정').click()
            await page.getByRole('tab', { name: '캐릭터 추출' }).click()
            await page.getByLabel('내장 태그 DB 최소 게시물 수').fill('99999999')
            await page.getByRole('button', { name: '저장', exact: true }).click()
            assert.equal(await page.evaluate(() => window.testState.settings.danbooru_character_extraction.minimum), 99999999)
            await extract.click()
            await page.waitForFunction(() => !document.querySelector('button[aria-label="캐릭터 추출"]').disabled)
            assert.deepEqual(await page.evaluate(() => ({ characters: window.testStore.getState().characters, presets: window.testStore.getState().presets })), first)
            console.log(`UI + real tag worker passed: ${first.characters.length - 2} disabled characters; existing character and preset IDs and contents preserved`)
            for (const language of ['ko', 'en', 'ja']) {
                await page.evaluate(async language => (await import('/src/i18n/index.ts')).default.changeLanguage(language), language)
                for (const width of [360, 720, 1280]) {
                    await page.setViewportSize({ width, height: 800 })
                    await page.locator('button[title]').filter({ has: page.locator('svg.lucide-settings2, svg.lucide-settings-2') }).click()
                    const dialog = page.getByRole('dialog')
                    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth))
                    await page.keyboard.press('Escape')
                }
            }
            console.log('Settings layout checked in 3 languages at 360/720/1280px')
            await page.evaluate(async () => {
                await (await import('/src/i18n/index.ts')).default.changeLanguage('ko')
                await window.showCharacterPanel()
            })
            assert.equal(await page.getByRole('button', { name: '캐릭터 프리셋 목록', exact: true }).count(), 0)
            assert.ok(await page.getByText('girl, hatsune miku (append)', { exact: true }).count())
            assert.deepEqual(await page.evaluate(() => window.testStore.getState().presets), before.presets)
            console.log('Extracted characters visible in existing character panel; legacy preset button hidden and preset data preserved')
        }
    } finally { await browser.close() }
}
