import assert from 'node:assert/strict'
import path from 'node:path'
import { createServer } from 'vite'

const server = await createServer({
    configFile: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    resolve: { alias: { '@': path.resolve('src') } },
})

try {
    const {
        getSceneMultiCharacterNegativePromptMap,
        getSceneMultiCharacterPromptMap,
    } = await server.ssrLoadModule('/src/lib/scene-character-prompts.ts')
    const female = { id: 'female', prompt: '1girl', negative: '', enabled: true }
    const male = { id: 'male', prompt: '1boy', negative: '', enabled: true }
    const characters = [female, male]
    const slots = [
        { id: 'gender', target: 'gender', gender: 'female', prompt: 'smile', negativePrompt: 'blurry' },
        { id: 'manual', target: 'manual', characterId: 'male', prompt: '', negativePrompt: 'beard' },
    ]

    const positive = getSceneMultiCharacterPromptMap(slots, characters, characters)
    const negative = getSceneMultiCharacterNegativePromptMap(slots, characters, characters)

    assert.deepEqual(positive.get('female'), ['smile'])
    assert.equal(positive.has('male'), false)
    assert.deepEqual(negative.get('female'), ['blurry'])
    assert.deepEqual(negative.get('male'), ['beard'])
} finally {
    await server.close()
}
