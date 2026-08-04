import { Plus, Trash2, UserRoundPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
                        <section key={character.id} className="rounded-lg border bg-muted/20 p-3">
                            <div className="mb-3 flex items-center gap-2">
                                <UserRoundPlus className="h-4 w-4 shrink-0 text-primary" />
                                <Input
                                    value={character.name}
                                    placeholder={t('sceneCharacterAddition.npcName', 'NPC name')}
                                    onChange={event => update(character.id, { name: event.target.value })}
                                    className="h-8 max-w-xs"
                                />
                                <span className="text-xs text-muted-foreground">#{index + 1}</span>
                                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                                    <Checkbox
                                        checked={character.enabled !== false}
                                        onCheckedChange={checked => update(character.id, { enabled: checked === true })}
                                    />
                                    {t('sceneCharacterAddition.enabled', 'Enabled')}
                                </label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                    onClick={() => save(customCharacters.filter(item => item.id !== character.id))}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                                <Textarea
                                    value={character.prompt}
                                    placeholder={t('sceneCharacterAddition.npcPrompt', 'Character prompt')}
                                    onChange={event => update(character.id, { prompt: event.target.value })}
                                    className="min-h-36 resize-y"
                                />
                                <Textarea
                                    value={character.negative}
                                    placeholder={t('sceneCharacterAddition.npcNegative', 'Character negative prompt')}
                                    onChange={event => update(character.id, { negative: event.target.value })}
                                    className="min-h-36 resize-y"
                                />
                            </div>
                        </section>
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
