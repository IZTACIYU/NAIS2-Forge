import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import i18next from 'i18next'

const source = readFileSync(new URL('../src/pages/CloudR2.tsx', import.meta.url), 'utf8')
assert.match(source, /total: folders\.length \+ files\.length/)
assert.match(source, /folders: folders\.length/)
assert.match(source, /files: files\.length/)
assert.doesNotMatch(source, /files: visibleFiles\.length/)
assert.match(source, /loading \? t\('common\.loading'\) : t\('cloudR2\.itemCounts'/)

for (const language of ['ko', 'en', 'ja']) {
    const translations = JSON.parse(readFileSync(new URL(`../src/i18n/locales/${language}.json`, import.meta.url), 'utf8'))
    assert.ok(translations.cloudR2.itemCountsHelp)
    const instance = i18next.createInstance()
    await instance.init({ lng: language, resources: { [language]: { translation: translations } } })
    for (const [folders, files] of [[0, 0], [3, 22], [0, 1000]]) {
        const total = folders + files
        const label = instance.t('cloudR2.itemCounts', { total, folders, files })
        assert.doesNotMatch(label, /\{\{|cloudR2\.itemCounts/)
        assert.deepEqual(label.match(/\d+/g), [total, folders, files].map(String))
    }
}
console.log('R2 listing counts and translations passed (no network requests).')
