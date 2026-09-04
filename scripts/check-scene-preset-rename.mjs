import assert from 'node:assert/strict'
import { replaceSceneFolderPrefixes } from '../src/lib/scene-path.ts'

const mappings = [
    { oldFolder: 'C:\\Images\\NAIS_Scene\\Old', newFolder: 'C:\\Images\\NAIS_Scene\\New' },
    { oldFolder: 'D:\\Legacy\\Older', newFolder: 'D:\\Legacy\\New' },
]

assert.equal(
    replaceSceneFolderPrefixes('C:\\Images\\NAIS_Scene\\Old\\Scene 1\\image.png', mappings),
    'C:\\Images\\NAIS_Scene\\New\\Scene 1\\image.png',
)
assert.equal(
    replaceSceneFolderPrefixes('D:\\Legacy\\Older\\Scene 2', mappings),
    'D:\\Legacy\\New\\Scene 2',
)
assert.equal(
    replaceSceneFolderPrefixes('C:\\Images\\NAIS_Scene\\Oldest\\image.png', mappings),
    'C:\\Images\\NAIS_Scene\\Oldest\\image.png',
)

console.log('Scene preset rename path checks passed.')
