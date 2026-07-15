import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Dices, FolderTree, Search, Users } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { getCharacterGroupPath, useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
    getRandomCharacterCandidates,
    getRandomCharacterDisplayName,
    getRandomCharacterStackKey,
    type SceneRandomCharacterMode,
} from '@/lib/random-character-selection'

interface SceneRandomCharacterDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

const MODE_OPTIONS: { mode: SceneRandomCharacterMode; icon: typeof Dices; labelKey: string }[] = [
    { mode: 'all', icon: Dices, labelKey: 'sceneRandomCharacters.modeAll' },
    { mode: 'characters', icon: Users, labelKey: 'sceneRandomCharacters.modeCharacters' },
    { mode: 'folders', icon: FolderTree, labelKey: 'sceneRandomCharacters.modeFolders' },
]

export function SceneRandomCharacterDialog({ open, onOpenChange }: SceneRandomCharacterDialogProps) {
    const { t } = useTranslation()
    const characters = useCharacterPromptStore(state => state.characters)
    const groups = useCharacterPromptStore(state => state.groups)
    const active = useSettingsStore(state => state.sceneRandomCharactersActive)
    const mode = useSettingsStore(state => state.sceneRandomCharacterMode)
    const count = useSettingsStore(state => state.sceneRandomCharacterCount)
    const characterIds = useSettingsStore(state => state.sceneRandomCharacterIds)
    const groupIds = useSettingsStore(state => state.sceneRandomCharacterGroupIds)
    const updateConfig = useSettingsStore(state => state.setSceneRandomCharacterConfig)
    const [search, setSearch] = useState('')

    const allCandidates = useMemo(
        () => getRandomCharacterCandidates(characters, groups, 'all', [], []),
        [characters, groups],
    )
    const scopeCandidates = useMemo(
        () => getRandomCharacterCandidates(characters, groups, mode, characterIds, groupIds),
        [characters, groups, mode, characterIds, groupIds],
    )
    const charactersById = useMemo(
        () => new Map(characters.map(character => [character.id, character])),
        [characters],
    )
    const query = search.trim().toLowerCase()
    const filteredCandidates = useMemo(() => allCandidates.filter((character, index) => {
        if (!query) return true
        const name = getRandomCharacterDisplayName(character, index).toLowerCase()
        const groupPath = character.groupId ? getCharacterGroupPath(groups, character.groupId).toLowerCase() : ''
        return name.includes(query) || groupPath.includes(query)
    }), [allCandidates, groups, query])
    const orderedGroups = useMemo(() => {
        const childrenByParent = new Map<string, typeof groups>()
        for (const group of groups) {
            const parentKey = group.parentId || 'root'
            const siblings = childrenByParent.get(parentKey)
            if (siblings) siblings.push(group)
            else childrenByParent.set(parentKey, [group])
        }

        const ordered: { group: (typeof groups)[number], depth: number }[] = []
        const visited = new Set<string>()
        const appendChildren = (parentKey: string, depth: number) => {
            for (const group of childrenByParent.get(parentKey) || []) {
                if (visited.has(group.id)) continue
                visited.add(group.id)
                ordered.push({ group, depth })
                appendChildren(group.id, depth + 1)
            }
        }

        appendChildren('root', 0)
        for (const group of groups) {
            if (visited.has(group.id)) continue
            visited.add(group.id)
            ordered.push({ group, depth: 0 })
            appendChildren(group.id, 1)
        }
        return ordered
    }, [groups])
    const filteredGroups = useMemo(() => orderedGroups.filter(({ group }) => {
        if (!query) return true
        return getCharacterGroupPath(groups, group.id).toLowerCase().includes(query)
    }), [groups, orderedGroups, query])

    const isCharacterSelected = (characterId: string) => {
        const candidate = charactersById.get(characterId)
        if (!candidate) return false
        const stackKey = getRandomCharacterStackKey(candidate)
        return characterIds.some(id => {
            const selected = charactersById.get(id)
            return selected && getRandomCharacterStackKey(selected) === stackKey
        })
    }

    const toggleCharacter = (characterId: string) => {
        const candidate = charactersById.get(characterId)
        if (!candidate) return
        const stackKey = getRandomCharacterStackKey(candidate)
        const selected = isCharacterSelected(characterId)
        const nextIds = characterIds.filter(id => {
            const character = charactersById.get(id)
            return !character || getRandomCharacterStackKey(character) !== stackKey
        })
        updateConfig({ sceneRandomCharacterIds: selected ? nextIds : [...nextIds, characterId] })
    }

    const toggleGroup = (groupId: string) => {
        updateConfig({
            sceneRandomCharacterGroupIds: groupIds.includes(groupId)
                ? groupIds.filter(id => id !== groupId)
                : [...groupIds, groupId],
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Dices className="h-5 w-5 text-cyan-500" />
                        {t('sceneRandomCharacters.title')}
                    </DialogTitle>
                    <DialogDescription>{t('sceneRandomCharacters.description')}</DialogDescription>
                </DialogHeader>

                <div className="flex items-center justify-between gap-4 border-y border-border/40 py-3">
                    <div className="min-w-0">
                        <div className="text-sm font-medium">{t('sceneRandomCharacters.activeTitle')}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{t('sceneRandomCharacters.activeDesc')}</div>
                    </div>
                    <Switch
                        checked={active}
                        onChange={(event) => updateConfig({ sceneRandomCharactersActive: event.target.checked })}
                    />
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-md border border-border/50 bg-muted/20 p-1">
                    {MODE_OPTIONS.map(({ mode: optionMode, icon: Icon, labelKey }) => (
                        <Button
                            key={optionMode}
                            type="button"
                            size="sm"
                            variant={mode === optionMode ? 'secondary' : 'ghost'}
                            className="min-w-0 gap-2"
                            onClick={() => updateConfig({ sceneRandomCharacterMode: optionMode })}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{t(labelKey)}</span>
                        </Button>
                    ))}
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="text-sm font-medium">{t('sceneRandomCharacters.countTitle')}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            {t('sceneRandomCharacters.poolCount', { count: scopeCandidates.length })}
                        </div>
                    </div>
                    <Input
                        type="number"
                        min={1}
                        max={99}
                        value={count}
                        onChange={(event) => updateConfig({
                            sceneRandomCharacterCount: Math.max(1, Math.min(99, Number(event.target.value) || 1)),
                        })}
                        className="h-9 w-20 text-center"
                    />
                </div>

                {mode !== 'all' && (
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('sceneRandomCharacters.searchPlaceholder')}
                            className="pl-9"
                        />
                    </div>
                )}

                <ScrollArea className="flex-1 min-h-0 pr-3">
                    {mode === 'all' ? (
                        <div className="flex min-h-40 flex-col items-center justify-center border-y border-border/30 text-center">
                            <Dices className="h-9 w-9 text-cyan-500 mb-3" />
                            <div className="text-sm font-medium">{t('sceneRandomCharacters.allSummary', { count: allCandidates.length })}</div>
                            <div className="text-xs text-muted-foreground mt-1">{t('sceneRandomCharacters.stackHint')}</div>
                        </div>
                    ) : mode === 'characters' ? (
                        <div className="divide-y divide-border/30">
                            {filteredCandidates.map((character, index) => {
                                const checked = isCharacterSelected(character.id)
                                const groupPath = character.groupId ? getCharacterGroupPath(groups, character.groupId) : t('characterPanel.ungrouped')
                                return (
                                    <label key={character.id} className={cn(
                                        "flex items-center gap-3 px-2 py-2.5 cursor-pointer hover:bg-muted/35",
                                        checked && "bg-primary/5",
                                    )}>
                                        <Checkbox checked={checked} onCheckedChange={() => toggleCharacter(character.id)} />
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium">{getRandomCharacterDisplayName(character, index)}</div>
                                            <div className="truncate text-xs text-muted-foreground">{groupPath}</div>
                                        </div>
                                    </label>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {filteredGroups.map(({ group, depth }) => {
                                const checked = groupIds.includes(group.id)
                                return (
                                    <label key={group.id} className={cn(
                                        "flex items-center gap-3 px-2 py-3 cursor-pointer hover:bg-muted/35",
                                        checked && "bg-primary/5",
                                    )} style={{ paddingLeft: 8 + depth * 16 }}>
                                        <Checkbox checked={checked} onCheckedChange={() => toggleGroup(group.id)} />
                                        <FolderTree className="h-4 w-4 shrink-0 text-amber-500" />
                                        <span className="min-w-0 truncate text-sm">{getCharacterGroupPath(groups, group.id)}</span>
                                    </label>
                                )
                            })}
                        </div>
                    )}
                </ScrollArea>

                {scopeCandidates.length === 0 && mode !== 'all' && (
                    <div className="flex items-center gap-2 border-t border-destructive/30 pt-3 text-xs text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {t('sceneRandomCharacters.emptyWarning')}
                    </div>
                )}
                <div className="text-xs text-muted-foreground border-t border-border/30 pt-3">
                    {t('sceneRandomCharacters.queuePriority')}
                </div>
            </DialogContent>
        </Dialog>
    )
}
