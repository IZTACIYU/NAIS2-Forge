import type { CharacterPrompt } from '@/stores/character-prompt-store'
import type { SceneMultiCharacterSlot } from '@/stores/scene-store'
import { getCharacterGender } from '@/lib/character-gender'

const VARIANT_NAME_PATTERN = /\s-\s([a-z0-9]{6})\s-\s(\d+)$/i
const LEGACY_VARIANT_HASH_PATTERN = /\s-\s([a-z0-9]{6})$/i

const getVariantParts = (name?: string) => {
    const rawName = name?.trim() || ''
    const match = rawName.match(VARIANT_NAME_PATTERN)
    if (match) return { hash: match[1], index: Number(match[2]) }
    const legacy = rawName.match(LEGACY_VARIANT_HASH_PATTERN)
    if (legacy) return { hash: legacy[1], index: 0 }
    return { hash: '', index: 0 }
}

export const getVariantStackKey = (character: CharacterPrompt) => {
    const { hash } = getVariantParts(character.name)
    return hash ? `${character.groupId || 'root'}:${hash}` : character.id
}

const buildVariantStacks = (characters: CharacterPrompt[]) => {
    const stacks = new Map<string, CharacterPrompt[]>()
    for (const character of characters) {
        const key = getVariantStackKey(character)
        const stack = stacks.get(key)
        if (stack) stack.push(character)
        else stacks.set(key, [character])
    }
    for (const stack of stacks.values()) {
        if (stack.length > 1) stack.sort((a, b) => getVariantParts(a.name).index - getVariantParts(b.name).index)
    }
    return stacks
}

export const selectSceneCharacters = (
    allCharacters: CharacterPrompt[],
    characterIds: string[],
    variantIndex?: number,
) => {
    const charactersById = new Map(allCharacters.map(character => [character.id, character]))
    const variantStacks = variantIndex === undefined ? null : buildVariantStacks(allCharacters)
    const selectedByStack = new Map<string, CharacterPrompt>()

    for (const id of characterIds) {
        const selected = charactersById.get(id)
        if (!selected) continue
        const stackKey = getVariantStackKey(selected)
        if (selectedByStack.has(stackKey)) continue
        const variants = variantStacks?.get(stackKey)
        selectedByStack.set(stackKey, variants
            ? variants[Math.min(variantIndex!, variants.length - 1)]
            : selected)
    }

    return Array.from(selectedByStack.values())
}

const splitCharacterCostumePrompt = (prompt: string) => {
    const normalized = prompt.replace(/\r\n/g, '\n')
    const marker = '#!-\uc758\uc0c1\ud504\ub86c'
    const index = normalized.indexOf(marker)
    if (index === -1) return { characterPrompt: prompt, costumePrompt: '' }
    return {
        characterPrompt: normalized.slice(0, index).replace(/\n+$/g, ''),
        costumePrompt: normalized.slice(index + marker.length).replace(/^\n+/g, ''),
    }
}

export const buildSceneCharacterPrompt = (character: CharacterPrompt, costumeOverride?: boolean) => {
    const { characterPrompt, costumePrompt } = splitCharacterCostumePrompt(character.prompt)
    const parts: string[] = []
    if (character.promptEnabled !== false && characterPrompt.trim()) parts.push(characterPrompt)
    const costumeEnabled = costumeOverride ?? (character.costumeEnabled !== false)
    if (costumeEnabled && costumePrompt.trim()) parts.push(costumePrompt)
    return parts.join('\n')
}

export const getSceneMultiCharacterPromptMap = (
    slots: SceneMultiCharacterSlot[] | undefined,
    selectedCharacters: CharacterPrompt[],
    allCharacters: CharacterPrompt[],
) => {
    const promptsByCharacterId = new Map<string, string[]>()
    const usedGenderCharacterIds = new Set<string>()
    const allCharacterById = new Map(allCharacters.map(character => [character.id, character]))

    const appendPrompt = (character: CharacterPrompt | undefined, prompt: string) => {
        if (!character || !prompt.trim()) return
        const prompts = promptsByCharacterId.get(character.id) || []
        prompts.push(prompt.trim())
        promptsByCharacterId.set(character.id, prompts)
    }

    for (const slot of slots || []) {
        if (!slot.prompt.trim()) continue

        if (slot.target === 'manual') {
            const sourceCharacter = slot.characterId ? allCharacterById.get(slot.characterId) : undefined
            const target = sourceCharacter
                ? selectedCharacters.find(character => getVariantStackKey(character) === getVariantStackKey(sourceCharacter))
                : undefined
            appendPrompt(target, slot.prompt)
            continue
        }

        const target = selectedCharacters.find(character => (
            !usedGenderCharacterIds.has(character.id)
            && getCharacterGender(character.prompt) === (slot.gender || 'unknown')
        ))
        if (target) usedGenderCharacterIds.add(target.id)
        appendPrompt(target, slot.prompt)
    }

    return promptsByCharacterId
}
