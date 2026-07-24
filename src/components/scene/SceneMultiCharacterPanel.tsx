import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Plus, Trash2, UserRound, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { useCharacterPromptStore, type CharacterPrompt } from '@/stores/character-prompt-store'
import { type SceneMultiCharacterSlot } from '@/stores/scene-store'
import { cn } from '@/lib/utils'

interface SceneMultiCharacterPanelProps {
    slots: SceneMultiCharacterSlot[]
    onChange: (slots: SceneMultiCharacterSlot[]) => void
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

export function SceneMultiCharacterPanel({ slots, onChange, embedded = false }: SceneMultiCharacterPanelProps) {
    const { t } = useTranslation()
    const characters = useCharacterPromptStore(state => state.characters)
    const activeCharacters = useMemo(() => characters.filter(character => character.enabled), [characters])

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
                        <div key={slot.id} className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                            <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                    <div className={cn(
                                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                                        slot.target === 'gender' && slot.gender === 'male' && 'bg-blue-500/15 text-blue-400',
                                        slot.target === 'gender' && slot.gender === 'female' && 'bg-pink-500/15 text-pink-400',
                                        (slot.target === 'manual' || slot.gender === 'unknown') && 'bg-muted text-muted-foreground',
                                    )}>
                                        {slot.target === 'manual' ? <Link2 className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                                    </div>
                                    <span className="truncate text-sm font-medium">{getSlotTitle(slot, index)}</span>
                                </div>
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

                            <div className="grid gap-2 sm:grid-cols-2">
                                <Select
                                    value={slot.target}
                                    onValueChange={(value: SceneMultiCharacterSlot['target']) => updateSlot(slot.id, value === 'manual'
                                        ? { target: value, gender: undefined }
                                        : { target: value, characterId: undefined, gender: slot.gender || 'male' }
                                    )}
                                >
                                    <SelectTrigger className="h-8 rounded-md text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="gender">{t('sceneMultiCharacter.autoTarget')}</SelectItem>
                                        <SelectItem value="manual">{t('sceneMultiCharacter.manualTarget')}</SelectItem>
                                    </SelectContent>
                                </Select>

                                {slot.target === 'gender' ? (
                                    <Select
                                        value={slot.gender || 'unknown'}
                                        onValueChange={(value) => updateSlot(slot.id, { gender: value as NonNullable<SceneMultiCharacterSlot['gender']> })}
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

                            <div className="mt-2">
                                <div className="mb-1 text-[11px] font-medium text-muted-foreground">{t('sceneMultiCharacter.prompt')}</div>
                                <AutocompleteTextarea
                                    value={slot.prompt}
                                    onChange={(event) => updateSlot(slot.id, { prompt: event.target.value })}
                                    placeholder={t('sceneMultiCharacter.promptPlaceholder')}
                                    className="min-h-[72px] rounded-md text-sm"
                                    maxSuggestions={8}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}
