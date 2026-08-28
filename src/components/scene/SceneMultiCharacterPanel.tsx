import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Eye, EyeOff, Link2, MapPin, Plus, Trash2, UserRound, UsersRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { CHARACTER_COLORS, useCharacterPromptStore, type CharacterPrompt } from '@/stores/character-prompt-store'
import { useSettingsStore } from '@/stores/settings-store'
import { type SceneMultiCharacterSlot } from '@/stores/scene-store'
import { cn } from '@/lib/utils'
import { getCharacterPositionBoardAspectRatio } from '@/lib/character-position-grid'
import { CharacterPositionBoard } from '@/components/character/CharacterPositionBoard'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

interface SceneMultiCharacterPanelProps {
    slots: SceneMultiCharacterSlot[]
    onChange: (slots: SceneMultiCharacterSlot[]) => void
    width?: number
    height?: number
    embedded?: boolean
}

const VARIANT_NAME_PATTERN = /\s-\s([a-z0-9]{6})\s-\s(\d+)$/i
const LEGACY_VARIANT_HASH_PATTERN = /\s-\s([a-z0-9]{6})$/i

const cleanCharacterName = (character: CharacterPrompt, fallbackIndex: number) => {
    const name = character.name?.trim() || ''
    const variant = name.match(VARIANT_NAME_PATTERN)
    if (variant) return name.slice(0, variant.index).trim()
    const legacy = name.match(LEGACY_VARIANT_HASH_PATTERN)
    if (legacy) return name.slice(0, legacy.index).trim()
    return name || character.prompt.split(',')[0]?.trim() || `Character ${fallbackIndex + 1}`
}

export function SceneMultiCharacterPanel({ slots, onChange, width, height, embedded = false }: SceneMultiCharacterPanelProps) {
    const { t } = useTranslation()
    const characters = useCharacterPromptStore(state => state.characters)
    const genderSelectionMode = useSettingsStore(state => state.sceneMultiCharacterGenderSelectionMode)
    const positionMode = useSettingsStore(state => state.characterPositionMode)
    const setPositionMode = useSettingsStore(state => state.setCharacterPositionMode)
    const activeCharacters = useMemo(() => characters.filter(character => character.enabled), [characters])
    const [positionBoardOpen, setPositionBoardOpen] = useState(false)
    const [selectedPositionSlotId, setSelectedPositionSlotId] = useState<string | null>(null)
    const [draftPositions, setDraftPositions] = useState<Record<string, { x: number, y: number }>>({})
    const [collapsedSlotIds, setCollapsedSlotIds] = useState<Set<string>>(new Set())
    const boardAspectRatio = getCharacterPositionBoardAspectRatio(width ?? 832, height ?? 1216)

    const genderLabel = (gender: SceneMultiCharacterSlot['gender']) => {
        if (gender === 'male') return t('sceneMultiCharacter.male')
        if (gender === 'female') return t('sceneMultiCharacter.female')
        return t('sceneMultiCharacter.other')
    }

    const getSlotTitle = (slot: SceneMultiCharacterSlot, index: number) => {
        if (slot.target === 'manual') {
            const characterIndex = characters.findIndex(character => character.id === slot.characterId)
            return characterIndex >= 0
                ? cleanCharacterName(characters[characterIndex], characterIndex)
                : t('sceneMultiCharacter.manualTarget')
        }
        const sameGenderIndex = slots.slice(0, index + 1)
            .filter(candidate => candidate.target === 'gender' && candidate.gender === slot.gender)
            .length
        return `${genderLabel(slot.gender)} ${sameGenderIndex}`
    }

    const updateSlot = (id: string, updates: Partial<SceneMultiCharacterSlot>) => {
        onChange(slots.map(slot => slot.id === id ? { ...slot, ...updates } : slot))
    }

    const updateDraftPosition = useCallback((id: string, x: number, y: number) => {
        setDraftPositions(current => ({ ...current, [id]: { x, y } }))
    }, [])

    const commitPosition = useCallback((id: string, x: number, y: number) => {
        onChange(slots.map(slot => slot.id === id ? { ...slot, position: { x, y } } : slot))
        setDraftPositions(current => {
            const next = { ...current }
            delete next[id]
            return next
        })
    }, [onChange, slots])

    const cycleGender = (id: string, gender: NonNullable<SceneMultiCharacterSlot['gender']>) => {
        const nextGender = gender === 'male' ? 'female' : gender === 'female' ? 'unknown' : 'male'
        updateSlot(id, { gender: nextGender })
    }

    const toggleSlotCollapsed = (id: string) => {
        setCollapsedSlotIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const addSlot = () => {
        const maleSlots = slots.filter(slot => slot.target === 'gender' && slot.gender === 'male').length
        const femaleSlots = slots.filter(slot => slot.target === 'gender' && slot.gender === 'female').length
        onChange([...slots, {
            id: crypto.randomUUID(),
            target: 'gender',
            gender: maleSlots <= femaleSlots ? 'male' : 'female',
            prompt: '',
        }])
    }

    const positionSlots = slots.filter(slot => slot.enabled !== false)
    const selectedPositionSlot = positionSlots.find(slot => slot.id === selectedPositionSlotId) || positionSlots[0]

    return (
        <section className={cn(
            'min-w-0',
            !embedded && 'shrink-0 rounded-xl border border-border/60 bg-muted/20 p-3',
        )}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <UsersRound className="h-4 w-4 text-primary" />
                        {t('sceneMultiCharacter.title')}
                        {slots.length > 0 && <span className="text-xs font-normal text-muted-foreground">{slots.length}</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t('sceneMultiCharacter.description')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn('h-8 w-8', positionSlots.some(slot => slot.position) && 'text-primary')}
                        disabled={positionSlots.length === 0}
                        onClick={() => setPositionBoardOpen(true)}
                        title={t('sceneMultiCharacter.position')}
                        aria-label={t('sceneMultiCharacter.position')}
                    >
                        <MapPin className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg" onClick={addSlot}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        {t('sceneMultiCharacter.add')}
                    </Button>
                </div>
            </div>

            {slots.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                    {t('sceneMultiCharacter.empty')}
                </div>
            ) : (
                <div className="mt-3 space-y-2.5">
                    {slots.map((slot, index) => (
                        <div key={slot.id} className={cn('rounded-lg border border-border/60 bg-background/50 p-2.5', slot.enabled === false && 'opacity-50')}>
                            {(() => {
                                const isCollapsed = collapsedSlotIds.has(slot.id)
                                return <>
                            <div className="flex items-center gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    {slot.target === 'gender' && genderSelectionMode === 'portrait' ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className={cn(
                                                'h-7 w-7 shrink-0 rounded-md',
                                                slot.gender === 'male' && 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25',
                                                slot.gender === 'female' && 'bg-pink-500/15 text-pink-400 hover:bg-pink-500/25',
                                                slot.gender === 'unknown' && 'bg-muted text-muted-foreground',
                                            )}
                                            onClick={() => cycleGender(slot.id, slot.gender || 'unknown')}
                                            disabled={slot.enabled === false}
                                            title={t('sceneMultiCharacter.cycleGender')}
                                            aria-label={t('sceneMultiCharacter.cycleGender')}
                                        >
                                            <UserRound className="h-3.5 w-3.5" />
                                        </Button>
                                    ) : (
                                        <div className={cn(
                                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                                            slot.target === 'gender' && slot.gender === 'male' && 'bg-blue-500/15 text-blue-400',
                                            slot.target === 'gender' && slot.gender === 'female' && 'bg-pink-500/15 text-pink-400',
                                            (slot.target === 'manual' || slot.gender === 'unknown') && 'bg-muted text-muted-foreground',
                                        )}>
                                            {slot.target === 'manual' ? <Link2 className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                                        </div>
                                    )}
                                    <span className="truncate text-sm font-medium">{getSlotTitle(slot, index)}</span>
                                </div>
                                <Select
                                    value={slot.target}
                                    onValueChange={(value: SceneMultiCharacterSlot['target']) => updateSlot(slot.id, value === 'manual'
                                        ? { target: value, gender: undefined }
                                        : { target: value, characterId: undefined, gender: slot.gender || 'male' }
                                    )}
                                    disabled={slot.enabled === false}
                                >
                                    <SelectTrigger className="ml-auto h-7 w-[116px] shrink-0 rounded-md text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="gender">{t('sceneMultiCharacter.autoTarget')}</SelectItem>
                                        <SelectItem value="manual">{t('sceneMultiCharacter.manualTarget')}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={() => updateSlot(slot.id, { enabled: slot.enabled === false })}
                                    title={slot.enabled === false ? t('sceneMultiCharacter.enable') : t('sceneMultiCharacter.disable')}
                                    aria-label={slot.enabled === false ? t('sceneMultiCharacter.enable') : t('sceneMultiCharacter.disable')}
                                >
                                    {slot.enabled === false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    onClick={() => toggleSlotCollapsed(slot.id)}
                                    aria-label={isCollapsed ? 'Expand character' : 'Collapse character'}
                                >
                                    {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => onChange(slots.filter(candidate => candidate.id !== slot.id))}
                                    aria-label={t('sceneMultiCharacter.remove')}
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>

                            {!isCollapsed && <>
                            {(slot.target === 'manual' || genderSelectionMode === 'dropdown') && (
                                <div className="mt-2">
                                {slot.target === 'gender' ? (
                                    <Select
                                        value={slot.gender || 'unknown'}
                                        onValueChange={(value) => updateSlot(slot.id, { gender: value as NonNullable<SceneMultiCharacterSlot['gender']> })}
                                        disabled={slot.enabled === false}
                                    >
                                        <SelectTrigger className="h-8 rounded-md text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="male">{t('sceneMultiCharacter.male')}</SelectItem>
                                            <SelectItem value="female">{t('sceneMultiCharacter.female')}</SelectItem>
                                            <SelectItem value="unknown">{t('sceneMultiCharacter.other')}</SelectItem>
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Select
                                        value={slot.characterId || 'none'}
                                        onValueChange={(value) => updateSlot(slot.id, { characterId: value === 'none' ? undefined : value })}
                                        disabled={slot.enabled === false}
                                    >
                                        <SelectTrigger className="h-8 rounded-md text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="none">{t('sceneMultiCharacter.selectCharacter')}</SelectItem>
                                            {activeCharacters.map(character => {
                                                const characterIndex = characters.findIndex(candidate => candidate.id === character.id)
                                                return <SelectItem key={character.id} value={character.id}>{cleanCharacterName(character, characterIndex)}</SelectItem>
                                            })}
                                        </SelectContent>
                                    </Select>
                                )}
                                </div>
                            )}

                            <div className="mt-2">
                                <AutocompleteTextarea
                                    value={slot.prompt}
                                    onChange={(event) => updateSlot(slot.id, { prompt: event.target.value })}
                                    placeholder={t('sceneMultiCharacter.promptPlaceholder')}
                                    className="!h-[96px] min-h-0 rounded-md text-sm"
                                    maxSuggestions={8}
                                    disabled={slot.enabled === false}
                                />
                            </div>
                            </>}
                                </>
                            })()}
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={positionBoardOpen} onOpenChange={setPositionBoardOpen}>
                <DialogContent className="!w-auto !max-w-none bg-muted/80 p-0 shadow-2xl [&>button]:hidden">
                    <DialogTitle className="sr-only">{t('sceneMultiCharacter.position')}</DialogTitle>
                    <div className="relative">
                        <CharacterPositionBoard
                            aspectRatio={boardAspectRatio}
                            mode={positionMode}
                            className="h-[min(68vh,620px)] !w-auto max-w-[calc(100vw-2rem)] rounded-none border-0 bg-transparent shadow-none"
                            markerClassName="h-9 w-9 text-sm"
                            gridClassName="border-white/40"
                            markers={positionSlots.map((slot, index) => ({
                                id: slot.id,
                                label: String(index + 1),
                                position: draftPositions[slot.id] || slot.position || { x: 0.5, y: 0.5 },
                                color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
                            }))}
                            selectedId={selectedPositionSlot?.id || null}
                            onSelectedIdChange={setSelectedPositionSlotId}
                            onPositionChange={updateDraftPosition}
                            onPositionCommit={commitPosition}
                        />
                        <div className="absolute left-0 top-[calc(100%+12px)] flex w-full flex-wrap items-center gap-2">
                            <div className="flex rounded-full bg-black/90 p-1 shadow-lg">
                                {(['grid', 'free'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={cn(
                                            'h-8 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors',
                                            positionMode === mode ? 'bg-white text-black' : 'text-white/70 hover:text-white',
                                        )}
                                        onClick={() => setPositionMode(mode)}
                                    >
                                        {mode === 'grid' ? t('characterPanel.positionGrid') : t('characterPanel.positionFree')}
                                    </button>
                                ))}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                                {positionSlots.map((slot, index) => (
                                    <Button
                                        key={slot.id}
                                        type="button"
                                        variant={selectedPositionSlot?.id === slot.id ? 'secondary' : 'ghost'}
                                        size="sm"
                                        className="h-7 max-w-full gap-1 bg-black/80 px-2 text-xs text-white hover:bg-black hover:text-white"
                                        onClick={() => setSelectedPositionSlotId(slot.id)}
                                        title={getSlotTitle(slot, slots.indexOf(slot))}
                                    >
                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: CHARACTER_COLORS[index % CHARACTER_COLORS.length] }} />
                                        <span className="max-w-40 truncate">{getSlotTitle(slot, slots.indexOf(slot))}</span>
                                    </Button>
                                ))}
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 bg-black/80 text-xs text-white hover:bg-black hover:text-white"
                                disabled={!selectedPositionSlot?.position}
                                onClick={() => selectedPositionSlot && updateSlot(selectedPositionSlot.id, { position: undefined })}
                            >
                                {t('sceneMultiCharacter.clearPosition')}
                            </Button>
                        </div>
                        <div className="absolute bottom-[calc(100%+12px)] right-0">
                            <DialogClose className="flex h-10 w-10 items-center justify-center rounded-full bg-black/90 text-white hover:bg-black">
                                <X className="h-5 w-5" />
                                <span className="sr-only">{t('common.close')}</span>
                            </DialogClose>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    )
}
