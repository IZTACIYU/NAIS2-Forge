import { useState, useEffect, useRef, useCallback, MouseEvent } from 'react'
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
import { useCharacterPromptStore, CHARACTER_COLORS, CharacterPrompt, FOLDER_COLORS } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
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
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'

interface CharacterPromptPanelProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}


const COSTUME_MARKER = '\n#!-\uc758\uc0c1\ud504\ub86c\n'

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
        positionEnabled,
        setPositionEnabled,
        addGroup,
        updateGroup,
        deleteGroup,
        toggleGroupCollapsed,
        toggleGroupEnabled,
        moveCharacterToGroup,
        saveCharacterAsPreset,
    } = useCharacterPromptStore()

    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [positionDialogOpen, setPositionDialogOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
    const [editingGroupName, setEditingGroupName] = useState('')
    const [activeId, setActiveId] = useState<string | null>(null)
    const expertCharacterPromptLayoutEnabled = useSettingsStore(state => state.expertCharacterPromptLayoutEnabled)
    const expertCharacterPromptVariantsEnabled = useSettingsStore(state => state.expertCharacterPromptVariantsEnabled)

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

    const { reorderCharactersInGroup } = useCharacterPromptStore()

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        setActiveId(null)
        
        if (!over) return
        
        const activeCharId = active.id as string
        const overId = over.id as string
        
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

    // 패널 열릴 때 첫 번째 캐릭터 펼치기
    useEffect(() => {
        if (open && characters.length > 0 && !expandedId) {
            setExpandedId(characters[0].id)
        }
    }, [open, characters.length])

    const handleAddCharacter = () => {
        addCharacter()
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

        if (!getVariantHash(char)) {
            updateCharacter(char.id, { name: getVariantName(baseName, 0, hash) })
        }

        const usedIndexes = new Set(stackCharacters.map(c => getVariantIndex(c)))
        let nextIndex = 1
        while (usedIndexes.has(nextIndex) && nextIndex < 5) nextIndex++

        addCharacter({
            name: getVariantName(baseName, nextIndex, hash),
            prompt: char.prompt,
            negative: char.negative,
            groupId: char.groupId,
            promptEnabled: char.promptEnabled ?? true,
            negativeEnabled: char.negativeEnabled ?? true,
            costumeEnabled: char.costumeEnabled ?? true,
            position: char.position,
        })
        setTimeout(() => {
            const newChar = useCharacterPromptStore.getState().characters.slice(-1)[0]
            if (newChar) {
                activateVariant(newChar.id)
            }
        }, 0)
    }, [activateVariant, addCharacter, characters, updateCharacter])

    const handleToggleExpand = useCallback((id: string) => {
        setExpandedId(prev => prev === id ? null : id)
    }, [])

    const handleCreateGroup = () => {
        const baseName = t('characterPanel.newFolderName', '새폴더')
        const existingNames = groups.map(g => g.name)
        
        // 새폴더, 새폴더(2), 새폴더(3) 형태로 이름 생성
        let newName = baseName
        let counter = 2
        while (existingNames.includes(newName)) {
            newName = `${baseName}(${counter})`
            counter++
        }
        
        addGroup(newName)
    }

    const handleSaveGroupName = (groupId: string) => {
        if (editingGroupName.trim()) {
            updateGroup(groupId, { name: editingGroupName.trim() })
        }
        setEditingGroupId(null)
        setEditingGroupName('')
    }

    const handleCycleFolderColor = (e: React.MouseEvent, groupId: string) => {
        e.preventDefault()
        const group = groups.find(g => g.id === groupId)
        if (!group) return
        const currentIndex = group.colorIndex ?? 0
        const nextIndex = (currentIndex + 1) % FOLDER_COLORS.length
        updateGroup(groupId, { colorIndex: nextIndex })
    }

    const handleSaveAsPreset = (char: CharacterPrompt) => {
        saveCharacterAsPreset(char.id)
        toast({
            title: t('characterPanel.savedAsPreset', '프리셋으로 저장됨'),
            description: char.name || char.prompt.split(',')[0]?.trim() || 'Character',
        })
    }

    // 검색 필터링
    const matchesSearch = (char: CharacterPrompt) => {
        if (!searchQuery.trim()) return true
        const query = searchQuery.toLowerCase()
        const name = char.name?.toLowerCase() || ''
        const promptPreview = char.prompt?.split(',')[0]?.trim().toLowerCase() || ''
        return name.includes(query) || promptPreview.includes(query)
    }

    // 폴더별로 그룹화

    const getVisibleStackCharacters = (list: CharacterPrompt[]) => {
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
    }

    const groupIds = new Set(groups.map(g => g.id))
    // 미분류: groupId가 없거나, 존재하지 않는 그룹에 속한 캐릭터
    const ungroupedSourceCharacters = characters.filter(c => (!c.groupId || !groupIds.has(c.groupId)) && matchesSearch(c))
    const ungroupedCharacters = getVisibleStackCharacters(ungroupedSourceCharacters)
    const groupedCharacters = groups.map(group => {
        const sourceChars = characters.filter(c => c.groupId === group.id && matchesSearch(c))
        return {
            group,
            sourceCount: sourceChars.length,
            chars: getVisibleStackCharacters(sourceChars)
        }
    })

    if (!open) return null

    return (
        <>
            {/* 패널 - absolute로 프롬프트 영역 위에 오버레이 */}
            <div
                className={cn(
                    "absolute inset-0 z-10 flex flex-col bg-muted/95 backdrop-blur-sm rounded-xl border border-border/50",
                    "animate-in slide-in-from-bottom-4 duration-200"
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border/30 shrink-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-4 w-4 text-primary" />
                        <span>{t('characterPanel.title', '캐릭터 프롬프트')}</span>
                        {characters.filter(c => c.enabled).length > 0 && (
                            <span className="text-xs text-muted-foreground">
                                ({characters.filter(c => c.enabled).length})
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
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
                                onClick={handleCreateGroup}
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

                {/* Search */}
                <div className="px-3 py-2 border-b border-border/30 shrink-0">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('characterPanel.search', '캐릭터 검색...')}
                            className="h-8 pl-8 text-sm"
                        />
                    </div>
                </div>

                {/* Character Cards - Grouped by Folders */}
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToVerticalAxis]}
                >
                <ScrollArea className="flex-1 min-h-0">
                            <div className="flex flex-col gap-2 p-3">
                                {characters.length === 0 ? (
                                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
                                        <div className="text-center">
                                            <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                            <p>{t('characterPanel.empty', '캐릭터가 없습니다')}</p>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-2"
                                                onClick={handleAddCharacter}
                                            >
                                                <Plus className="h-3.5 w-3.5 mr-1" />
                                                {t('characterPanel.addFirst', '첫 캐릭터 추가')}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Grouped Characters */}
                                        {groupedCharacters.map(({ group, chars, sourceCount }) => {
                                            const folderColor = FOLDER_COLORS[group.colorIndex ?? 0]
                                            return (
                                            <DroppableFolder key={group.id} folderId={group.id} isActive={activeId !== null} isCollapsed={group.collapsed} colorClass={folderColor.bg}>
                                                {/* Folder Header */}
                                                <div 
                                                    className="flex items-center gap-2 group/folder bg-muted/40 rounded-t-lg px-2 py-1.5 cursor-pointer"
                                                    onContextMenu={(e) => handleCycleFolderColor(e, group.id)}
                                                >
                                                    <button
                                                        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors flex-1 text-left"
                                                        onClick={() => toggleGroupCollapsed(group.id)}
                                                    >
                                                        {group.collapsed ? (
                                                            <ChevronRight className="w-4 h-4" />
                                                        ) : (
                                                            <ChevronDown className="w-4 h-4" />
                                                        )}
                                                        {group.collapsed ? (
                                                            <Folder className={cn("w-5 h-5", folderColor.icon)} />
                                                        ) : (
                                                            <FolderOpen className={cn("w-5 h-5", folderColor.icon)} />
                                                        )}
                                                        {editingGroupId === group.id ? (
                                                            <Input
                                                                autoFocus
                                                                value={editingGroupName}
                                                                onChange={(e) => setEditingGroupName(e.target.value)}
                                                                onBlur={() => handleSaveGroupName(group.id)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') handleSaveGroupName(group.id)
                                                                    if (e.key === 'Escape') {
                                                                        setEditingGroupId(null)
                                                                        setEditingGroupName('')
                                                                    }
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className="h-6 text-sm px-1.5 py-0 w-28"
                                                            />
                                                        ) : (
                                                            <span className="font-medium">{group.name}</span>
                                                        )}
                                                        <span className="text-xs opacity-50">
                                                            ({expertCharacterPromptVariantsEnabled ? chars.length : sourceCount})
                                                        </span>
                                                    </button>
                                                    <div className="opacity-0 group-hover/folder:opacity-100 transition-opacity flex gap-1">
                                                        <Tip content={t('characterPanel.toggleAll', '폴더 내 전체 활성화/비활성화')}>
                                                            <Button
                                                                size="icon"
                                                                variant="ghost"
                                                                className="h-7 w-7"
                                                                onClick={() => toggleGroupEnabled(group.id)}
                                                            >
                                                                <Eye className="w-4 h-4" />
                                                            </Button>
                                                        </Tip>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7"
                                                            onClick={() => {
                                                                setEditingGroupId(group.id)
                                                                setEditingGroupName(group.name)
                                                            }}
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7 text-destructive hover:text-destructive"
                                                            onClick={() => deleteGroup(group.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                {/* Folder Contents */}
                                                {!group.collapsed && (
                                                    <SortableContext
                                                        items={chars.map(c => c.id)}
                                                        strategy={verticalListSortingStrategy}
                                                    >
                                                    <div className={cn("pl-5 border-l-2 ml-2 space-y-1.5 min-h-[32px] pb-2", folderColor.border)}>
                                                        {chars.map((char) => {
                                                            const index = characters.findIndex(c => c.id === char.id)
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
                                                        })}
                                                    </div>
                                                    </SortableContext>
                                                )}
                                            </DroppableFolder>
                                        )})}   

                                        {/* Ungrouped Characters */}
                                        <DroppableUngrouped isActive={activeId !== null} hasGroups={groups.length > 0}>
                                            <SortableContext
                                                items={ungroupedCharacters.map(c => c.id)}
                                                strategy={verticalListSortingStrategy}
                                            >
                                            {ungroupedCharacters.length > 0 && (
                                                <div className="min-w-0 space-y-1.5">
                                                    {groups.length > 0 && (
                                                        <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 py-1 px-2">
                                                            <Users className="w-4 h-4" />
                                                            {t('characterPanel.ungrouped', '미분류')}
                                                            <span className="text-xs opacity-50">
                                                                ({ungroupedCharacters.length})
                                                            </span>
                                                        </div>
                                                    )}
                                                    {ungroupedCharacters.map((char) => {
                                                        const index = characters.findIndex(c => c.id === char.id)
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
                                                                    onSelectVariant={activateVariant}
                                                            expertCharacterPromptVariantsEnabled={expertCharacterPromptVariantsEnabled}
                                                            />
                                                        )
                                                    })}
                                                </div>
                                            )}
                                            {ungroupedCharacters.length === 0 && groups.length > 0 && (
                                                <div className="text-sm font-medium text-muted-foreground flex items-center gap-2 py-1 px-2">
                                                    <Users className="w-4 h-4" />
                                                    {t('characterPanel.ungrouped', '미분류')}
                                                    <span className="text-xs opacity-50">(0)</span>
                                                </div>
                                            )}
                                            </SortableContext>
                                        </DroppableUngrouped>

                                {/* No Results */}
                                {ungroupedCharacters.length === 0 && groupedCharacters.every(g => g.chars.length === 0) && searchQuery && (
                                    <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-12">
                                        <div className="text-center">
                                            <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                                            <p>{t('characterPanel.noResults', '검색 결과가 없습니다')}</p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </ScrollArea>
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
    const { setNodeRef, isOver } = useDroppable({
        id: `folder-${folderId}`,
    })

    return (
        <div
            ref={setNodeRef}
            className={cn(
                "transition-all duration-200 rounded-lg",
                isActive && isCollapsed && "ring-2 ring-dashed ring-current/30",
                isOver && cn("ring-2 ring-current", colorClass)
            )}
        >
            {children}
        </div>
    )
}

// --- DroppableUngrouped Component ---
interface DroppableUngroupedProps {
    isActive: boolean
    hasGroups: boolean
    children: React.ReactNode
}

function DroppableUngrouped({ isActive, hasGroups, children }: DroppableUngroupedProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: 'ungrouped-zone',
    })

    if (!hasGroups) {
        return <>{children}</>
    }

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
function SortableCharacterCard(props: CharacterCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: props.character.id })

    const style: React.CSSProperties = {
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
            {...attributes}
        >
            <CharacterCard {...props} dragHandleProps={listeners} />
        </div>
    )
}

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
    groups: { id: string; name: string; collapsed: boolean }[]
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
                        className={cn(
                            "w-full min-w-0 max-w-full rounded-xl border border-border/50 bg-background/60 transition-all duration-200 overflow-hidden",
                            !character.enabled && "opacity-50"
                        )}
                    >
                        {/* Card Header - Drag Handle */}
                        <div
                            className="flex min-w-0 items-center gap-2.5 px-3 py-2.5 cursor-grab hover:bg-muted/50 transition-colors bg-muted/30 active:cursor-grabbing"
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

                            <span className="min-w-0 flex-1 text-sm font-medium truncate">
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
                                    <>
                                        <div className="min-w-0 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 text-xs font-medium">
                                                    <button
                                                        className={cn("px-2 py-1 rounded-md", activePromptTab === 'prompt' ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
                                                        onClick={() => setActivePromptTab('prompt')}
                                                    >{t('characterPanel.prompt', 'Prompt')}</button>
                                                    <button
                                                        className={cn("px-2 py-1 rounded-md", activePromptTab === 'negative' ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:bg-muted")}
                                                        onClick={() => setActivePromptTab('negative')}
                                                    >{t('characterPanel.negative', 'Negative')}</button>
                                                </div>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => activePromptTab === 'prompt' ? onUpdate({ promptEnabled: !promptEnabled }) : onUpdate({ negativeEnabled: !negativeEnabled })}>
                                                    {(activePromptTab === 'prompt' ? promptEnabled : negativeEnabled) ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                </Button>
                                            </div>
                                            {activePromptTab === 'prompt' ? (
                                                <AutocompleteTextarea
                                                    value={characterPrompt}
                                                    onChange={(e) => onUpdate({ prompt: joinCostumePrompt(e.target.value, costumePrompt) })}
                                                    placeholder={t('characterPanel.promptPlaceholder')}
                                                    className={cn("h-[150px] text-sm resize-none", !promptEnabled && "opacity-50")}
                                                    style={{ fontSize: `${promptFontSize}px` }}
                                                />
                                            ) : (
                                                <AutocompleteTextarea
                                                    value={character.negative}
                                                    onChange={(e) => onUpdate({ negative: e.target.value })}
                                                    placeholder={t('characterPanel.negativePlaceholder')}
                                                    className={cn("h-[150px] text-sm border-destructive/20 resize-none", !negativeEnabled && "opacity-50")}
                                                    style={{ fontSize: `${promptFontSize}px` }}
                                                />
                                            )}
                                        </div>
                                        <div className="min-w-0 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">{t('characterPanel.costume')}</label>
                                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onUpdate({ costumeEnabled: !costumeEnabled })}>
                                                    {costumeEnabled ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                                                </Button>
                                            </div>
                                            <AutocompleteTextarea
                                                value={costumePrompt}
                                                onChange={(e) => onUpdate({ prompt: joinCostumePrompt(characterPrompt, e.target.value) })}
                                                placeholder={t('characterPanel.costumePlaceholder')}
                                                className={cn("h-[110px] text-sm resize-none", !costumeEnabled && "opacity-50")}
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="min-w-0 space-y-1.5">
                                            <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                                                {t('characterPanel.prompt', 'Prompt')}
                                            </label>
                                            <AutocompleteTextarea
                                                value={character.prompt}
                                                onChange={(e) => onUpdate({ prompt: e.target.value })}
                                                placeholder={t('characterPanel.promptPlaceholder')}
                                                className="h-[180px] text-sm resize-none"
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />
                                        </div>
                                        <div className="min-w-0 space-y-1.5">
                                            <label className="text-xs font-medium text-destructive/70 whitespace-nowrap">
                                                {t('characterPanel.negative', 'Negative')}
                                            </label>
                                            <AutocompleteTextarea
                                                value={character.negative}
                                                onChange={(e) => onUpdate({ negative: e.target.value })}
                                                placeholder={t('characterPanel.negativePlaceholder')}
                                                className="h-[140px] text-sm border-destructive/20 resize-none"
                                                style={{ fontSize: `${promptFontSize}px` }}
                                            />
                                        </div>
                                    </>
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
                                        {group.name}
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

    const handleMouseDown = (e: MouseEvent, id: string) => {
        e.preventDefault()
        setDragging(id)
        setSelectedId(id)
    }

    const handleMouseMove = (e: MouseEvent) => {
        if (!dragging || !gridRef.current) return
        const rect = gridRef.current.getBoundingClientRect()
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        onPositionChange(dragging, x, y)
    }

    const handleMouseUp = () => {
        setDragging(null)
    }

    useEffect(() => {
        const handleGlobalMouseUp = () => setDragging(null)
        window.addEventListener('mouseup', handleGlobalMouseUp)
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
    }, [])

    const zones = [
        { label: '↖', x: 0.17, y: 0.15 },
        { label: '↑', x: 0.5, y: 0.15 },
        { label: '↗', x: 0.83, y: 0.15 },
        { label: '←', x: 0.17, y: 0.5 },
        { label: '●', x: 0.5, y: 0.5 },
        { label: '→', x: 0.83, y: 0.5 },
        { label: '↙', x: 0.17, y: 0.85 },
        { label: '↓', x: 0.5, y: 0.85 },
        { label: '↘', x: 0.83, y: 0.85 },
    ]

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
                    className="relative w-full aspect-[3/4] bg-muted/30 rounded-lg border cursor-crosshair select-none overflow-hidden shadow-inner"
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    {/* Grid lines */}
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                        {[...Array(9)].map((_, i) => (
                            <div key={i} className="border border-border/20" />
                        ))}
                    </div>

                    {/* Zone labels */}
                    {zones.map((zone, i) => (
                        <div
                            key={i}
                            className="absolute text-lg text-muted-foreground/30 pointer-events-none select-none"
                            style={{
                                left: `${zone.x * 100}%`,
                                top: `${zone.y * 100}%`,
                                transform: 'translate(-50%, -50%)'
                            }}
                        >
                            {zone.label}
                        </div>
                    ))}

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
