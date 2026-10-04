import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { twMerge } = require('tailwind-merge')
const dialogBase = readFileSync('src/components/ui/dialog.tsx', 'utf8').match(/'(fixed left-\[50%\][^']+)'/)?.[1]
assert.ok(dialogBase, 'Use the existing dialog layout classes')
const resources = Object.fromEntries(['ko', 'en', 'ja'].map(language => [language,
    JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8')),
]))
let language = 'ko', hydrated = false, writes = 0, remoteStateIndex = 0
const qrPreview = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260"><rect width="260" height="260" fill="white"/></svg>').toString('base64')
const remoteStates = [true, '24', qrPreview, { qrExpiresAt: 1000, accessExpiresAt: 2000 }, null, null, '', true, true]
const previews = {}
const original = { savePath: 'keep', acknowledgedAnnouncementId: '1.12.0-export-defaults', otherSetting: { keep: true } }
const settings = { ...original, acknowledgeAnnouncement(id) { this.acknowledgedAnnouncementId = id } }
settings.acknowledgeAnnouncement = settings.acknowledgeAnnouncement.bind(settings)
const t = key => key.split('.').reduce((value, part) => value?.[part], resources[language]) ?? key
const useSettingsStore = selector => selector(settings)
useSettingsStore.persist = {
    hasHydrated: () => hydrated,
    onHydrate: () => () => {}, onFinishHydration: () => () => {},
}
const wrapper = name => ({ children, className, ...props }) => React.createElement('div', {
    className: name === 'DialogContent' ? twMerge(dialogBase, className) : className,
    'data-component': name, id: props.id, role: props.role,
}, children)
function loadComponent(path, dev = false, remote = false) {
    const exports = {}
    const source = readFileSync(path, 'utf8').replace('import.meta.env.DEV', String(dev))
        .replace(/import\.meta\.env\.VITE_REMOTE_[A-Z_]+/g, "''")
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
        fileName: path,
    }).outputText
    vm.runInNewContext(code, { exports, console, require(name) {
        if (name === 'react') return remote ? { ...React, useState: initial => React.useState(remoteStates[remoteStateIndex++] ?? initial) }
            : { ...React, useSyncExternalStore: (_subscribe, get) => get() }
        if (name === 'react-i18next') return { useTranslation: () => ({ t }) }
        if (name === '@/stores/settings-store') return { useSettingsStore }
        if (name === '@/lib/indexed-db') return { flushAllPendingWrites: async () => { writes++ } }
        if (name === '@/components/ui/dialog') return {
            Dialog: props => remote || props.open ? wrapper('Dialog')(props) : null,
            DialogContent: wrapper('DialogContent'), DialogTitle: wrapper('DialogTitle'),
            DialogDescription: wrapper('DialogDescription'), DialogFooter: wrapper('DialogFooter'),
        }
        if (name === '@/components/ui/button') return { Button: props => React.createElement('button', props, props.children) }
        if (name === '@/components/ui/input') return { Input: props => React.createElement('input', props) }
        if (name.startsWith('@/') || name.startsWith('@tauri-apps/')) return {}
        return require(name)
    } })
    return exports
}
function findButton(element) {
    if (typeof element?.props?.onClick === 'function') return element
    for (const child of React.Children.toArray(element?.props?.children)) {
        const button = findButton(child)
        if (button) return button
    }
}
const release = loadComponent('src/components/AnnouncementDialog.tsx').AnnouncementDialog
const development = loadComponent('src/components/AnnouncementDialog.tsx', true).AnnouncementDialog
assert.equal(renderToStaticMarkup(release()), '', 'Do not display before settings hydration')
hydrated = true
assert.ok(renderToStaticMarkup(release()).includes('PC'), 'A previous notice acknowledgement must not hide the new notice')
findButton(development()).props.onClick()
assert.equal(settings.acknowledgedAnnouncementId, '1.13.0-feature-summary-dev')
assert.equal(renderToStaticMarkup(development()), '')
assert.notEqual(renderToStaticMarkup(release()), '', 'Development acknowledgement must not hide release notice')
findButton(release()).props.onClick()
assert.equal(settings.acknowledgedAnnouncementId, '1.13.0-feature-summary')
assert.equal(renderToStaticMarkup(release()), '')
assert.equal(writes, 2)
assert.equal(settings.savePath, original.savePath)
assert.deepEqual(settings.otherSetting, original.otherSetting)

const remote = loadComponent('src/components/RemoteControl.tsx', false, true).RemoteControl
for (language of ['ko', 'en', 'ja']) {
    settings.acknowledgedAnnouncementId = original.acknowledgedAnnouncementId
    const announcement = renderToStaticMarkup(release())
    remoteStateIndex = 0
    const connection = renderToStaticMarkup(React.createElement(remote))
    previews[language] = { announcement, connection }
    assert.ok(connection.includes(resources[language].remote.experimentalWarning))
    assert.ok(connection.includes('role="note"'))
    assert.ok(connection.includes('overflow-y-auto'), 'Tall QR dialogs must remain scrollable')
    assert.ok(announcement.includes('PNG') && announcement.includes('JPEG') && announcement.includes('WebP'))
    assert.ok(announcement.includes('Appearance') && announcement.includes('Skins'))
    assert.equal(resources[language].announcement.body.split('•').length - 1, 4)
    assert.ok(!announcement.includes('remote.experimentalWarning') && !announcement.includes('announcement.body'))
    assert.ok(!connection.includes('remote.experimentalWarning'))
}
assert.equal(writes, 2, 'Rendering must not acknowledge a notice or change saved settings')
console.log('Announcement checks passed: hydration, old/new and development/release acknowledgements, explicit confirmation/flush, unrelated settings preservation, 4 update topics and experimental warning in 3 languages. No user storage/network access.')

// Optional browser layout check using the current production CSS and synthetic QR, without pairing.
if (process.argv[2]) {
    const { chromium } = require(process.argv[2])
    const cssFile = readdirSync('dist/assets').find(file => file.startsWith('index-') && file.endsWith('.css'))
    assert.ok(cssFile, 'Run npm run build before the layout check')
    const css = readFileSync(`dist/assets/${cssFile}`, 'utf8')
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
        const page = await browser.newPage()
        await page.route('**/*', route => route.abort())
        for (const [language, views] of Object.entries(previews)) {
            for (const width of [320, 768, 1440]) {
                await page.setViewportSize({ width, height: 640 })
                for (const [kind, markup] of Object.entries(views)) {
                    await page.setContent(`<html lang="${language}"><head><style>${css}</style></head><body>${markup}</body></html>`)
                    const fits = await page.evaluate(async () => {
                        await Promise.all([...document.images].map(image => image.decode()))
                        const dialog = document.querySelector('[data-component="DialogContent"]')
                        const bounds = dialog.getBoundingClientRect()
                        const note = document.querySelector('[role="note"]')?.getBoundingClientRect()
                        return bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1
                            && dialog.scrollWidth <= dialog.clientWidth + 1
                            && (!note || (note.left >= bounds.left && note.right <= bounds.right))
                    })
                    assert.ok(fits, `${language}/${kind}/${width}: dialog or warning overflows`)
                }
            }
        }
        console.log('Dialog layout checks passed: 3 languages × 3 widths × warning/notice, including QR preview. No relay connections.')
    } finally { await browser.close() }
}
