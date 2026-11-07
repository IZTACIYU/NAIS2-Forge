import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open as chooseDirectory } from '@tauri-apps/plugin-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ImageOutputOptions, type ImageOutputFormat } from '@/components/ui/image-output-options'
import { useSettingsStore } from '@/stores/settings-store'
import type { SceneCard } from '@/stores/scene-store'
import { collectSceneCharacterNames, type SceneCharacterIndex } from '@/lib/scene-character-groups'
import { indexSceneCharacters } from '@/services/scene-character-images'
import { exportCharacterScenes } from '@/services/character-scene-export'

export function CharacterZipDialog({ open, onOpenChange, scenes }: { open: boolean; onOpenChange: (open: boolean) => void; scenes: SceneCard[] }) {
    const { t } = useTranslation()
    const [format, setFormat] = useState<ImageOutputFormat>('png')
    const [quality, setQuality] = useState(90)
    const [names, setNames] = useState<string[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [exporting, setExporting] = useState(false)
    const [status, setStatus] = useState('')
    const snapshot = useRef<SceneCard[]>([])
    const index = useRef<SceneCharacterIndex>(new Map())
    const mounted = useRef(true)
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
    useEffect(() => {
        if (!open) return
        let active = true
        const settings = useSettingsStore.getState()
        setFormat(settings.exportImageFormat); setQuality(settings.exportWebpQuality)
        setNames([]); setSelected(new Set()); setQuery(''); setStatus(''); setLoading(true)
        snapshot.current = scenes.map(scene => ({ ...scene, images: [...scene.images] }))
        index.current = new Map()
        const cache = index.current
        const source = snapshot.current
        void indexSceneCharacters(source.slice(0, 4), cache, () => active).then(() => {
            if (!active) return
            const characters = collectSceneCharacterNames(source, cache)
            setNames(characters); setSelected(new Set(characters)); setLoading(false)
        })
        return () => { active = false }
        // An export uses the scene snapshot captured on entry, not live generation updates.
    }, [open])

    const runExport = async () => {
        if (exporting || loading || !selected.size) return
        setExporting(true); setStatus(t('scenePrivate.reading'))
        try {
            const directory = await chooseDirectory({ directory: true, multiple: false })
            if (typeof directory !== 'string') return
            const settings = useSettingsStore.getState()
            const result = await exportCharacterScenes({
                scenes: snapshot.current, index: index.current, selected: new Set(selected), directory, format, quality,
                stacks: settings.consoleSceneStacksEnabled === true,
                namingEnabled: settings.expertSceneExportNameEnabled, namePart: settings.sceneExportNamePart,
                shouldContinue: () => mounted.current,
                onProgress: (name, current, total, percent) => {
                    if (mounted.current) setStatus(`${current}/${total} ${name} — ${percent}%`)
                },
            })
            if (mounted.current) setStatus(t('scenePrivate.exportResult', result))
        } catch (error) {
            if (mounted.current) setStatus(t('scenePrivate.exportError', { error: String(error) }))
        } finally { if (mounted.current) setExporting(false) }
    }

    return <Dialog open={open} onOpenChange={value => !exporting && onOpenChange(value)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto" onKeyDown={event => event.stopPropagation()} onEscapeKeyDown={event => { if (exporting) event.preventDefault() }}>
            <DialogHeader><DialogTitle>C.zip</DialogTitle></DialogHeader>
            <ImageOutputOptions format={format} quality={quality} onFormatChange={setFormat} onQualityChange={setQuality} disabled={exporting} />
            <p className="text-xs text-muted-foreground">{t('scenePrivate.firstFour')}</p>
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('scenePrivate.search')} aria-label={t('scenePrivate.search')} disabled={exporting} />
            <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={loading || exporting} onClick={() => setSelected(new Set(names))}>{t('scenePrivate.selectAll')}</Button>
                <Button size="sm" variant="outline" disabled={loading || exporting} onClick={() => setSelected(new Set())}>{t('scenePrivate.selectNone')}</Button>
                <span className="ml-auto text-sm text-muted-foreground">{selected.size}/{names.length}</span>
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto">
                {loading ? <p role="status">{t('scenePrivate.reading')}</p> : !names.length ? <p>{t('scenePrivate.noCharacters')}</p> : names.filter(name => name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(name =>
                    <label key={name} className="flex min-w-0 items-center gap-2 text-sm">
                        <Checkbox checked={selected.has(name)} disabled={exporting} onCheckedChange={checked => setSelected(previous => {
                            const next = new Set(previous); if (checked === true) next.add(name); else next.delete(name); return next
                        })} />
                        <span className="break-all">{name}</span>
                    </label>,
                )}
            </div>
            <p role="status" className="break-words text-xs text-muted-foreground">{status}</p>
            <Button disabled={loading || exporting || !selected.size} onClick={() => void runExport()}>{t('scenePrivate.exportAll')}</Button>
        </DialogContent>
    </Dialog>
}
