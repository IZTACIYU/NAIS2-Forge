import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export interface CharacterPrompt {
    id: string
    name?: string         // Character name (optional)
    prompt: string        // Character-specific tags
    negative: string      // Character-specific negative tags
    enabled: boolean
    promptEnabled?: boolean
    negativeEnabled?: boolean
    costumeEnabled?: boolean
    position: { x: number, y: number }  // 0-1 coordinates (0,0 = top-left, 1,1 = bottom-right)
}

interface CharacterPromptState {
    characters: CharacterPrompt[]
    addCharacter: (initialData?: Partial<CharacterPrompt>) => void
    updateCharacter: (id: string, data: Partial<CharacterPrompt>) => void
    removeCharacter: (id: string) => void
    setPosition: (id: string, x: number, y: number) => void
    toggleEnabled: (id: string) => void
    disableAll: () => void
    clearAll: () => void
}

// Color palette for character markers.
export const CHARACTER_COLORS = [
    '#22c55e', // Green
    '#ef4444', // Red
    '#3b82f6', // Blue
    '#f59e0b', // Amber
    '#a855f7', // Purple
    '#06b6d4', // Cyan
    '#f43f5e', // Rose
    '#84cc16', // Lime
    '#f97316', // Orange
    '#14b8a6', // Teal
    '#8b5cf6', // Violet
    '#eab308', // Yellow
]

// Folder color palette
export const FOLDER_COLORS = [
    { name: 'amber', swatch: '#f59e0b', icon: 'text-amber-500', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
    { name: 'blue', swatch: '#3b82f6', icon: 'text-blue-500', border: 'border-blue-500/40', bg: 'bg-blue-500/10' },
    { name: 'green', swatch: '#22c55e', icon: 'text-green-500', border: 'border-green-500/40', bg: 'bg-green-500/10' },
    { name: 'purple', swatch: '#a855f7', icon: 'text-purple-500', border: 'border-purple-500/40', bg: 'bg-purple-500/10' },
    { name: 'pink', swatch: '#ec4899', icon: 'text-pink-500', border: 'border-pink-500/40', bg: 'bg-pink-500/10' },
    { name: 'cyan', swatch: '#06b6d4', icon: 'text-cyan-500', border: 'border-cyan-500/40', bg: 'bg-cyan-500/10' },
    { name: 'red', swatch: '#ef4444', icon: 'text-red-500', border: 'border-red-500/40', bg: 'bg-red-500/10' },
    { name: 'orange', swatch: '#f97316', icon: 'text-orange-500', border: 'border-orange-500/40', bg: 'bg-orange-500/10' },
    { name: 'indigo', swatch: '#6366f1', icon: 'text-indigo-500', border: 'border-indigo-500/40', bg: 'bg-indigo-500/10' },
    { name: 'teal', swatch: '#14b8a6', icon: 'text-teal-500', border: 'border-teal-500/40', bg: 'bg-teal-500/10' },
    { name: 'lime', swatch: '#84cc16', icon: 'text-lime-500', border: 'border-lime-500/40', bg: 'bg-lime-500/10' },
]

export interface CharacterPreset {
    id: string
    name: string
    prompt: string
    negative: string
    image?: string // Base64 or URL
    groupId?: string // Group/folder ID
}

export interface CharacterGroup {
    id: string
    name: string
    collapsed: boolean // 폴더 접기 상태
    colorIndex: number // 폴더 색상 인덱스 (FOLDER_COLORS)
    parentId?: string // 상위 폴더 ID (없으면 최상위)
}

export function getCharacterGroupDescendantIds(groups: CharacterGroup[], groupId: string): Set<string> {
    const result = new Set<string>()
    const pending = [groupId]
    while (pending.length > 0) {
        const currentId = pending.pop()!
        if (result.has(currentId)) continue
        result.add(currentId)
        for (const group of groups) {
            if (group.parentId === currentId) pending.push(group.id)
        }
    }
    return result
}

export function getCharacterGroupPath(groups: CharacterGroup[], groupId: string): string {
    const groupById = new Map(groups.map(group => [group.id, group]))
    const path: string[] = []
    const visited = new Set<string>()
    let current = groupById.get(groupId)
    while (current && !visited.has(current.id)) {
        visited.add(current.id)
        path.unshift(current.name)
        current = current.parentId ? groupById.get(current.parentId) : undefined
    }
    return path.join(' / ')
}

export interface CharacterPrompt {
    id: string
    name?: string         // Character name (optional)
    presetId?: string // Link to origin preset
    groupId?: string  // Folder groupId for stage organization
    prompt: string        // Character-specific tags
    negative: string      // Character-specific negative tags
    enabled: boolean
    promptEnabled?: boolean
    negativeEnabled?: boolean
    costumeEnabled?: boolean
    position: { x: number, y: number }  // 0-1 coordinates (0,0 = top-left, 1,1 = bottom-right)
}

interface CharacterPromptState {
    characters: CharacterPrompt[]
    presets: CharacterPreset[]
    groups: CharacterGroup[]
    positionEnabled: boolean // 위치 기능 활성화 여부
    activeCharacterLimit: number

    // Active Characters (Stage)
    addCharacter: (initialData?: Partial<CharacterPrompt>) => void
    updateCharacter: (id: string, data: Partial<CharacterPrompt>) => void
    removeCharacter: (id: string) => void
    setPosition: (id: string, x: number, y: number) => void
    toggleEnabled: (id: string) => void
    setActiveCharacterLimit: (limit: number) => void
    disableAll: () => void
    clearAll: () => void
    setPositionEnabled: (enabled: boolean) => void
    reorderCharacters: (oldIndex: number, newIndex: number) => void
    reorderCharactersInGroup: (activeId: string, overId: string, groupId: string | undefined) => void

    // Presets (Library)
    addPreset: (data: Partial<CharacterPreset> & Omit<CharacterPreset, 'id'>) => void
    updatePreset: (id: string, data: Partial<CharacterPreset>) => void
    deletePreset: (id: string) => void
    importFromStart: (presetId: string) => void // Add preset to stage

    // Groups (Folders)
    addGroup: (name: string, parentId?: string) => string
    updateGroup: (id: string, data: Partial<CharacterGroup>) => void
    deleteGroup: (id: string) => void
    moveGroup: (id: string, parentId?: string) => void
    reorderGroups: (activeId: string, overId: string) => void
    toggleGroupCollapsed: (id: string) => void
    toggleGroupEnabled: (groupId: string) => void // 그룹 내 모든 캐릭터 활성화/비활성화
    moveCharacterToGroup: (characterId: string, groupId: string | undefined) => void
    saveCharacterAsPreset: (characterId: string) => void
}

let characterPromptHydrated = false
let pendingActiveCharacterLimit: number | null = null

export const useCharacterPromptStore = create<CharacterPromptState>()(
    persist(
        (set, get) => ({
            characters: [],
            presets: [],
            groups: [],
            positionEnabled: false, // 기본값: 비활성화
            activeCharacterLimit: 6,

            addCharacter: (initialData?: Partial<CharacterPrompt>) => {
                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                set(state => {
                    const requestedEnabled = initialData?.enabled ?? true
                    const enabledCount = state.characters.filter(character => character.enabled).length
                    return {
                        characters: [
                            ...state.characters,
                            {
                                id: newId,
                                prompt: '',
                                negative: '',
                                promptEnabled: true,
                                negativeEnabled: true,
                                costumeEnabled: true,
                                position: { x: 0.5, y: 0.5 }, // Center by default
                                ...initialData,
                                enabled: requestedEnabled && enabledCount < state.activeCharacterLimit,
                            }
                        ]
                    }
                })
            },

            updateCharacter: (id, data) => {
                set(state => {
                    const target = state.characters.find(character => character.id === id)
                    if (!target) return state
                    const reachedLimit = data.enabled === true
                        && !target.enabled
                        && state.characters.filter(character => character.enabled).length >= state.activeCharacterLimit
                    const updates = reachedLimit ? { ...data, enabled: false } : data
                    return {
                        characters: state.characters.map(char =>
                            char.id === id ? { ...char, ...updates } : char
                        )
                    }
                })
            },

            removeCharacter: (id) => {
                set(state => ({
                    characters: state.characters.filter(char => char.id !== id)
                }))
            },

            setPosition: (id, x, y) => {
                // Clamp values to 0-1 range
                const clampedX = Math.max(0, Math.min(1, x))
                const clampedY = Math.max(0, Math.min(1, y))
                set(state => ({
                    characters: state.characters.map(char =>
                        char.id === id ? { ...char, position: { x: clampedX, y: clampedY } } : char
                    )
                }))
            },

            toggleEnabled: (id) => {
                set(state => {
                    const target = state.characters.find(character => character.id === id)
                    if (!target) return state
                    if (!target.enabled && state.characters.filter(character => character.enabled).length >= state.activeCharacterLimit) {
                        return state
                    }
                    return {
                        characters: state.characters.map(char =>
                            char.id === id ? { ...char, enabled: !char.enabled } : char
                        )
                    }
                })
            },

            setActiveCharacterLimit: (limit) => {
                const activeCharacterLimit = Math.max(1, Math.floor(limit))
                if (!characterPromptHydrated) {
                    pendingActiveCharacterLimit = activeCharacterLimit
                    return
                }
                set(state => {
                    let enabledCount = 0
                    let changed = state.activeCharacterLimit !== activeCharacterLimit
                    const characters = state.characters.map(character => {
                        if (!character.enabled) return character
                        enabledCount += 1
                        if (enabledCount <= activeCharacterLimit) return character
                        changed = true
                        return { ...character, enabled: false }
                    })
                    return changed ? { activeCharacterLimit, characters } : state
                })
            },

            disableAll: () => {
                set(state => {
                    if (!state.characters.some(char => char.enabled)) return state
                    return {
                        characters: state.characters.map(char =>
                            char.enabled ? { ...char, enabled: false } : char
                        )
                    }
                })
            },

            clearAll: () => set({ characters: [] }),

            setPositionEnabled: (enabled) => set({ positionEnabled: enabled }),

            reorderCharacters: (oldIndex, newIndex) => {
                set(state => {
                    const newCharacters = [...state.characters]
                    const [removed] = newCharacters.splice(oldIndex, 1)
                    newCharacters.splice(newIndex, 0, removed)
                    return { characters: newCharacters }
                })
            },

            reorderCharactersInGroup: (activeId, overId, groupId) => {
                set(state => {
                    const isInTargetGroup = (character: CharacterPrompt) => groupId
                        ? character.groupId === groupId
                        : (!character.groupId || !state.groups.some(group => group.id === character.groupId))
                    const groupChars = state.characters.filter(isInTargetGroup)
                    const getStackKey = (character: CharacterPrompt) => {
                        const match = character.name?.match(/\s-\s([a-z0-9]{6})\s-\s\d+$/i)
                        return match ? `${character.groupId || 'root'}:${match[1]}` : character.id
                    }

                    const activeCharacter = groupChars.find(character => character.id === activeId)
                    const overCharacter = groupChars.find(character => character.id === overId)
                    if (!activeCharacter || !overCharacter) return state

                    const blocks = new Map<string, CharacterPrompt[]>()
                    for (const character of groupChars) {
                        const key = getStackKey(character)
                        const block = blocks.get(key)
                        if (block) block.push(character)
                        else blocks.set(key, [character])
                    }

                    const orderedBlocks = Array.from(blocks.entries())
                    const activeIndex = orderedBlocks.findIndex(([key]) => key === getStackKey(activeCharacter))
                    const overIndex = orderedBlocks.findIndex(([key]) => key === getStackKey(overCharacter))
                    if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) return state

                    const [activeBlock] = orderedBlocks.splice(activeIndex, 1)
                    orderedBlocks.splice(overIndex, 0, activeBlock)
                    const reorderedGroupChars = orderedBlocks.flatMap(([, characters]) => characters)

                    const sortedCharacters: CharacterPrompt[] = []
                    let insertedTargetGroup = false
                    for (const character of state.characters) {
                        if (isInTargetGroup(character)) {
                            if (!insertedTargetGroup) {
                                sortedCharacters.push(...reorderedGroupChars)
                                insertedTargetGroup = true
                            }
                            continue
                        }
                        sortedCharacters.push(character)
                    }

                    return { characters: sortedCharacters }
                })
            },

            // Preset Actions
            addPreset: (data) => {
                const newId = data.id || (Date.now().toString() + Math.random().toString(36).substr(2, 9))
                set(state => ({
                    presets: [...state.presets, { ...data, id: newId } as CharacterPreset]
                }))
            },

            updatePreset: (id, data) => {
                set(state => ({
                    presets: state.presets.map(p =>
                        p.id === id ? { ...p, ...data } : p
                    )
                }))
            },

            deletePreset: (id) => {
                set(state => ({
                    presets: state.presets.filter(p => p.id !== id)
                }))
            },

            importFromStart: (presetId) => {
                set(state => {
                    const preset = state.presets.find(p => p.id === presetId)
                    if (!preset) return state

                    // Check if already exists? Maybe allow duplicates for twins etc.
                    // For now, allow duplicates.

                    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                    const enabledCount = state.characters.filter(character => character.enabled).length
                    return {
                        characters: [
                            ...state.characters,
                            {
                                id: newId,
                                presetId: preset.id,
                                prompt: preset.prompt,
                                negative: preset.negative,
                                enabled: enabledCount < state.activeCharacterLimit,
                                promptEnabled: true,
                                negativeEnabled: true,
                                costumeEnabled: true,
                                position: { x: 0.5, y: 0.5 }
                            }
                        ]
                    }
                })
            },

            // Group Actions
            addGroup: (name, parentId) => {
                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                set(state => ({
                    groups: [...state.groups, { id: newId, name, collapsed: false, colorIndex: 0, parentId }]
                }))
                return newId
            },

            updateGroup: (id, data) => {
                set(state => ({
                    groups: state.groups.map(g =>
                        g.id === id ? { ...g, ...data } : g
                    )
                }))
            },

            deleteGroup: (id) => {
                set(state => {
                    const parentId = state.groups.find(group => group.id === id)?.parentId
                    return {
                    // Preserve contents by promoting them to the deleted folder's parent.
                    characters: state.characters.map(c =>
                        c.groupId === id
                            ? { ...c, groupId: parentId }
                            : c
                    ),
                    presets: state.presets.map(p =>
                        p.groupId === id
                            ? { ...p, groupId: parentId }
                            : p
                    ),
                    groups: state.groups
                        .filter(g => g.id !== id)
                        .map(g => g.parentId === id
                            ? { ...g, parentId }
                            : g
                        ),
                    }
                })
            },

            moveGroup: (id, parentId) => {
                set(state => {
                    const group = state.groups.find(candidate => candidate.id === id)
                    if (!group || group.parentId === parentId) return state
                    if (parentId && !state.groups.some(candidate => candidate.id === parentId)) return state
                    if (parentId && getCharacterGroupDescendantIds(state.groups, id).has(parentId)) return state
                    return {
                        groups: state.groups.map(candidate =>
                            candidate.id === id ? { ...candidate, parentId } : candidate
                        )
                    }
                })
            },

            reorderGroups: (activeId, overId) => {
                set(state => {
                    const activeGroup = state.groups.find(group => group.id === activeId)
                    const overGroup = state.groups.find(group => group.id === overId)
                    if (!activeGroup || !overGroup || activeGroup.parentId !== overGroup.parentId) return state

                    const siblings = state.groups.filter(group => group.parentId === activeGroup.parentId)
                    const oldIndex = siblings.findIndex(group => group.id === activeId)
                    const newIndex = siblings.findIndex(group => group.id === overId)
                    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return state

                    const reordered = [...siblings]
                    const [moved] = reordered.splice(oldIndex, 1)
                    reordered.splice(newIndex, 0, moved)
                    let siblingIndex = 0
                    return {
                        groups: state.groups.map(group => group.parentId === activeGroup.parentId
                            ? reordered[siblingIndex++]
                            : group
                        )
                    }
                })
            },

            toggleGroupCollapsed: (id) => {
                set(state => ({
                    groups: state.groups.map(g =>
                        g.id === id ? { ...g, collapsed: !g.collapsed } : g
                    )
                }))
            },

            toggleGroupEnabled: (groupId) => {
                // 그룹 내 캐릭터들의 enabled 토글
                const { characters } = get()
                
                // 그룹 내 캐릭터들 중 하나라도 활성화되어 있으면 전부 비활성화, 아니면 전부 활성화
                const groupIds = getCharacterGroupDescendantIds(get().groups, groupId)
                const groupCharacters = characters.filter(c => c.groupId && groupIds.has(c.groupId))
                const allEnabled = groupCharacters.length > 0 && groupCharacters.every(c => c.enabled)
                const enabledOutsideGroup = characters.filter(character =>
                    character.enabled && !(character.groupId && groupIds.has(character.groupId))
                ).length
                let remainingSlots = Math.max(0, get().activeCharacterLimit - enabledOutsideGroup)

                set(state => ({
                    characters: state.characters.map(c =>
                        c.groupId && groupIds.has(c.groupId)
                            ? { ...c, enabled: allEnabled ? false : remainingSlots-- > 0 }
                            : c
                    )
                }))
            },

            moveCharacterToGroup: (characterId, groupId) => {
                set(state => {
                    const target = state.characters.find(character => character.id === characterId)
                    if (!target) return state

                    const stackHash = target.name?.match(/\s-\s([a-z0-9]{6})\s-\s\d+$/i)?.[1]
                    return {
                        characters: state.characters.map(character => {
                            const characterHash = character.name?.match(/\s-\s([a-z0-9]{6})\s-\s\d+$/i)?.[1]
                            const belongsToStack = Boolean(stackHash && characterHash === stackHash)
                            return character.id === characterId || belongsToStack
                                ? { ...character, groupId }
                                : character
                        })
                    }
                })
            },

            saveCharacterAsPreset: (characterId) => {
                const { characters } = get()
                const char = characters.find(c => c.id === characterId)
                if (!char) return

                const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
                const presetName = char.name || char.prompt.split(',')[0]?.trim() || 'Unnamed'

                set(state => ({
                    presets: [...state.presets, {
                        id: newId,
                        name: presetName,
                        prompt: char.prompt,
                        negative: char.negative,
                    }]
                }))
            }
        }),
        {
            name: 'nais2-forge-character-prompts',
            storage: createJSONStorage(() => indexedDBStorage),
            version: 1,
            // 데이터 보호: hydration 후 검증
            onRehydrateStorage: () => {
                characterPromptHydrated = false
                return (state, error) => {
                    if (error) {
                        console.error('[CharacterPromptStore] Hydration failed:', error)
                        return
                    }

                    characterPromptHydrated = true

                    if (state) {
                        const presetCount = state.presets?.length || 0
                        const charCount = state.characters?.length || 0
                        const groupCount = state.groups?.length || 0
                        console.log(`[CharacterPromptStore] Hydrated: ${presetCount} presets, ${charCount} characters, ${groupCount} groups`)

                        if (presetCount === 0 && charCount === 0) {
                            console.warn('[CharacterPromptStore] Warning: No data after hydration - possible data loss')
                        }
                    }

                    const pendingLimit = pendingActiveCharacterLimit
                    pendingActiveCharacterLimit = null
                    if (pendingLimit !== null) {
                        queueMicrotask(() => {
                            useCharacterPromptStore.getState().setActiveCharacterLimit(pendingLimit)
                        })
                    }
                }
            },
            // 저장할 필드 명시
            partialize: (state) => ({
                characters: state.characters,
                presets: state.presets,
                groups: state.groups,
                positionEnabled: state.positionEnabled,
            }),
        }
    )
)
