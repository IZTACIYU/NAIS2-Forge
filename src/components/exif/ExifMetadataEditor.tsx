import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { PngTextMetadata } from '@/lib/png-metadata-editor'

type JsonObject = Record<string, unknown>

interface ExifMetadataEditorProps {
    metadata: PngTextMetadata | null
    onChange: (metadata: PngTextMetadata) => void
    onRawJsonValidityChange: (valid: boolean) => void
}

const parseComment = (metadata: PngTextMetadata | null): JsonObject | null => {
    if (!metadata?.Comment) return {}
    try {
        const parsed = JSON.parse(metadata.Comment)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null
    } catch {
        return null
    }
}

const stringifyComment = (comment: JsonObject) => JSON.stringify(comment)
const updateText = (metadata: PngTextMetadata, key: string, value: string) => ({ ...metadata, [key]: value })

const readCaptionCharacters = (comment: JsonObject, negative = false) => {
    const root = comment[negative ? 'v4_negative_prompt' : 'v4_prompt'] as JsonObject | undefined
    const caption = root?.caption as JsonObject | undefined
    const characters = caption?.char_captions
    return Array.isArray(characters) ? characters as JsonObject[] : []
}

const updateCharacterCaption = (comment: JsonObject, index: number, negative: boolean, value: string) => {
    const promptKey = negative ? 'v4_negative_prompt' : 'v4_prompt'
    const root = { ...((comment[promptKey] as JsonObject | undefined) || {}) }
    const caption = { ...((root.caption as JsonObject | undefined) || {}) }
    const characters = [...readCaptionCharacters(comment, negative)]
    characters[index] = { ...characters[index], char_caption: value }
    caption.char_captions = characters
    root.caption = caption
    return { ...comment, [promptKey]: root }
}

const Field = ({ label, value, onChange, multiline = false, large = false }: {
    label: string
    value: string
    onChange: (value: string) => void
    multiline?: boolean
    large?: boolean
}) => (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {multiline
            ? <Textarea value={value} onChange={event => onChange(event.target.value)} className={`${large ? 'min-h-[152px]' : 'min-h-[104px]'} text-sm text-foreground`} />
            : <Input value={value} onChange={event => onChange(event.target.value)} className="text-sm text-foreground" />}
    </label>
)

export function ExifMetadataEditor({ metadata, onChange, onRawJsonValidityChange }: ExifMetadataEditorProps) {
    const { t } = useTranslation()
    const [mode, setMode] = useState<'stored' | 'raw'>('stored')
    const [rawView, setRawView] = useState<'form' | 'json'>('form')
    const [rawJson, setRawJson] = useState('')
    const comment = useMemo(() => parseComment(metadata), [metadata])

    useEffect(() => {
        if (mode === 'raw' && rawView === 'json') setRawJson(JSON.stringify(metadata || {}, null, 2))
    }, [mode, rawView])

    useEffect(() => {
        onRawJsonValidityChange(true)
    }, [metadata, onRawJsonValidityChange])

    if (!metadata) {
        return <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">{t('exif.editor.loadImage')}</div>
    }

    const updateComment = (nextComment: JsonObject) => onChange(updateText(metadata, 'Comment', stringifyComment(nextComment)))
    const updateRawCommentValue = (key: string, value: string) => {
        if (!comment) return
        const previous = comment[key]
        const nextValue = typeof previous === 'number' ? Number(value) : value
        updateComment({ ...comment, [key]: Number.isNaN(nextValue) ? previous : nextValue })
    }
    const updateStoredBase = (key: 'prompt' | 'uc', value: string) => {
        if (!comment) return
        const promptKey = key === 'prompt' ? 'v4_prompt' : 'v4_negative_prompt'
        const root = { ...((comment[promptKey] as JsonObject | undefined) || {}) }
        const caption = { ...((root.caption as JsonObject | undefined) || {}), base_caption: value }
        const nextComment = { ...comment, [key]: value, [promptKey]: { ...root, caption } }
        const nextMetadata = updateText(metadata, 'Comment', stringifyComment(nextComment))
        onChange(key === 'prompt' ? updateText(nextMetadata, 'Description', value) : nextMetadata)
    }

    const updateRawJson = (value: string) => {
        setRawJson(value)
        try {
            const parsed = JSON.parse(value)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid')
            const next: PngTextMetadata = {}
            for (const [key, entry] of Object.entries(parsed)) next[key] = typeof entry === 'string' ? entry : JSON.stringify(entry)
            onRawJsonValidityChange(true)
            onChange(next)
        } catch {
            onRawJsonValidityChange(false)
        }
    }

    const characters = comment ? readCaptionCharacters(comment) : []
    const negativeCharacters = comment ? readCaptionCharacters(comment, true) : []
    const count = Math.max(characters.length, negativeCharacters.length)

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-border/50 px-3 py-2"><div className="text-xs font-medium">{t('exif.editor.title')}</div></div>
            <Tabs value={mode} onValueChange={value => setMode(value as 'stored' | 'raw')} className="flex min-h-0 flex-1 flex-col">
                <div className="px-3 pt-3"><TabsList className="h-8"><TabsTrigger value="stored" className="px-2.5 py-1 text-xs">{t('exif.editor.stored')}</TabsTrigger><TabsTrigger value="raw" className="px-2.5 py-1 text-xs">{t('exif.editor.raw')}</TabsTrigger></TabsList></div>
                <TabsContent value="stored" className="mt-0 flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                    {!comment ? <p className="text-sm text-destructive">{t('exif.editor.invalidComment')}</p> : <div className="grid gap-4">
                        <Field label={t('exif.editor.name')} value={metadata.Title || ''} onChange={value => onChange(updateText(metadata, 'Title', value))} />
                        <Field label={t('exif.editor.basePrompt')} value={String(comment.prompt || '')} onChange={value => updateStoredBase('prompt', value)} multiline large />
                        <Field label={t('exif.editor.negativePrompt')} value={String(comment.uc || '')} onChange={value => updateStoredBase('uc', value)} multiline large />
                        {count > 0 && <div className="grid gap-3 border-t border-border/50 pt-3"><span className="text-xs font-medium text-muted-foreground">{t('exif.editor.characters')}</span>{Array.from({ length: count }, (_, index) => <div key={index} className="grid gap-3"><Field label={`${t('exif.editor.characterPrompt')} ${index + 1}`} value={String(characters[index]?.char_caption || '')} onChange={value => updateComment(updateCharacterCaption(comment, index, false, value))} multiline large /><Field label={`${t('exif.editor.characterNegative')} ${index + 1}`} value={String(negativeCharacters[index]?.char_caption || '')} onChange={value => updateComment(updateCharacterCaption(comment, index, true, value))} multiline large /></div>)}</div>}
                    </div>}
                </TabsContent>
                <TabsContent value="raw" className="mt-0 flex min-h-0 flex-1 flex-col p-3">
                    <Tabs value={rawView} onValueChange={value => setRawView(value as 'form' | 'json')} className="flex min-h-0 flex-1 flex-col">
                        <TabsList className="h-8 w-fit"><TabsTrigger value="form" className="px-2.5 py-1 text-xs">{t('exif.editor.formatted')}</TabsTrigger><TabsTrigger value="json" className="px-2.5 py-1 text-xs">JSON</TabsTrigger></TabsList>
                        <TabsContent value="form" className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
                            {!comment ? <p className="text-sm text-destructive">{t('exif.editor.invalidComment')}</p> : <div className="grid gap-4 pb-3">
                                <div className="grid gap-3"><Field label="Title" value={metadata.Title || ''} onChange={value => onChange(updateText(metadata, 'Title', value))} /><Field label="Description" value={metadata.Description || ''} onChange={value => onChange(updateText(metadata, 'Description', value))} multiline /><Field label="Software" value={metadata.Software || ''} onChange={value => onChange(updateText(metadata, 'Software', value))} /><Field label="Source" value={metadata.Source || ''} onChange={value => onChange(updateText(metadata, 'Source', value))} /></div>
                                <div className="grid gap-3 border-t border-border/50 pt-3"><Field label="Prompt" value={String(comment.prompt || '')} onChange={value => updateRawCommentValue('prompt', value)} multiline large /><Field label="UC" value={String(comment.uc || '')} onChange={value => updateRawCommentValue('uc', value)} multiline large /><div className="grid gap-3 sm:grid-cols-2">{['seed', 'steps', 'sampler', 'strength', 'noise', 'scale', 'cfg_rescale', 'ucStrength'].map(key => <Field key={key} label={key} value={String(comment[key] ?? '')} onChange={value => updateRawCommentValue(key, value)} />)}</div></div>
                                {count > 0 && <div className="grid gap-3 border-t border-border/50 pt-3"><span className="text-xs font-medium text-muted-foreground">{t('exif.editor.characters')}</span>{Array.from({ length: count }, (_, index) => <div key={index} className="grid gap-3"><Field label={`${t('exif.editor.characterPrompt')} ${index + 1}`} value={String(characters[index]?.char_caption || '')} onChange={value => updateComment(updateCharacterCaption(comment, index, false, value))} multiline large /><Field label={`${t('exif.editor.characterNegative')} ${index + 1}`} value={String(negativeCharacters[index]?.char_caption || '')} onChange={value => updateComment(updateCharacterCaption(comment, index, true, value))} multiline large /></div>)}</div>}
                            </div>}
                        </TabsContent>
                        <TabsContent value="json" className="mt-3 flex min-h-0 flex-1 flex-col"><p className="mb-2 text-xs text-muted-foreground">{t('exif.editor.jsonHint')}</p><Textarea value={rawJson} onChange={event => updateRawJson(event.target.value)} spellCheck={false} className="min-h-0 flex-1 font-mono text-xs" /></TabsContent>
                    </Tabs>
                </TabsContent>
            </Tabs>
        </div>
    )
}
