import { memo, useState, useEffect, useRef, useCallback, useMemo, MouseEvent as ReactMouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import {
    X,
    Plus,
    Trash2,
    Users,
    ChevronDown,
    ChevronUp,
    MapPin,
    Eye,
    EyeOff,
    Copy,
    User,
    SlidersHorizontal,
    Pencil,
    Search,
    Folder,
    FolderOpen,
    FolderPlus,
    ChevronRight,
    Save,
    Palette,
    Menu,
    CircleHelp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSub,
    ContextMenuSubTrigger,
    ContextMenuSubContent,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
    useCharacterPromptStore,
    CHARACTER_COLORS,
    CharacterPrompt,
    CharacterGroup,
    FOLDER_COLORS,
    getCharacterGroupDescendantIds,
    getCharacterGroupPath,
} from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
    CHARACTER_POSITION_GRID_SIZE,
    getCharacterPositionBoardAspectRatio,
    snapCharacterPosition,
} from '@/lib/character-position-grid'
import { toast } from '@/components/ui/use-toast'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    useDroppable,
} from '@dnd-kit/core'
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface CharacterPromptPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}


const COSTUME_MARKER = '\n#!-\uc758\uc0c1\ud504\ub86c\n'
const FOLDER_PANEL_WIDTH_STORAGE_KEY = 'nais2-forge-character-folder-panel-width'

const splitCostumePrompt = (prompt: string) => {
    const normalized = prompt.replace(/\r\n/g, '\n')
    const marker = '#!-\uc758\uc0c1\ud504\ub86c'
    const index = normalized.indexOf(marker)
    if (index === -1) return { characterPrompt: prompt, costumePrompt: '' }
    const characterPrompt = normalized.slice(0, index).replace(/\n+$/g, '')
    const costumePrompt = normalized.slice(index + marker.length).replace(/^\n+/g, '')
    return { characterPrompt, costumePrompt }
}

const joinCostumePrompt = (characterPrompt: string, costumePrompt: string) => {
    const cleanCharacter = characterPrompt.replace(/\s+$/g, '')
    const cleanCostume = costumePrompt.replace(/^\s+/g, '')
    if (!cleanCostume.trim()) return cleanCharacter
    return `${cleanCharacter}${COSTUME_MARKER}${cleanCostume}`
}

const VARIANT_NAME_PATTERN = /\s-\s([a-z0-9]{6})\s-\s(\d+)$/i
const LEGACY_VARIANT_HASH_PATTERN = /\s-\s([a-z0-9]{6})$/i

const getStoredVariantParts = (name?: string) => {
    const rawName = name?.trim() || ''
    const match = rawName.match(VARIANT_NAME_PATTERN)
    if (match) {
        return {
            displayName: rawName.slice(0, match.index).trim(),
            hash: match[1],
            index: Number(match[2]),
        }
    }
    const legacy = rawName.match(LEGACY_VARIANT_HASH_PATTERN)
    if (legacy) {
        const legacyBase = rawName.slice(0, legacy.index).trim()
        const indexMatch = legacyBase.match(/(\d+)$/)
        return {
            displayName: legacyBase.replace(/\d+$/g, '').trim() || legacyBase,
            hash: legacy[1],
            index: indexMatch ? Number(indexMatch[1]) : 0,
        }
    }
    return { displayName: rawName, hash: undefined as string | undefined, index: 0 }
}

const getVariantHash = (char: CharacterPrompt) => getStoredVariantParts(char.name).hash
const getVariantBaseName = (char: CharacterPrompt, fallback: string) => getStoredVariantParts(char.name).displayName || fallback
const getVariantIndex = (char: CharacterPrompt) => getStoredVariantParts(char.name).index
const getVariantName = (displayName: string, index: number, hash: string) => `${displayName.trim() || 'Character'} - ${hash} - ${index}`
const getStackKey = (char: CharacterPrompt) => {
    const hash = getVariantHash(char)
    return hash ? `${char.groupId || 'root'}:${hash}` : char.id
}
const makeVariantHash = (baseName: string, taken: Set<string>) => {
    let seed = `${baseName}:${Date.now()}:${Math.random()}`
    for (let attempt = 0; attempt < 10; attempt++) {
        let value = 0
        for (let i = 0; i < seed.length; i++) value = ((value << 5) - value + seed.charCodeAt(i)) | 0
        const hash = Math.abs(value).toString(36).slice(0, 6).padEnd(6, '0')
        if (!taken.has(hash)) return hash
        seed += `:${attempt}`
    }
    return Math.random().toString(36).slice(2, 8).padEnd(6, '0')
}

export function CharacterPromptPanel({ open, onOpenChange }: CharacterPromptPanelProps) {
    const { t } = useTranslation()
    const {
        characters,
        groups,
        addCharacter,
        updateCharacter,
        removeCharacter,
        setPosition,
        toggleEnabled,
        disableAll,
        positionEnabled,
        setPositionEnabled,
        addGroup,
        updateGroup,
        deleteGroup,
        moveGroup,
        reorderGroups,
        toggleGroupCollapsed,
        toggleGroupEnabled,
        moveCharacterToGroup,
        saveCharacterAsPreset,
        reorderCharactersInGroup,
    } = useCharacterPromptStore(useShallow(state => ({
        characters: state.characters,
        groups: state.groups,
        addCharacter: state.addCharacter,
        updateCharacter: state.updateCharacter,
        removeCharacter: state.removeCharacter,
        setPosition: state.setPosition,
        toggleEnabled: state.toggleEnabled,
        disableAll: state.disableAll,
        positionEnabled: state.positionEnabled,
        setPositionEnabled: state.setPositionEnabled,
        addGroup: state.addGroup,
        updateGroup: state.updateGroup,
        deleteGroup: state.deleteGroup,
        moveGroup: state.moveGroup,
        reorderGroups: state.reorderGroups,
        toggleGroupCollapsed: state.toggleGroupCollapsed,
        toggleGroupEnabled: state.toggleGroupEnabled,
        moveCharacterToGroup: state.moveCharacterToGroup,
        saveCharacterAsPreset: state.saveCharacterAsPreset,
        reorderCharactersInGroup: state.reorderCharactersInGroup,
    })))

    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [positionDialogOpen, setPositionDialogOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
    const [editingGroupName, setEditingGroupName] = useState('')
    const [activeId, setActiveId] = useState<string | null>(null)
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
    const [folderPanelOpen, setFolderPanelOpen] = useState(true)
    const [folderPanelWidth, setFolderPanelWidth] = useState(() => {
        const savedWidth = Number(window.localStorage.getItem(FOLDER_PANEL_WIDTH_STORAGE_KEY))
        return Number.isFinite(savedWidth) && savedWidth > 0
            ? Math.min(320, Math.max(120, savedWidth))
            : 150
    })
    const expertCharacterPromptFolderBrowserEnabled = useSettingsStore(state => state.expertCharacterPromptFolderBrowserEnabled)
    const expertCharacterPromptLayoutEnabled = useSettingsStore(state => state.expertCharacterPromptLayoutEnabled)
    const expertCharacterPromptVariantsEnabled = useSettingsStore(state => state.expertCharacterPromptVariantsEnabled)

    const startFolderPanelResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = folderPanelWidth
        const containerWidth = event.currentTarget.parentElement?.getBoundingClientRect().width || 500
        const maxWidth = Math.max(120, Math.min(320, containerWidth - 180))
        let nextWidth = startWidth
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect

        const handleMouseMove = (moveEvent: MouseEvent) => {
            nextWidth = Math.min(maxWidth, Math.max(120, startWidth + moveEvent.clientX - startX))
            setFolderPanelWidth(nextWidth)
        }
        const handleMouseUp = () => {
            window.localStorage.setItem(FOLDER_PANEL_WIDTH_STORAGE_KEY, String(Math.round(nextWidth)))
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousUserSelect
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            window.removeEventListener('blur', handleMouseUp)
        }

        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        window.addEventListener('blur', handleMouseUp)
    }, [folderPanelWidth])

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    )

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
        setExpandedId(null)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        setActiveId(null)
        
        if (!over) return
        
        const activeItemId = active.id as string
        const overId = over.id as string

        if (activeItemId.startsWith('folder-')) {
            if (overId.startsWith('folder-')) {
                reorderGroups(
                    activeItemId.replace('folder-', ''),
                    overId.replace('folder-', '')
                )
            }
            return
        }

        const activeCharId = activeItemId
        
        // 폴더에 드롭한 경우
        if (overId.startsWith('folder-')) {
            const folderId = overId.replace('folder-', '')
            moveCharacterToGroup(activeCharId, folderId)
            return
        }
        
        // 미분류 영역에 드롭한 경우
        if (overId === 'ungrouped-zone') {
            moveCharacterToGroup(activeCharId, undefined)
            return
        }
        
        // 캐릭터 위에 드롭한 경우
        const activeChar = characters.find(c => c.id === activeCharId)
        const overChar = characters.find(c => c.id === overId)
        
        if (activeChar && overChar) {
            // 다른 그룹의 캐릭터 위에 드롭한 경우: 해당 그룹으로 이동
            if (activeChar.groupId !== overChar.groupId) {
                moveCharacterToGroup(activeCharId, overChar.groupId)
                return
            }
            
            // 같은 그룹 내에서 순서 변경
            if (activeCharId !== overId) {
                reorderCharactersInGroup(activeCharId, overId, activeChar.groupId)
            }
        }
    }

    // Reopen with all existing cards collapsed.
    useEffect(() => {
        if (!open) setExpandedId(null)
    }, [open])

    const handleAddCharacter = () => {
        addCharacter(expertCharacterPromptFolderBrowserEnabled && selectedGroupId
            ? { groupId: selectedGroupId }
            : undefined
        )
        // 새 캐릭터 자동 확장
        setTimeout(() => {
            const newChar = useCharacterPromptStore.getState().characters.slice(-1)[0]
            if (newChar) {
                setExpandedId(newChar.id)
            }
        }, 0)
    }

    const handleDuplicate = useCallback((char: CharacterPrompt) => {
        addCharacter()
        setTimeout(() => {
            const newChar = useCharacterPromptStore.getState().characters.slice(-1)[0]
            if (newChar) {
                updateCharacter(newChar.id, {
                    prompt: char.prompt,
                    negative: char.negative,
                    groupId: char.groupId, // 같은 폴더에 복제
                })
                setExpandedId(newChar.id)
            }
        }, 0)
    }, [addCharacter, updateCharacter])

    const activateVariant = useCallback((id: string) => {
        const state = useCharacterPromptStore.getState()
        const selected = state.characters.find(c => c.id === id)
        if (!selected) return
        const stackKey = getStackKey(selected)
        let changed = false
        const nextCharacters = state.characters.map((char) => {
            if (getStackKey(char) !== stackKey) return char
            const enabled = char.id === id
            if (char.enabled === enabled) return char
            changed = true
            return { ...char, enabled }
        })
        if (changed) useCharacterPromptStore.setState({ characters: nextCharacters })
        setExpandedId(id)
    }, [])


    const handleAddVariant = useCallback((char: CharacterPrompt) => {
        const baseName = getVariantBaseName(char, char.name || char.prompt.split(',')[0]?.trim() || 'Character')
        const takenHashes = new Set(characters.map(c => getVariantHash(c)).filter(Boolean) as string[])
        const hash = getVariantHash(char) || makeVariantHash(baseName, takenHashes)
        const stackCharacters = characters
            .filter(c => c.id === char.id || getVariantHash(c) === hash)
            .sort((a, b) => getVariantIndex(a) - getVariantIndex(b))
        if (stackCharacters.length >= 5) return

        const selectedStackIndex = stackCharacters.findIndex(variant => variant.id === char.id)
        if (selectedStackIndex === -1) return

        const newVariantId = `${Date.now()}${Math.random().toString(36).slice(2, 11)}`
        const insertAfterIndex = selectedStackIndex + 1
        const reindexedNames = new Map(stackCharacters.map((variant, index) => [
            variant.id,
            getVariantName(
                getVariantBaseName(variant, baseName),
                index >= insertAfterIndex ? index + 1 : index,
                hash,
            ),
        ]))
        const newVariant: CharacterPrompt = {
            id: newVariantId,
            name: getVariantName(baseName, insertAfterIndex, hash),
            prompt: char.prompt,
            negative: char.negative,
            enabled: true,
            groupId: char.groupId,
            promptEnabled: char.promptEnabled ?? true,
            negativeEnabled: char.negativeEnabled ?? true,
            costumeEnabled: char.costumeEnabled ?? true,
            position: char.position,
        }

        useCharacterPromptStore.setState(state => {
            const updatedCharacters = state.characters.map(variant => {
                const name = reindexedNames.get(variant.id)
                return name ? { ...variant, name } : variant
            })
            const characterIndex = updatedCharacters.findIndex(variant => variant.id === char.id)
            return {
                characters: [
                    ...updatedCharacters.slice(0, characterIndex + 1),
                    newVariant,
                    ...updatedCharacters.slice(characterIndex + 1),
                ],
            }
        })
        activateVariant(newVariantId)
    }, [activateVariant, characters])

    const handleToggleExpand = useCallback((id: string) => {
        setExpandedId(prev => prev === id ? null : id)
    }, [])

    const handleFocusCharacter = useCallback((character: CharacterPrompt) => {
        setSearchQuery('')
        setSelectedGroupId(character.groupId && groups.some(group => group.id === character.groupId)
            ? character.groupId
            : null
        )
        if (character.groupId) {
            const expandedIds = new Set<string>()
            let current = groups.find(group => group.id === character.groupId)
            while (current) {
                expandedIds.add(current.id)
                current = current.parentId ? groups.find(group => group.id === current?.parentId) : undefined
            }
            useCharacterPromptStore.setState(state => ({
                groups: state.groups.map(group =>
                    expandedIds.has(group.id) && group.collapsed ? { ...group, collapsed: false } : group
                )
            }))
        }
        setExpandedId(character.id)

        requestAnimationFrame(() => requestAnimationFrame(() => {
            const card = Array.from(document.querySelectorAll<HTMLElement>('[data-character-prompt-id]'))
                .find(element => element.dataset.characterPromptId === character.id)
            card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }))
    }, [groups])

    const handleCreateGroup = (
        parentId: string | undefined = expertCharacterPromptFolderBrowserEnabled
            ? selectedGroupId || undefined
            : undefined
    ) => {
        const baseName = t('characterPanel.newFolderName', '새폴더')
        const existingNames = groups.map(g => g.name)
        
        // 새폴더, 새폴더(2), 새폴더(3) 형태로 이름 생성
        let newName = baseName
        let counter = 2
        while (existingNames.includes(newName)) {
            newName = `${baseName}(${counter})`
            counter++
        }
        
        const newGroupId = addGroup(newName, parentId)
        if (parentId) updateGroup(parentId, { collapsed: false })
        setSelectedGroupId(newGroupId)
        setEditingGroupId(newGroupId)
        setEditingGroupName(newName)
    }

    const handleSaveGroupName = (groupId: string) => {
        if (editingGroupName.trim()) {
            updateGroup(groupId, { name: editingGroupName.trim() })
        }
        setEditingGroupId(null)
        setEditingGroupName('')
    }

    const handleDeleteGroup = (groupId: string) => {
        const parentId = groups.find(group => group.id === groupId)?.parentId || null
        deleteGroup(groupId)
        if (selectedGroupId === groupId) setSelectedGroupId(parentId)
    }

    const handleSaveAsPreset = (char: CharacterPrompt) => {
        saveCharacterAsPreset(char.id)
        toast({
            title: t('characterPanel.savedAsPreset', '프리셋으로 저장됨'),
            description: char.name || char.prompt.split(',')[0]?.trim() || 'Character',
        })
    }

    const getVisibleStackCharacters = useCallback((list: CharacterPrompt[]) => {
        if (!expertCharacterPromptVariantsEnabled) return list
        const stacks = new Map<string, CharacterPrompt[]>()
        for (const char of list) {
            const key = getStackKey(char)
            const current = stacks.get(key) || []
            current.push(char)
            stacks.set(key, current)
        }
        return Array.from(stacks.values()).map((stack) => {
            const sorted = stack.sort((a, b) => getVariantIndex(a) - getVariantIndex(b))
            return sorted.find(c => c.enabled) || sorted[0]
        })
    }, [expertCharacterPromptVariantsEnabled])

    const normalizedSearch = searchQuery.trim().toLowerCase()
    const characterMatchesSearch = useCallback((character: CharacterPrompt) => {
        if (!normalizedSearch) return true
        const name = character.name?.toLowerCase() || ''
        const promptPreview = character.prompt?.split(',')[0]?.trim().toLowerCase() || ''
        return name.includes(normalizedSearch) || promptPreview.includes(normalizedSearch)
    }, [normalizedSearch])
    const groupById = useMemo(() => new Map(groups.map(group => [group.id, group])), [groups])
    const groupIds = useMemo(() => new Set(groupById.keys()), [groupById])
    const characterIndexById = useMemo(
        () => new Map(characters.map((character, index) => [character.id, index])),
        [characters]
    )
    const groupChildren = useMemo(() => {
        const children = new Map<string, CharacterGroup[]>()
        for (const group of groups) {
            const parentId = group.parentId && groupIds.has(group.parentId) ? group.parentId : 'root'
            const current = children.get(parentId) || []
            current.push(group)
            children.set(parentId, current)
        }
        return children
    }, [groupIds, groups])
    const selectedGroup = selectedGroupId ? groupById.get(selectedGroupId) : undefined

    useEffect(() => {
        if (selectedGroupId && !groupIds.has(selectedGroupId)) setSelectedGroupId(null)
    }, [groupIds, selectedGroupId])

    const visibleCharacters = useMemo(() => {
        const source = characters.filter(character => {
            if (normalizedSearch) return characterMatchesSearch(character)
            return selectedGroupId
                ? character.groupId === selectedGroupId
                : !character.groupId || !groupIds.has(character.groupId)
        })
        return getVisibleStackCharacters(source)
    }, [characterMatchesSearch, characters, getVisibleStackCharacters, groupIds, normalizedSearch, selectedGroupId])

    const legacyUngroupedCharacters = useMemo(() => getVisibleStackCharacters(
        characters.filter(character =>
            (!character.groupId || !groupIds.has(character.groupId)) && characterMatchesSearch(character)
        )
    ), [characterMatchesSearch, characters, getVisibleStackCharacters, groupIds])

    const groupCharacterCounts = useMemo(() => {
        const directCounts = new Map<string, number>()
        for (const character of getVisibleStackCharacters(characters)) {
            if (character.groupId && groupIds.has(character.groupId)) {
                directCounts.set(character.groupId, (directCounts.get(character.groupId) || 0) + 1)
            }
        }
        const totals = new Map<string, number>()
        const countGroup = (groupId: string, visited: Set<string>): number => {
            if (totals.has(groupId)) return totals.get(groupId)!
            if (visited.has(groupId)) return 0
            const nextVisited = new Set(visited).add(groupId)
            const total = (directCounts.get(groupId) || 0)
                + (groupChildren.get(groupId) || []).reduce(
                    (sum, child) => sum + countGroup(child.id, nextVisited),
                    0
                )
            totals.set(groupId, total)
            return total
        }
        for (const group of groups) countGroup(group.id, new Set())
        return totals
    }, [characters, getVisibleStackCharacters, groupChildren, groupIds, groups])

    const ungroupedCount = useMemo(() => getVisibleStackCharacters(
        characters.filter(character => !character.groupId || !groupIds.has(character.groupId))
    ).length, [characters, getVisibleStackCharacters, groupIds])
    const enabledCharacters = useMemo(
        () => characters.filter(character => character.enabled),
        [characters]
    )
    const enabledCharacterCount = enabledCharacters.length

    const renderCharacterCard = (char: CharacterPrompt) => {
        const index = characterIndexById.get(char.id) ?? 0
        return (
            <SortableCharacterCard
                key={char.id}
                character={char}
                index={index}
                isExpanded={expandedId === char.id}
                onToggleExpand={() => handleToggleExpand(char.id)}
                onUpdate={(data) => updateCharacter(char.id, data)}
                updateCharacterDirect={updateCharacter}
                onRemove={() => removeCharacter(char.id)}
                onToggleEnabled={() => toggleEnabled(char.id)}
                onDuplicate={() => handleDuplicate(char)}
                onSaveAsPreset={() => handleSaveAsPreset(char)}
                onMoveToGroup={moveCharacterToGroup}
                positionEnabled={positionEnabled}
                groups={groups}
                allCharacters={characters}
                expertCharacterPromptLayoutEnabled={expertCharacterPromptLayoutEnabled}
                onAddVariant={() => handleAddVariant(char)}
                expertCharacterPromptVariantsEnabled={expertCharacterPromptVariantsEnabled}
                onSelectVariant={activateVariant}
            />
        )
    }

    const renderFolderColorMenu = (group: CharacterGroup) => (
        <ContextMenuSub>
            <ContextMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                {t('characterPanel.changeFolderColor')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-auto min-w-0 p-2">
                <div className="flex items-center gap-1.5">
                    {FOLDER_COLORS.map((color, index) => (
                        <ContextMenuItem
                            key={color.name}
                            aria-label={color.name}
                            title={color.name}
                            className={cn(
                                "h-6 w-6 min-w-0 cursor-pointer rounded-full border-2 p-0 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-popover",
                                (group.colorIndex ?? 0) === index
                                    ? "border-foreground"
                                    : "border-transparent"
                            )}
                            style={{ backgroundColor: color.swatch }}
                            onSelect={() => updateGroup(group.id, { colorIndex: index })}
                        />
                    ))}
                </div>
            </ContextMenuSubContent>
        </ContextMenuSub>
    )

    const renderFolderTree = (group: CharacterGroup, depth = 0): React.ReactNode => {
        const folderColor = FOLDER_COLORS[group.colorIndex ?? 0]
        const children = groupChildren.get(group.id) || []
        const descendants = getCharacterGroupDescendantIds(groups, group.id)
        const moveTargets = groups.filter(target => !descendants.has(target.id))

        return (
            <div key={group.id}>
                <DroppableFolder
                    folderId={group.id}
                    isActive={activeId !== null}
                    isCollapsed={group.collapsed}
                    colorClass={folderColor.bg}
                >
                <ContextMenu>
                    <ContextMenuTrigger asChild>
                        <div
                            className={cn(
                                "group/folder flex h-8 cursor-pointer items-center gap-1 rounded-md pr-1 text-xs transition-colors",
                                selectedGroupId === group.id
                                    ? "bg-primary/15 text-foreground"
                                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                            )}
                            style={{ paddingLeft: `${4 + depth * 12}px` }}
                            onClick={() => setSelectedGroupId(group.id)}
                        >
                            <button
                                type="button"
                                className="flex h-6 w-5 shrink-0 items-center justify-center"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    if (children.length > 0) toggleGroupCollapsed(group.id)
                                }}
                            >
                                {children.length > 0 && (group.collapsed
                                    ? <ChevronRight className="h-3.5 w-3.5" />
                                    : <ChevronDown className="h-3.5 w-3.5" />
                                )}
                            </button>
                            {group.collapsed
                                ? <Folder className={cn("h-4 w-4 shrink-0", folderColor.icon)} />
                                : <FolderOpen className={cn("h-4 w-4 shrink-0", folderColor.icon)} />
                            }
                            {editingGroupId === group.id ? (
                                <Input
                                    autoFocus
                                    value={editingGroupName}
                                    onChange={(event) => setEditingGroupName(event.target.value)}
                                    onBlur={() => handleSaveGroupName(group.id)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') handleSaveGroupName(group.id)
                                        if (event.key === 'Escape') {
                                            setEditingGroupId(null)
                                            setEditingGroupName('')
                                        }
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                    className="h-6 min-w-0 flex-1 px-1 text-xs"
                                />
                            ) : (
                                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                            )}
                            <span className="shrink-0 text-[10px] opacity-50">
                                {groupCharacterCounts.get(group.id) || 0}
                            </span>
                        </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                        <ContextMenuItem onClick={() => {
                            setEditingGroupId(group.id)
                            setEditingGroupName(group.name)
                        }}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {t('characterPanel.rename', '이름 변경')}
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => toggleGroupEnabled(group.id)}>
                            <Eye className="mr-2 h-4 w-4" />
                            {t('characterPanel.toggleAll', '폴더 내 전체 활성화/비활성화')}
                        </ContextMenuItem>
                        {renderFolderColorMenu(group)}
                        <ContextMenuItem onClick={() => handleCreateGroup(group.id)}>
                            <FolderPlus className="mr-2 h-4 w-4" />
                            {t('characterPanel.addSubfolder', '하위 폴더 추가')}
                        </ContextMenuItem>
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>
                                <Folder className="mr-2 h-4 w-4" />
                                {t('characterPanel.moveFolder', '폴더 이동')}
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                                <ContextMenuItem
                                    disabled={!group.parentId}
                                    onClick={() => moveGroup(group.id, undefined)}
                                >
                                    {t('characterPanel.moveToRoot', '최상위로 이동')}
                                </ContextMenuItem>
                                {moveTargets.map(target => (
                                    <ContextMenuItem
                                        key={target.id}
                                        disabled={group.parentId === target.id}
                                        onClick={() => moveGroup(group.id, target.id)}
                                    >
                                        <span className="max-w-48 truncate">{getCharacterGroupPath(groups, target.id)}</span>
                                    </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => handleDeleteGroup(group.id)}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('common.delete', '삭제')}
                        </ContextMenuItem>
                    </ContextMenuContent>
                </ContextMenu>
                </DroppableFolder>
                {!group.collapsed && children.length > 0 && (
                    <SortableContext
                        items={children.map(child => `folder-${child.id}`)}
                        strategy={verticalListSortingStrategy}
                    >
                        {children.map(child => renderFolderTree(child, depth + 1))}
                    </SortableContext>
                )}
            </div>
        )
    }

    const renderLegacyFolder = (group: CharacterGroup, depth = 0): React.ReactNode => {
        const folderColor = FOLDER_COLORS[group.colorIndex ?? 0]
        const children = groupChildren.get(group.id) || []
        const folderCharacters = getVisibleStackCharacters(
            characters.filter(character => character.groupId === group.id && characterMatchesSearch(character))
        )
        const descendants = getCharacterGroupDescendantIds(groups, group.id)
        const moveTargets = groups.filter(target => !descendants.has(target.id))

        return (
            <div key={group.id} className={depth > 0 ? "ml-3" : undefined}>
                <DroppableFolder
                    folderId={group.id}
                    isActive={activeId !== null}
                    isCollapsed={group.collapsed}
                    colorClass={folderColor.bg}
                >
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="group/folder flex cursor-pointer items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
                                <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                                    onClick={() => toggleGroupCollapsed(group.id)}
                                >
                                    {group.collapsed
                                        ? <ChevronRight className="h-4 w-4 shrink-0" />
                                        : <ChevronDown className="h-4 w-4 shrink-0" />
                                    }
                                    {group.collapsed
                                        ? <Folder className={cn("h-5 w-5 shrink-0", folderColor.icon)} />
                                        : <FolderOpen className={cn("h-5 w-5 shrink-0", folderColor.icon)} />
                                    }
                                    {editingGroupId === group.id ? (
                                        <Input
                                            autoFocus
                                            value={editingGroupName}
                                            onChange={(event) => setEditingGroupName(event.target.value)}
                                            onBlur={() => handleSaveGroupName(group.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') handleSaveGroupName(group.id)
                                                if (event.key === 'Escape') {
                                                    setEditingGroupId(null)
                                                    setEditingGroupName('')
                                                }
                                            }}
                                            onClick={(event) => event.stopPropagation()}
                                            className="h-6 min-w-0 flex-1 px-1.5 py-0 text-sm"
                                        />
                                    ) : (
                                        <span className="min-w-0 flex-1 truncate">{group.name}</span>
                                    )}
                                    <span className="shrink-0 text-xs opacity-50">({folderCharacters.length})</span>
                                </button>
                                <div className="flex gap-1 opacity-0 transition-opacity group-hover/folder:opacity-100">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        onClick={() => handleCreateGroup(group.id)}
                                    >
                                        <FolderPlus className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        onClick={() => toggleGroupEnabled(group.id)}
                                    >
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        onClick={() => {
                                            setEditingGroupId(group.id)
                                            setEditingGroupName(group.name)
                                        }}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => handleDeleteGroup(group.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-56">
                            <ContextMenuItem onClick={() => {
                                setEditingGroupId(group.id)
                                setEditingGroupName(group.name)
                            }}>
                                <Pencil className="mr-2 h-4 w-4" />
                                {t('characterPanel.rename', '이름 변경')}
                            </ContextMenuItem>
                            {renderFolderColorMenu(group)}
                            <ContextMenuItem onClick={() => handleCreateGroup(group.id)}>
                                <FolderPlus className="mr-2 h-4 w-4" />
                                {t('characterPanel.addSubfolder', '하위 폴더 추가')}
                            </ContextMenuItem>
                            <ContextMenuSub>
                                <ContextMenuSubTrigger>
                                    <Folder className="mr-2 h-4 w-4" />
                                    {t('characterPanel.moveFolder', '폴더 이동')}
                                </ContextMenuSubTrigger>
                                <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                                    <ContextMenuItem
                                        disabled={!group.parentId}
                                        onClick={() => moveGroup(group.id, undefined)}
                                    >
                                        {t('characterPanel.moveToRoot', '최상위로 이동')}
                                    </ContextMenuItem>
                                    {moveTargets.map(target => (
                                        <ContextMenuItem
                                            key={target.id}
                                            disabled={group.parentId === target.id}
                                            onClick={() => moveGroup(group.id, target.id)}
                                        >
                                            <span className="max-w-48 truncate">{getCharacterGroupPath(groups, target.id)}</span>
                                        </ContextMenuItem>
                                    ))}
                                </ContextMenuSubContent>
                            </ContextMenuSub>
                        </ContextMenuContent>
                    </ContextMenu>
                </DroppableFolder>
                {!group.collapsed && (
                    <div className={cn("ml-2 min-h-8 space-y-1.5 border-l-2 pb-2 pl-2 pt-1", folderColor.border)}>
                        {children.length > 0 && (
                            <SortableContext
                                items={children.map(child => `folder-${child.id}`)}
                                strategy={verticalListSortingStrategy}
                            >
                                {children.map(child => renderLegacyFolder(child, depth + 1))}
                            </SortableContext>
                        )}
                        <SortableContext
                            items={folderCharacters.map(character => character.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="min-w-0 space-y-1.5">
                                {folderCharacters.map(renderCharacterCard)}
                            </div>
                        </SortableContext>
                    </div>
                )}
            </div>
        )
    }

    if (!open) return null

    return (
        <>
            {/* 패널 - absolute로 프롬프트 영역 위에 오버레이 */}
            <div
                className={cn(
                    "absolute inset-0 z-10 min-w-0 overflow-hidden flex flex-col bg-muted/95 backdrop-blur-sm rounded-xl border border-border/50",
                    "animate-in slide-in-from-bottom-4 duration-200"
                )}
            >
                {/* Header */}
                <div className="relative flex min-w-0 items-center overflow-hidden px-3 py-2 bg-muted/50 border-b border-border/30 shrink-0">
                    <div className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-sm font-medium",
                        positionEnabled ? "pr-[192px]" : "pr-[160px]"
                    )}>
                        <Users className="h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1 truncate">{t('characterPanel.title', '캐릭터 프롬프트')}</span>
                        {enabledCharacterCount > 0 && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                                ({enabledCharacterCount})
                            </span>
                        )}
                    </div>
                    <div className="absolute right-3 top-1/2 z-10 flex shrink-0 -translate-y-1/2 items-center gap-1 bg-muted/50">
                        {/* 위치 설정 다이얼로그 (활성화 시에만) - 왼쪽에 배치 */}
                        {positionEnabled && (
                            <Tip content={t('characterPanel.positionTitle', '이미지 내 캐릭터 위치 지정')}>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => setPositionDialogOpen(true)}
                                >
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                </Button>
                            </Tip>
                        )}
                        <Tip content={t('characterPanel.disableAll', 'Disable all characters')}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={disableAll}
                                disabled={enabledCharacterCount === 0}
                            >
                                <EyeOff className="h-3.5 w-3.5" />
                            </Button>
                        </Tip>
                        {/* 위치 활성화 토글 */}
                        <Tip content={t('characterPanel.positionDesc', '캐릭터 위치 기능 활성화')}>
                            <Button
                                variant={positionEnabled ? "default" : "ghost"}
                                size="icon"
                                className={cn(
                                    "h-7 w-7",
                                    positionEnabled && "bg-primary text-primary-foreground"
                                )}
                                onClick={() => setPositionEnabled(!positionEnabled)}
                            >
                                <MapPin className="h-3.5 w-3.5" />
                            </Button>
                        </Tip>
                        <Tip content={t('characterPanel.addDesc', '새 캐릭터 프롬프트 추가')}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={handleAddCharacter}
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </Button>
                        </Tip>
                        <Tip content={t('characterPanel.addFolderDesc', '캐릭터 폴더 생성')}>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleCreateGroup()}
                            >
                                <FolderPlus className="h-3.5 w-3.5" />
                            </Button>
                        </Tip>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 hover:bg-destructive/20 hover:text-destructive"
                            onClick={() => onOpenChange(false)}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {enabledCharacters.length > 0 && (
                    <div className="shrink-0 space-y-1.5 border-b border-border/30 bg-background/25 px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1.5 font-medium">
                                <Eye className="h-3.5 w-3.5 text-primary" />
                                <span>{t('characterPanel.activeCharacters', 'Active characters')}</span>
                            </div>
                            <span>{enabledCharacterCount}</span>
                        </div>
                        <div className="flex max-h-[88px] flex-wrap gap-1.5 overflow-y-auto pr-1">
                            {enabledCharacters.map((character) => {
                                const index = characterIndexById.get(character.id) ?? 0
                                const displayName = getVariantBaseName(
                                    character,
                                    character.prompt
                                        ? character.prompt.split(',')[0].trim().substring(0, 30)
                                        : t('characterPanel.unnamed', 'Character')
                                )
                                const groupName = character.groupId && groupById.has(character.groupId)
                                    ? getCharacterGroupPath(groups, character.groupId)
                                    : undefined

                                return (
                                    <button
                                        key={character.id}
                                        type="button"
                                        className="flex min-w-0 basis-[140px] flex-1 items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted/70"
                                        title={groupName ? `${displayName} / ${groupName}` : displayName}
                                        onClick={() => handleFocusCharacter(character)}
                                    >
                                        <span
                                            className="h-2 w-2 shrink-0 rounded-full"
                                            style={{ backgroundColor: CHARACTER_COLORS[index % CHARACTER_COLORS.length] }}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{displayName}</span>
                                        {groupName && (
                                            <span className="max-w-[72px] truncate text-[10px] text-muted-foreground">{groupName}</span>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                {/* Search */}
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border/30 px-3 py-2">
                    {expertCharacterPromptFolderBrowserEnabled && (
                        <Tip content={t('characterPanel.toggleFolders', '폴더 패널 열기/닫기')}>
                            <Button
                                type="button"
                                variant={folderPanelOpen ? "secondary" : "ghost"}
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => setFolderPanelOpen(open => !open)}
                            >
                                <Menu className="h-4 w-4" />
                            </Button>
                        </Tip>
                    )}
                    <div className="relative min-w-0 flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('characterPanel.search', '캐릭터 검색...')}
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    {expertCharacterPromptFolderBrowserEnabled ? (
                    <div className="flex min-h-0 flex-1">
                        {folderPanelOpen && (
                        <>
                        <div
                            className="flex min-w-[120px] shrink-0 flex-col bg-background/20"
                            style={{ width: folderPanelWidth, maxWidth: 'calc(100% - 180px)' }}
                        >
                            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/20 px-2 text-[11px] font-medium text-muted-foreground">
                                <span>{t('characterPanel.folders', '폴더')}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6"
                                    onClick={() => handleCreateGroup()}
                                >
                                    <FolderPlus className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                            <ScrollArea className="min-h-0 flex-1">
                                <div className="space-y-0.5 p-1.5">
                                    <DroppableUngrouped isActive={activeId !== null}>
                                        <button
                                            type="button"
                                            className={cn(
                                                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                                                !selectedGroupId
                                                    ? "bg-primary/15 text-foreground"
                                                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                                            )}
                                            onClick={() => setSelectedGroupId(null)}
                                        >
                                            <Users className="h-4 w-4 shrink-0" />
                                            <span className="min-w-0 flex-1 truncate">{t('characterPanel.ungrouped', '미분류')}</span>
                                            <span className="text-[10px] opacity-50">{ungroupedCount}</span>
                                        </button>
                                    </DroppableUngrouped>
                                    <SortableContext
                                        items={(groupChildren.get('root') || []).map(group => `folder-${group.id}`)}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {(groupChildren.get('root') || []).map(group => renderFolderTree(group))}
                                    </SortableContext>
                                </div>
                            </ScrollArea>
                        </div>
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            className="w-1.5 shrink-0 cursor-col-resize border-l border-border/30 transition-colors hover:bg-primary/25"
                            onMouseDown={startFolderPanelResize}
                        />
                        </>
                        )}

                        <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/20 px-2">
                                <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                                    {normalizedSearch
                                        ? <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
                                        : selectedGroup
                                            ? <FolderOpen className={cn("h-3.5 w-3.5 shrink-0", FOLDER_COLORS[selectedGroup.colorIndex ?? 0].icon)} />
                                            : <Users className="h-3.5 w-3.5 shrink-0" />
                                    }
                                    <span className="truncate">
                                        {normalizedSearch
                                            ? t('characterPanel.searchResults', '검색 결과')
                                            : selectedGroup
                                                ? getCharacterGroupPath(groups, selectedGroup.id)
                                                : t('characterPanel.ungrouped', '미분류')
                                        }
                                    </span>
                                    <span className="shrink-0 text-[10px] text-muted-foreground">{visibleCharacters.length}</span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 shrink-0"
                                    onClick={handleAddCharacter}
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                            <ScrollArea className="min-h-0 flex-1">
                                <SortableContext
                                    items={visibleCharacters.map(character => character.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div className="min-w-0 space-y-1.5 p-2">
                                        {visibleCharacters.map(renderCharacterCard)}
                                        {visibleCharacters.length === 0 && (
                                            <div className="flex min-h-40 items-center justify-center py-8 text-center text-sm text-muted-foreground">
                                                <div>
                                                    {normalizedSearch
                                                        ? <Search className="mx-auto mb-2 h-7 w-7 opacity-30" />
                                                        : <Users className="mx-auto mb-2 h-7 w-7 opacity-30" />
                                                    }
                                                    <p>
                                                        {normalizedSearch
                                                            ? t('characterPanel.noResults', '검색 결과가 없습니다')
                                                            : t('characterPanel.emptyFolder', '빈 폴더')
                                                        }
                                                    </p>
                                                    {!normalizedSearch && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="mt-2"
                                                            onClick={handleAddCharacter}
                                                        >
                                                            <Plus className="mr-1 h-3.5 w-3.5" />
                                                            {t('characterPanel.addFirst', '첫 캐릭터 추가')}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </SortableContext>
                            </ScrollArea>
                        </div>
                    </div>
                    ) : (
                        <ScrollArea className="min-h-0 flex-1">
                            <div className="flex min-w-0 flex-col gap-2 p-3">
                                {characters.length === 0 ? (
                                    <div className="flex min-h-48 items-center justify-center py-12 text-center text-sm text-muted-foreground">
                                        <div>
                                            <Users className="mx-auto mb-2 h-8 w-8 opacity-30" />
                                            <p>{t('characterPanel.empty', '캐릭터가 없습니다')}</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-2"
                                                onClick={handleAddCharacter}
                                            >
                                                <Plus className="mr-1 h-3.5 w-3.5" />
                                                {t('characterPanel.addFirst', '첫 캐릭터 추가')}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <SortableContext
                                            items={(groupChildren.get('root') || []).map(group => `folder-${group.id}`)}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            {(groupChildren.get('root') || []).map(group => renderLegacyFolder(group))}
                                        </SortableContext>
                                        <DroppableUngrouped isActive={activeId !== null}>
                                            <SortableContext
                                                items={legacyUngroupedCharacters.map(character => character.id)}
                                                strategy={verticalListSortingStrategy}
                                            >
                                                <div className="min-w-0 space-y-1.5">
                                                    {groups.length > 0 && (
                                                        <div className="flex items-center gap-2 px-2 py-1 text-sm font-medium text-muted-foreground">
                                                            <Users className="h-4 w-4" />
                                                            {t('characterPanel.ungrouped', '미분류')}
                                                            <span className="text-xs opacity-50">({legacyUngroupedCharacters.length})</span>
                                                        </div>
                                                    )}
                                                    {legacyUngroupedCharacters.map(renderCharacterCard)}
                                                </div>
                                            </SortableContext>
                                        </DroppableUngrouped>
                                        {normalizedSearch
                                            && getVisibleStackCharacters(characters.filter(characterMatchesSearch)).length === 0
                                            && (
                                                <div className="flex min-h-40 items-center justify-center py-8 text-center text-sm text-muted-foreground">
                                                    <div>
                                                        <Search className="mx-auto mb-2 h-8 w-8 opacity-30" />
                                                        <p>{t('characterPanel.noResults', '검색 결과가 없습니다')}</p>
                                                    </div>
                                                </div>
                                            )}
                                    </>
                                )}
                            </div>
                        </ScrollArea>
                    )}
                </DndContext>
            </div>

            {/* Position Dialog */}
            <PositionDialog
                open={positionDialogOpen}
                onOpenChange={setPositionDialogOpen}
                characters={characters}
                onPositionChange={setPosition}
            />
        </>
    )
}

// --- DroppableFolder Component ---
interface DroppableFolderProps {
    folderId: string
    isActive: boolean
    isCollapsed: boolean
    colorClass?: string
    children: React.ReactNode
}

function DroppableFolder({ folderId, isActive, isCollapsed, colorClass, children }: DroppableFolderProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
        isOver,
    } = useSortable({
        id: `folder-${folderId}`,
    })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        position: isDragging ? 'relative' as const : undefined,
        zIndex: isDragging ? 20 : undefined,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className={cn(
                "transition-all duration-200 rounded-lg",
                isActive && isCollapsed && "ring-2 ring-dashed ring-current/30",
                isOver && cn("ring-2 ring-current", colorClass),
                isDragging && "opacity-60 shadow-lg"
            )}
        >
            {children}
        </div>
    )
}

// --- DroppableUngrouped Component ---
interface DroppableUngroupedProps {
    isActive: boolean
    children: React.ReactNode
}

function DroppableUngrouped({ isActive, children }: DroppableUngroupedProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'ungrouped-zone',
    })

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "transition-all duration-200 rounded-lg min-h-[40px]",
                isActive && "ring-2 ring-dashed ring-primary/30",
                isOver && "ring-2 ring-primary bg-primary/10"
            )}
        >
            {children}
        </div>
    )
}

// --- SortableCharacterCard Wrapper ---
function haveSameCharacterCardProps(previous: CharacterCardProps, next: CharacterCardProps) {
    if (
        previous.character !== next.character
        || previous.index !== next.index
        || previous.isExpanded !== next.isExpanded
        || previous.positionEnabled !== next.positionEnabled
        || previous.groups !== next.groups
        || previous.expertCharacterPromptLayoutEnabled !== next.expertCharacterPromptLayoutEnabled
        || previous.expertCharacterPromptVariantsEnabled !== next.expertCharacterPromptVariantsEnabled
    ) return false

    if (!next.expertCharacterPromptVariantsEnabled) return true

    const stackKey = getStackKey(next.character)
    const previousVariants = previous.allCharacters.filter(character => getStackKey(character) === stackKey)
    const nextVariants = next.allCharacters.filter(character => getStackKey(character) === stackKey)
    return previousVariants.length === nextVariants.length
        && previousVariants.every((character, index) => character === nextVariants[index])
}

const SortableCharacterCard = memo(function SortableCharacterCard(props: CharacterCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.character.id })

    const style: React.CSSProperties = {
        width: '100%',
        minWidth: 0,
        maxWidth: '100%',
        contain: 'inline-size',
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 9999 : 'auto',
        position: isDragging ? 'relative' : undefined,
        opacity: isDragging ? 0.9 : 1,
        boxShadow: isDragging ? '0 10px 40px rgba(0,0,0,0.3)' : undefined,
    }

    return (
        <div 
            ref={setNodeRef} 
            style={style}
            className="w-full min-w-0 max-w-full overflow-hidden"
            {...attributes}
        >
            <CharacterCard {...props} dragHandleProps={listeners} />
        </div>
    )
}, haveSameCharacterCardProps)

// --- Character Card Component ---
interface CharacterCardProps {
    character: CharacterPrompt
    index: number
    isExpanded: boolean
    onToggleExpand: () => void
    onUpdate: (data: Partial<CharacterPrompt>) => void
    updateCharacterDirect: (id: string, data: Partial<CharacterPrompt>) => void
    onRemove: () => void
    onToggleEnabled: () => void
    onDuplicate: () => void
    onSaveAsPreset: () => void
    onMoveToGroup: (characterId: string, groupId: string | undefined) => void
    positionEnabled: boolean
    groups: CharacterGroup[]
    allCharacters: CharacterPrompt[]
    expertCharacterPromptLayoutEnabled: boolean
    expertCharacterPromptVariantsEnabled: boolean
    onAddVariant: () => void
    onSelectVariant: (id: string) => void
    dragHandleProps?: React.HTMLAttributes<HTMLElement>
}

function CharacterCard({
    character,
    index,
    isExpanded,
    onToggleExpand,
    onUpdate,
    updateCharacterDirect,
    onRemove,
    onToggleEnabled,
    onDuplicate,
    onSaveAsPreset,
    onMoveToGroup,
    positionEnabled,
    groups,
    allCharacters,
    expertCharacterPromptLayoutEnabled,
    expertCharacterPromptVariantsEnabled,
    onAddVariant,
    onSelectVariant,
    dragHandleProps,
}: CharacterCardProps) {
    const color = CHARACTER_COLORS[index % CHARACTER_COLORS.length]
    const { t } = useTranslation()
    const promptFontSize = useSettingsStore(state => state.promptFontSize)

    // 로컬 상태로 입력값 관리 (렉 방지)
    const [renameDialogOpen, setRenameDialogOpen] = useState(false)
    const [newName, setNewName] = useState(character.name || '')
    const [activePromptTab, setActivePromptTab] = useState<'prompt' | 'negative'>('prompt')
    const [primaryPromptCollapsed, setPrimaryPromptCollapsed] = useState(false)
    const [secondaryPromptCollapsed, setSecondaryPromptCollapsed] = useState(false)
    const { characterPrompt, costumePrompt } = splitCostumePrompt(character.prompt)
    const promptEnabled = character.promptEnabled ?? true
    const negativeEnabled = character.negativeEnabled ?? true
    const costumeEnabled = character.costumeEnabled ?? true
    const variants = expertCharacterPromptVariantsEnabled ? allCharacters
        .filter(c => getStackKey(c) === getStackKey(character))
        .sort((a, b) => getVariantIndex(a) - getVariantIndex(b)) : [character]
    const [variantNames, setVariantNames] = useState<Record<string, string>>({})

    useEffect(() => {
        if (!renameDialogOpen) return
        setNewName(getVariantBaseName(character, ''))
        setVariantNames(Object.fromEntries(variants.map(variant => [
            variant.id,
            getVariantBaseName(variant, variant.name || '')
        ])))
    }, [renameDialogOpen, character.id, variants.length])

    const saveVariantNames = () => {
        if (expertCharacterPromptVariantsEnabled && variants.length > 1) {
            variants.forEach((variant) => {
                const hash = getVariantHash(variant)
                if (!hash) return
                const nextName = (variantNames[variant.id] || '').trim()
                updateCharacterDirect(variant.id, { name: getVariantName(nextName || getVariantBaseName(variant, 'Character'), getVariantIndex(variant), hash) })
            })
        } else {
            const hash = getVariantHash(character)
            onUpdate({ name: hash ? getVariantName(newName.trim() || getVariantBaseName(character, 'Character'), getVariantIndex(character), hash) : (newName.trim() || undefined) })
        }
        setRenameDialogOpen(false)
    }

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>
                    <div
                        data-character-prompt-id={character.id}
                        className={cn(
                            "w-full min-w-0 max-w-full rounded-xl border border-border/50 bg-background/60 transition-all duration-200 overflow-hidden",
                            !character.enabled && "opacity-50"
                        )}
                    >
                        {/* Card Header - Drag Handle */}
                        <div
                            className="flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden px-3 py-2.5 cursor-grab hover:bg-muted/50 transition-colors bg-muted/30 active:cursor-grabbing"
                            onClick={onToggleExpand}
                            {...dragHandleProps}
                        >
                            {/* 캐릭터 아이콘 */}
                            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <User className="h-4 w-4 text-primary" />
                            </div>

                            {/* 캐릭터 번호 뱃지 - 위치 활성화시 색상 표시 */}
                            <div
                                className={cn(
                                    "w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0 transition-colors",
                                    positionEnabled
                                        ? "text-white"
                                        : "bg-muted-foreground/20 text-muted-foreground"
                                )}
                                style={positionEnabled ? { backgroundColor: color } : undefined}
                            >
                                {index + 1}
                            </div>

                            <span className="w-0 min-w-0 flex-1 truncate text-sm font-medium">
                                {getVariantBaseName(
                                    character,
                                    character.prompt
                                        ? character.prompt.split(',')[0].trim().substring(0, 30)
                                        : t('characterPanel.unnamed', '??? ' + (index + 1))
                                )}
                            </span>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onToggleEnabled()
                                }}
                            >
                                {character.enabled ? (
                                    <Eye className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                            </Button>
                            <div className="shrink-0">
                                {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                            </div>
                        </div>

                        {/* Expanded Content - 아래로 펼쳐짐 */}
                        {isExpanded && (
                            <div className="min-w-0 px-3 py-3 space-y-3 border-t border-border/30 bg-background/40 animate-in slide-in-from-top-2 duration-150">
                                {expertCharacterPromptLayoutEnabled ? (
                                    <div className="flex h-[332px] min-w-0 flex-col gap-3">
                                        <div
                                            className={cn(
                                                "min-w-0 overflow-hidden flex flex-col transition-all duration-200",
                                                primaryPromptCollapsed && "h-7 flex-none"
                                            )}
                                            style={primaryPromptCollapsed ? undefined : { flex: '150 1 0%' }}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 text-xs font-medium">
                                                    <button
                                                        type="button"
                                                        className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                                                        onClick={() => setPrimaryPromptCollapsed(value => !value)}
                                                    >
                                                        {primaryPromptCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                                    </button>
                                                    <button
                                                        className={cn("px-2 py-1 rounded-md", activePromptTab === 'prompt' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
                                                        onClick={() => setActivePromptTab('prompt')}
                                                    >{t('characterPanel.prompt', 'Prompt')}</button>
                                                    <button
                                                        className={cn("px-2 py-1 rounded-md", activePromptTab === 'negative' ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:bg-muted")}
                                                        onClick={() => setActivePromptTab('negative')}
                                                    >{t('characterPanel.negative', 'Negative')}</button>
                                                    <Tip content={t('characterPanel.commentHint', 'Use # followed by a space for comments. #target and #source are sent to NovelAI.') }>
                                                        <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                                                    </Tip>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => activePromptTab === 'prompt' ? onUpdate({ promptEnabled: !promptEnabled }) : onUpdate({ negativeEnabled: !negativeEnabled })}>
                                                    {(activePromptTab === 'prompt' ? promptEnabled : negativeEnabled) ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                </Button>
                                            </div>
                                            {!primaryPromptCollapsed && (activePromptTab === 'prompt' ? (
                                                <AutocompleteTextarea
                                                    value={characterPrompt}
                                                    onChange={(e) => onUpdate({ prompt: joinCostumePrompt(e.target.value, costumePrompt) })}
                                                    placeholder={t('characterPanel.promptPlaceholder')}
                                                    className={cn("mt-1.5 flex-1 min-h-0 text-sm resize-none", !promptEnabled && "opacity-50")}
                                                    style={{ fontSize: `${promptFontSize}px` }}
                                                />
                                            ) : (
                                                <AutocompleteTextarea
                                                    value={character.negative}
                                                    onChange={(e) => onUpdate({ negative: e.target.value })}
                                                    placeholder={t('characterPanel.negativePlaceholder')}
                                                    className={cn("mt-1.5 flex-1 min-h-0 text-sm border-destructive/20 resize-none", !negativeEnabled && "opacity-50")}
                                                    style={{ fontSize: `${promptFontSize}px` }}
                                                />
                                            ))}
                                        </div>
                                        <div
                                            className={cn(
                                                "min-w-0 overflow-hidden flex flex-col transition-all duration-200",
                                                secondaryPromptCollapsed && "h-7 flex-none"
                                            )}
                                            style={secondaryPromptCollapsed ? undefined : { flex: '110 1 0%' }}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <button
                                                    type="button"
                                                    className="flex h-6 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                                                    onClick={() => setSecondaryPromptCollapsed(value => !value)}
                                                >
                                                    {secondaryPromptCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                                    <span className="whitespace-nowrap">{t('characterPanel.costume')}</span>
                                                </button>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUpdate({ costumeEnabled: !costumeEnabled })}>
                                                    {costumeEnabled ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                </Button>
                                            </div>
                                            {!secondaryPromptCollapsed && <AutocompleteTextarea
                                                value={costumePrompt}
                                                onChange={(e) => onUpdate({ prompt: joinCostumePrompt(characterPrompt, e.target.value) })}
                                                placeholder={t('characterPanel.costumePlaceholder')}
                                                className={cn("mt-1.5 flex-1 min-h-0 text-sm resize-none", !costumeEnabled && "opacity-50")}
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex h-[376px] min-w-0 flex-col gap-3">
                                        <div
                                            className={cn(
                                                "min-w-0 overflow-hidden flex flex-col transition-all duration-200",
                                                primaryPromptCollapsed && "h-7 flex-none"
                                            )}
                                            style={primaryPromptCollapsed ? undefined : { flex: '180 1 0%' }}
                                        >
                                            <button
                                                type="button"
                                                className="flex h-6 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                                                onClick={() => setPrimaryPromptCollapsed(value => !value)}
                                            >
                                                {primaryPromptCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                                <span className="whitespace-nowrap">{t('characterPanel.prompt', 'Prompt')}</span>
                                                <Tip content={t('characterPanel.commentHint', 'Use # followed by a space for comments. #target and #source are sent to NovelAI.') }>
                                                    <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                                                </Tip>
                                            </button>
                                            {!primaryPromptCollapsed && <AutocompleteTextarea
                                                value={character.prompt}
                                                onChange={(e) => onUpdate({ prompt: e.target.value })}
                                                placeholder={t('characterPanel.promptPlaceholder')}
                                                className="mt-1.5 flex-1 min-h-0 text-sm resize-none"
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />}
                                        </div>
                                        <div
                                            className={cn(
                                                "min-w-0 overflow-hidden flex flex-col transition-all duration-200",
                                                secondaryPromptCollapsed && "h-7 flex-none"
                                            )}
                                            style={secondaryPromptCollapsed ? undefined : { flex: '140 1 0%' }}
                                        >
                                            <button
                                                type="button"
                                                className="flex h-6 items-center gap-1 text-xs font-medium text-destructive/70 hover:text-destructive"
                                                onClick={() => setSecondaryPromptCollapsed(value => !value)}
                                            >
                                                {secondaryPromptCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                                <span className="whitespace-nowrap">{t('characterPanel.negative', 'Negative')}</span>
                                            </button>
                                            {!secondaryPromptCollapsed && <AutocompleteTextarea
                                                value={character.negative}
                                                onChange={(e) => onUpdate({ negative: e.target.value })}
                                                placeholder={t('characterPanel.negativePlaceholder')}
                                                className="mt-1.5 flex-1 min-h-0 text-sm border-destructive/20 resize-none"
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />}
                                        </div>
                                    </div>
                                )}
                                {expertCharacterPromptVariantsEnabled && (
                                    <div className="flex items-center justify-between gap-2 py-1">
                                        <div className="flex items-center gap-1">
                                            {variants.length > 1 && variants.map((variant, i) => (
                                                <Button key={variant.id} size="icon" variant={variant.id === character.id ? "default" : "outline"} className="h-8 w-8 rounded-md" onClick={() => onSelectVariant(variant.id)} disabled={variant.id === character.id}>
                                                    {i + 1}
                                                </Button>
                                            ))}
                                            {variants.length < 5 && (
                                                <Button size="icon" variant="outline" className="h-8 w-8 rounded-md border-dashed" onClick={onAddVariant}>
                                                    <Plus className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                        {variants.length > 1 && (
                                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-md text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onRemove}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                )}                            </div>
                        )}
                    </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onClick={() => setRenameDialogOpen(true)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        {t('characterPanel.rename', '이름 변경')}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onToggleEnabled}>
                        {character.enabled ? (
                            <>
                                <EyeOff className="h-4 w-4 mr-2" />
                                {t('characterPanel.disable', '비활성화')}
                            </>
                        ) : (
                            <>
                                <Eye className="h-4 w-4 mr-2" />
                                {t('characterPanel.enable', '활성화')}
                            </>
                        )}
                    </ContextMenuItem>
                    <ContextMenuItem onClick={onDuplicate}>
                        <Copy className="h-4 w-4 mr-2" />
                        {t('characterPanel.duplicate', '복제')}
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={onSaveAsPreset}>
                        <Save className="h-4 w-4 mr-2" />
                        {t('characterPanel.saveAsPreset', '프리셋으로 저장')}
                    </ContextMenuItem>
                    {groups.length > 0 && (
                        <ContextMenuSub>
                            <ContextMenuSubTrigger>
                                <Folder className="h-4 w-4 mr-2" />
                                {t('characterPanel.moveToFolder', '폴더로 이동')}
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent>
                                {character.groupId && (
                                    <ContextMenuItem onClick={() => onMoveToGroup(character.id, undefined)}>
                                        <X className="h-4 w-4 mr-2" />
                                        {t('characterPanel.removeFromFolder', '폴더에서 제거')}
                                    </ContextMenuItem>
                                )}
                                {groups.map(group => (
                                    <ContextMenuItem
                                        key={group.id}
                                        onClick={() => onMoveToGroup(character.id, group.id)}
                                        disabled={character.groupId === group.id}
                                    >
                                        <Folder className="h-4 w-4 mr-2 text-amber-500" />
                                        {getCharacterGroupPath(groups, group.id)}
                                    </ContextMenuItem>
                                ))}
                            </ContextMenuSubContent>
                        </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={onRemove} className="text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        {t('common.delete', '삭제')}
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            {/* 이름 변경 다이얼로그 */}
            <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Pencil className="h-4 w-4" />
                            {t('characterPanel.rename', '이름 변경')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        {expertCharacterPromptVariantsEnabled && variants.length > 1 ? (
                            <div className="space-y-2">
                                {variants.map((variant, i) => (
                                    <div key={variant.id} className="flex items-center gap-2">
                                        <span className="w-6 text-xs text-muted-foreground text-center">{i + 1}</span>
                                        <Input
                                            value={variantNames[variant.id] ?? getVariantBaseName(variant, '')}
                                            onChange={(e) => setVariantNames(prev => ({ ...prev, [variant.id]: e.target.value }))}
                                            placeholder={t('characterPanel.namePlaceholder', '??? ?? ??...')}
                                            autoFocus={variant.id === character.id}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <Input
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder={t('characterPanel.namePlaceholder', '??? ?? ??...')}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveVariantNames()
                                }}
                                autoFocus
                            />
                        )}
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setRenameDialogOpen(false)}>
                                {t('common.cancel', '??')}
                            </Button>
                            <Button size="sm" onClick={saveVariantNames}>
                                {t('common.save', '??')}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}

// --- Position Dialog ---
interface PositionDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    characters: CharacterPrompt[]
    onPositionChange: (id: string, x: number, y: number) => void
}

function PositionDialog({ open, onOpenChange, characters, onPositionChange }: PositionDialogProps) {
    const { t } = useTranslation()
    const gridRef = useRef<HTMLDivElement>(null)
    const [dragging, setDragging] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const selectedResolution = useGenerationStore(state => state.selectedResolution)
    const boardAspectRatio = getCharacterPositionBoardAspectRatio(
        selectedResolution.width,
        selectedResolution.height
    )

    const updatePositionFromPointer = (id: string, clientX: number, clientY: number) => {
        if (!gridRef.current) return
        const rect = gridRef.current.getBoundingClientRect()
        const x = snapCharacterPosition((clientX - rect.left) / rect.width)
        const y = snapCharacterPosition((clientY - rect.top) / rect.height)
        onPositionChange(id, x, y)
    }

    const handleMouseDown = (e: ReactMouseEvent, id: string) => {
        e.preventDefault()
        setDragging(id)
        setSelectedId(id)
    }

    const handleMouseMove = (e: ReactMouseEvent) => {
        if (!dragging) return
        updatePositionFromPointer(dragging, e.clientX, e.clientY)
    }

    const handleGridMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
        if (e.button !== 0 || e.target !== e.currentTarget || !selectedId) return
        updatePositionFromPointer(selectedId, e.clientX, e.clientY)
    }

    const handleMouseUp = () => {
        setDragging(null)
    }

    useEffect(() => {
        const handleGlobalMouseUp = () => setDragging(null)
        window.addEventListener('mouseup', handleGlobalMouseUp)
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
    }, [])

    const enabledCharacters = characters.filter(c => c.enabled)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        {t('characterPanel.positionTitle', '캐릭터 위치 지정')}
                    </DialogTitle>
                </DialogHeader>

                <div
                    ref={gridRef}
                    className="relative mx-auto w-full bg-muted/30 rounded-lg border cursor-crosshair select-none overflow-hidden shadow-inner"
                    style={{ aspectRatio: boardAspectRatio }}
                    onMouseDown={handleGridMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* Grid lines */}
                    <div className="absolute inset-0 grid grid-cols-5 grid-rows-5 pointer-events-none">
                        {Array.from({ length: CHARACTER_POSITION_GRID_SIZE ** 2 }, (_, i) => (
                            <div key={i} className="border border-border/20" />
                        ))}
                    </div>

                    {/* Character markers */}
                    {enabledCharacters.map((char) => {
                        const colorIndex = characters.findIndex(c => c.id === char.id)
                        return (
                            <div
                                key={char.id}
                                className={cn(
                                    "absolute w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold cursor-grab active:cursor-grabbing shadow-lg transition-transform",
                                    selectedId === char.id && "ring-2 ring-white ring-offset-2 ring-offset-black/50 scale-110 z-10",
                                    dragging === char.id && "scale-125 z-20"
                                )}
                                style={{
                                    left: `${char.position.x * 100}%`,
                                    top: `${char.position.y * 100}%`,
                                    transform: 'translate(-50%, -50%)',
                                    backgroundColor: CHARACTER_COLORS[colorIndex % CHARACTER_COLORS.length],
                                }}
                                onMouseDown={(e) => handleMouseDown(e, char.id)}
                            >
                                {colorIndex + 1}
                            </div>
                        )
                    })}

                    {/* Empty state */}
                    {enabledCharacters.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-muted-foreground text-sm text-center">
                                <Users className="w-8 h-8 opacity-30 mx-auto mb-2" />
                                <p>{t('characterPanel.noActiveCharacters', '활성화된 캐릭터가 없습니다')}</p>
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-xs text-muted-foreground text-center">
                    {t('characterPanel.positionHelp', '캐릭터를 드래그하여 위치를 지정하세요')}
                </p>
            </DialogContent>
        </Dialog>
    )
}
