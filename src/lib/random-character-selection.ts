import type { CharacterGroup, CharacterPrompt } from '@/stores/character-prompt-store'
import { getCharacterGender, type CharacterGender } from '@/lib/character-gender'

export type SceneRandomCharacterMode = 'all' | 'characters' | 'folders'

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

export const getRandomCharacterStackKey = (character: CharacterPrompt) => {
    const { hash } = getVariantParts(character.name)
    return hash ? `${character.groupId || 'root'}:${hash}` : character.id
}

export const getRandomCharacterDisplayName = (character: CharacterPrompt, fallbackIndex = 0) => {
    const rawName = character.name?.trim() || ''
    const variant = rawName.match(VARIANT_NAME_PATTERN)
    const legacy = rawName.match(LEGACY_VARIANT_HASH_PATTERN)
    const cleanName = variant
        ? rawName.slice(0, variant.index).trim()
        : legacy
            ? rawName.slice(0, legacy.index).replace(/\d+$/g, '').trim()
            : rawName
    return cleanName || character.prompt.split(',')[0]?.trim() || `Character ${fallbackIndex + 1}`
}

const collectGroupIds = (groups: CharacterGroup[], selectedGroupIds: string[]) => {
    const result = new Set(selectedGroupIds)
    let changed = true
    while (changed) {
        changed = false
        for (const group of groups) {
            if (group.parentId && result.has(group.parentId) && !result.has(group.id)) {
                result.add(group.id)
                changed = true
            }
        }
    }
    return result
}

export const getRandomCharacterCandidates = (
    characters: CharacterPrompt[],
    groups: CharacterGroup[],
    mode: SceneRandomCharacterMode,
    selectedCharacterIds: string[],
    selectedGroupIds: string[],
    gender: 'all' | CharacterGender = 'all',
) => {
    const stacks = new Map<string, CharacterPrompt[]>()
    for (const character of characters) {
        const key = getRandomCharacterStackKey(character)
        const stack = stacks.get(key)
        if (stack) stack.push(character)
        else stacks.set(key, [character])
    }

    const selectedStackKeys = mode === 'characters'
        ? new Set(characters
            .filter(character => selectedCharacterIds.includes(character.id))
            .map(getRandomCharacterStackKey))
        : null
    const selectedFolderIds = mode === 'folders'
        ? collectGroupIds(groups, selectedGroupIds)
        : null

    const candidates: CharacterPrompt[] = []
    for (const [stackKey, unsortedStack] of stacks) {
        if (selectedStackKeys && !selectedStackKeys.has(stackKey)) continue
        if (selectedFolderIds && !unsortedStack.some(character => character.groupId && selectedFolderIds.has(character.groupId))) continue

        const stack = unsortedStack.length > 1
            ? [...unsortedStack].sort((a, b) => getVariantParts(a.name).index - getVariantParts(b.name).index)
            : unsortedStack
        const hasPrompt = (character: CharacterPrompt) =>
            Boolean(character.prompt?.trim() || character.negative?.trim())
        const fallback = stack.find(hasPrompt)

        // Keep a stack available when its active page is blank but another version has prompt data.
        if (!fallback) continue
        const candidate = stack.find(character => character.enabled && hasPrompt(character)) || fallback
        if (gender !== 'all' && getCharacterGender(candidate.prompt) !== gender) continue
        candidates.push(candidate)
    }
    return candidates
}

export const pickRandomCharacters = (candidates: CharacterPrompt[], requestedCount: number) => {
    const count = Math.min(Math.max(1, Math.floor(requestedCount)), candidates.length)
    const pool = [...candidates]
    for (let index = 0; index < count; index++) {
        const randomIndex = index + Math.floor(Math.random() * (pool.length - index))
        const selected = pool[randomIndex]
        pool[randomIndex] = pool[index]
        pool[index] = selected
    }
    return pool.slice(0, count)
}
