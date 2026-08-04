import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2, UserRoundPlus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { getCharacterGender } from '@/lib/character-gender'
import { joinSceneCharacterCostumePrompt, splitSceneCharacterCostumePrompt } from '@/lib/scene-character-prompts'
import { useSettingsStore } from '@/stores/settings-store'
import { useSceneStore, SceneCharacterAddition, SceneCustomCharacter } from '@/stores/scene-store'

interface SceneCustomCharacterDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    presetId: string | null
    sceneId: string | null
}

const emptyAddition: SceneCharacterAddition = {
    characterPromptIds: [],
    characterReferenceIds: [],
    vibeReferenceIds: [],
}

const createCustomCharacter = (): SceneCustomCharacter => ({
    id: crypto.randomUUID(),
    name: '',
    prompt: '',
    negative: '',
    enabled: true,
    promptEnabled: true,
    negativeEnabled: true,
    costumeEnabled: true,
})

export function SceneCustomCharacterDialog({
    open,
    onOpenChange,
    presetId,
    sceneId,
}: SceneCustomCharacterDialogProps) {
    const { t } = useTranslation()
    const addition = useSceneStore(state => {
        if (!presetId || !sceneId) return null
        return state.sceneCharacterAdditions[presetId]?.[sceneId] || null
    })
    const updateAddition = useSceneStore(state => state.updateSceneCharacterAddition)
    const clearAddition = useSceneStore(state => state.clearSceneCharacterAddition)
    const sceneName = useSceneStore(state => state.presets
        .find(preset => preset.id === presetId)
        ?.scenes.find(scene => scene.id === sceneId)?.name)

    const current = addition || emptyAddition
    const customCharacters = current.customCharacters || []
    const save = (next: SceneCustomCharacter[]) => {
        if (!presetId || !sceneId) return
        updateAddition(presetId, sceneId, {
            ...current,
            mode: 'custom',
            customCharacters: next,
        })
    }
    const update = (id: string, updates: Partial<SceneCustomCharacter>) => {
        save(customCharacters.map(character => character.id === id ? { ...character, ...updates } : character))
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[86vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('sceneCharacterAddition.npcTitle', 'NPC Characters')}</DialogTitle>
                    <DialogDescription>
                        {sceneName ? `${sceneName} · ` : ''}{t('sceneCharacterAddition.npcDescription', 'Add prompt-only NPCs for this scene.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    {customCharacters.map((character, index) => (
                        <SceneCustomCharacterCard
                            key={character.id}
                            character={character}
                            index={index}
                            onUpdate={(updates) => update(character.id, updates)}
                            onRemove={() => save(customCharacters.filter(item => item.id !== character.id))}
                        />
                    ))}

                    <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => save([...customCharacters, createCustomCharacter()])}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('sceneCharacterAddition.addNpc', 'Add NPC')}
                    </Button>
                    {customCharacters.length > 0 && (
                        <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={() => clearAddition(presetId!, sceneId!)}>
                            {t('sceneCharacterAddition.clear', 'Clear')}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function SceneCustomCharacterCard({
    character,
    index,
    onUpdate,
    onRemove,
}: {
    character: SceneCustomCharacter
    index: number
    onUpdate: (updates: Partial<SceneCustomCharacter>) => void
    onRemove: () => void
}) {
    const { t } = useTranslation()
    const promptFontSize = useSettingsStore(state => state.promptFontSize)
    const genderIndicatorEnabled = useSettingsStore(state => state.expertCharacterPromptGenderIndicatorEnabled)
    const genderIndicatorMode = useSettingsStore(state => state.characterPromptGenderIndicatorMode)
    const [expanded, setExpanded] = useState(true)
    const [activePromptTab, setActivePromptTab] = useState<'prompt' | 'negative'>('prompt')
    const { characterPrompt, costumePrompt } = splitSceneCharacterCostumePrompt(character.prompt)
    const promptEnabled = character.promptEnabled ?? true
    const negativeEnabled = character.negativeEnabled ?? true
    const costumeEnabled = character.costumeEnabled ?? true
    const gender = genderIndicatorEnabled ? getCharacterGender(characterPrompt) : 'unknown'
    const genderHeaderClass = genderIndicatorMode === 'header'
        ? gender === 'male' ? 'bg-blue-500/15' : gender === 'female' ? 'bg-pink-500/15' : 'bg-muted/30'
        : 'bg-muted/30'

    return (
        <section className={cn('overflow-hidden rounded-xl border border-border/50 bg-background/60', character.enabled === false && 'opacity-50')}>
            <div className={cn('flex items-center gap-2.5 px-3 py-2.5', genderHeaderClass)}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setExpanded(value => !value)}>
                    <div className={cn(
                        'flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg',
                        genderIndicatorMode === 'icon' && gender === 'male' ? 'bg-blue-500/15 text-blue-400' :
                            genderIndicatorMode === 'icon' && gender === 'female' ? 'bg-pink-500/15 text-pink-400' : 'bg-primary/10 text-primary',
                    )}>
                        <UserRoundPlus className="h-4 w-4" />
                    </div>
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-muted-foreground/20 text-[11px] font-semibold text-muted-foreground">{index + 1}</span>
                </button>
                <Input
                    value={character.name}
                    placeholder={t('sceneCharacterAddition.npcName', 'NPC name')}
                    onChange={event => onUpdate({ name: event.target.value })}
                    onClick={event => event.stopPropagation()}
                    className="h-8 min-w-0 flex-1"
                />
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onUpdate({ enabled: character.enabled === false })}>
                    {character.enabled === false ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-primary" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={onRemove}>
                    <Trash2 className="h-4 w-4" />
                </Button>
                <button type="button" className="shrink-0 text-muted-foreground" onClick={() => setExpanded(value => !value)}>
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
            </div>

            {expanded && (
                <div className="flex h-[332px] min-w-0 flex-col gap-3 border-t border-border/30 bg-background/40 px-3 py-3">
                    <div className="flex min-h-0 flex-[150] flex-col">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-xs font-medium">
                                <button type="button" className={cn('rounded-md px-2 py-1', activePromptTab === 'prompt' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted')} onClick={() => setActivePromptTab('prompt')}>
                                    {t('characterPanel.prompt', 'Prompt')}
                                </button>
                                <button type="button" className={cn('rounded-md px-2 py-1', activePromptTab === 'negative' ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:bg-muted')} onClick={() => setActivePromptTab('negative')}>
                                    {t('characterPanel.negative', 'Negative')}
                                </button>
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => activePromptTab === 'prompt' ? onUpdate({ promptEnabled: !promptEnabled }) : onUpdate({ negativeEnabled: !negativeEnabled })}>
                                {(activePromptTab === 'prompt' ? promptEnabled : negativeEnabled) ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                        </div>
                        {activePromptTab === 'prompt' ? (
                            <AutocompleteTextarea
                                value={characterPrompt}
                                onChange={event => onUpdate({ prompt: joinSceneCharacterCostumePrompt(event.target.value, costumePrompt) })}
                                placeholder={t('characterPanel.promptPlaceholder')}
                                className={cn('mt-1.5 min-h-0 flex-1 resize-none text-sm', !promptEnabled && 'opacity-50')}
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        ) : (
                            <AutocompleteTextarea
                                value={character.negative}
                                onChange={event => onUpdate({ negative: event.target.value })}
                                placeholder={t('characterPanel.negativePlaceholder')}
                                className={cn('mt-1.5 min-h-0 flex-1 resize-none border-destructive/20 text-sm', !negativeEnabled && 'opacity-50')}
                                style={{ fontSize: `${promptFontSize}px` }}
                            />
                        )}
                    </div>
                    <div className="flex min-h-0 flex-[110] flex-col">
                        <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                            <span>{t('characterPanel.costume')}</span>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => onUpdate({ costumeEnabled: !costumeEnabled })}>
                                {costumeEnabled ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
                            </Button>
                        </div>
                        <AutocompleteTextarea
                            value={costumePrompt}
                            onChange={event => onUpdate({ prompt: joinSceneCharacterCostumePrompt(characterPrompt, event.target.value) })}
                            placeholder={t('characterPanel.costumePlaceholder')}
                            className={cn('mt-1.5 min-h-0 flex-1 resize-none text-sm', !costumeEnabled && 'opacity-50')}
                            style={{ fontSize: `${promptFontSize}px` }}
                        />
                    </div>
                </div>
            )}
        </section>
    )
}
