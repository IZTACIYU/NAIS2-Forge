import { useEffect, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { ClipboardCopy, Code2, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { parseMetadataFromBase64, type NAIMetadata } from '@/lib/metadata-parser'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { embedNais2Params, readNais2Params } from '@/lib/nais2-png-meta'
import { readPngTextMetadata, writePngTextMetadata } from '@/lib/png-metadata-editor'
import { cardGroups, cardHtml, type ShareCardFields } from './share-card-html'

const WIDTH = 720
const PADDING = 32
const CONTENT_WIDTH = WIDTH - PADDING * 2

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
        if (!paragraph) { lines.push(''); continue }
        let line = ''
        for (const word of paragraph.split(/(\s+)/)) {
            if (ctx.measureText(line + word).width <= maxWidth) { line += word; continue }
            if (line.trim()) { lines.push(line.trimEnd()); line = '' }
            for (const char of word) {
                if (ctx.measureText(line + char).width > maxWidth && line) {
                    lines.push(line)
                    line = ''
                }
                line += char
            }
        }
        lines.push(line.trimEnd())
    }
    return lines.length ? lines : ['-']
}

function cardFields(metadata: NAIMetadata): ShareCardFields {
    const capabilities = getModelCapabilities(metadata.modelId ?? '')
    const mode = capabilities.modes.length
        ? /^fur dataset(?:,|\s|$)/i.test(metadata.prompt ?? '') ? 'Furry' : 'Anime'
        : null
    const quality = capabilities.qualityTagPresets.find(option => option.value === metadata.qualityTagPreset)
    const uc = capabilities.ucPresets.find(option => option.value === metadata.ucPreset)
    const negative = metadata.v4_negative_prompt?.caption?.base_caption ?? metadata.negativePrompt ?? ''
    return {
        model: `${metadata.model ?? 'Unknown model'}${mode ? ` · ${mode}` : ''}`,
        positive: metadata.prompt ?? '',
        negative,
        steps: metadata.steps?.toString() ?? '-',
        cfgScale: metadata.cfgScale?.toString() ?? '-',
        cfgRescale: metadata.cfgRescale?.toString() ?? '-',
        sampler: metadata.sampler ?? '-',
        scheduler: metadata.scheduler ?? '-',
        quality: quality?.label ?? (metadata.qualityToggle === true ? 'Standard' : metadata.qualityToggle === false ? 'None' : '-'),
        uc: uc ? uc.label.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()) : '-',
    }
}

async function createCard(imageUrl: string): Promise<{ png: string; fields: ShareCardFields }> {
    const metadata = await parseMetadataFromBase64(imageUrl)
    if (!metadata?.raw || !metadata.prompt || !metadata.model) throw new Error('NovelAI image metadata is required')
    const fields = cardFields(metadata)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.font = '16px sans-serif'
    const positiveLines = wrapText(ctx, fields.positive || '-', CONTENT_WIDTH)
    const negativeLines = wrapText(ctx, fields.negative || '-', CONTENT_WIDTH)
    const promptHeight = (lines: string[]) => 55 + Math.max(1, lines.length) * 23
    canvas.width = WIDTH
    canvas.height = PADDING + 78 + promptHeight(positiveLines) + 12
        + promptHeight(negativeLines) + 12 + 85 * 4 + PADDING

    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(0, 0, WIDTH, canvas.height)

    const label = (value: string, x: number, y: number) => {
        ctx.fillStyle = '#e3c884'
        ctx.font = 'bold 15px sans-serif'
        ctx.fillText(value, x, y)
    }
    const value = (text: string, x: number, y: number) => {
        ctx.fillStyle = '#f4f1ed'
        ctx.font = '16px sans-serif'
        ctx.fillText(text, x, y)
    }
    const drawPrompt = (heading: string, lines: string[], x: number, y: number) => {
        label(heading, x, y + 23)
        ctx.font = '16px sans-serif'
        lines.forEach((line, index) => value(line, x, y + 51 + index * 23))
    }
    let y = PADDING
    label('MODEL', PADDING, y + 22)
    value(fields.model, PADDING, y + 48)
    y += 78
    drawPrompt('BASE PROMPT', positiveLines, PADDING, y)
    y += promptHeight(positiveLines) + 12
    drawPrompt('NEGATIVE PROMPT', negativeLines, PADDING, y)
    y += promptHeight(negativeLines) + 12
    const paired = (leftLabel: string, leftValue: string, rightLabel?: string, rightValue?: string) => {
        const gap = 12
        const width = rightLabel ? (CONTENT_WIDTH - gap) / 2 : CONTENT_WIDTH
        label(leftLabel, PADDING, y + 24)
        value(leftValue, PADDING, y + 52)
        if (rightLabel) {
            const rightX = PADDING + width + gap
            label(rightLabel, rightX, y + 24)
            value(rightValue ?? '-', rightX, y + 52)
        }
        y += 85
    }
    paired('STEPS', fields.steps)
    paired('CFG SCALE', fields.cfgScale, 'CFG RESCALE', fields.cfgRescale)
    paired('SAMPLER', fields.sampler, 'SCHEDULER', fields.scheduler)
    paired('QUALITY TAGS', fields.quality, 'UC PRESET', fields.uc)

    const cardDataUrl = canvas.toDataURL('image/png')
    const originalText = imageUrl.startsWith('data:image/png') ? readPngTextMetadata(imageUrl) : {}
    const officialText = {
        Title: originalText.Title ?? 'NAIS2 prompt share card',
        Description: originalText.Description ?? metadata.prompt,
        Software: originalText.Software ?? 'NovelAI',
        Source: originalText.Source ?? metadata.model ?? '',
        Comment: originalText.Comment ?? JSON.stringify(metadata.raw),
    }
    const officialBytes = writePngTextMetadata(cardDataUrl, officialText)
    let binary = ''
    for (let index = 0; index < officialBytes.length; index += 32768) {
        binary += String.fromCharCode(...officialBytes.subarray(index, index + 32768))
    }
    const originalBytes = Uint8Array.from(atob(imageUrl.split(',')[1]), char => char.charCodeAt(0))
    const appParams = readNais2Params(originalBytes) ?? {
        qualityToggle: metadata.qualityToggle,
        ucPreset: metadata.ucPreset,
    }
    return { png: `data:image/png;base64,${embedNais2Params(btoa(binary), appParams)}`, fields }
}

interface ShareCardDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    image: string | null
}

export function ShareCardDialog({ open, onOpenChange, image }: ShareCardDialogProps) {
    const { t } = useTranslation()
    const [card, setCard] = useState<{ png: string; fields: ShareCardFields } | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        if (!open || !image) return
        let active = true
        createCard(image).then(result => {
            if (active) setCard(result)
        }).catch(reason => {
            console.error('Share card creation failed:', reason)
            if (active) setError(t('shareCard.createFailed'))
        })
        return () => { active = false; setCard(null); setError(null) }
    }, [open, image, t])

    const handleSave = async () => {
        if (!card) return
        try {
            const path = await save({
                defaultPath: `NAIS_share_${Date.now()}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            })
            if (!path) return
            await writeFile(path, Uint8Array.from(atob(card.png.split(',')[1]), char => char.charCodeAt(0)))
            toast({ title: t('shareCard.saved'), variant: 'success' })
        } catch (reason) {
            console.error('Share card save failed:', reason)
            toast({ title: t('shareCard.saveFailed'), variant: 'destructive' })
        }
    }

    const copyImage = async () => {
        if (!card) return
        try {
            const blob = await (await fetch(card.png)).blob()
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            toast({ title: t('shareCard.copied'), variant: 'success' })
        } catch (reason) {
            console.error('Share card image copy failed:', reason)
            toast({ title: t('shareCard.copyFailed'), variant: 'destructive' })
        }
    }

    const copyHtml = async () => {
        if (!card) return
        const html = cardHtml(card.fields)
        try {
            try {
                await navigator.clipboard.write([new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([html], { type: 'text/plain' }),
                })])
            } catch {
                await navigator.clipboard.writeText(html)
            }
            toast({ title: t('shareCard.htmlCopied'), variant: 'success' })
        } catch (reason) {
            console.error('Share card HTML copy failed:', reason)
            toast({ title: t('shareCard.copyFailed'), variant: 'destructive' })
        }
    }

    const copyField = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value)
            toast({ title: t('shareCard.copied'), variant: 'success' })
        } catch (reason) {
            console.error('Share card field copy failed:', reason)
            toast({ title: t('shareCard.copyFailed'), variant: 'destructive' })
        }
    }

    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!max-w-[760px] max-h-[92vh] flex flex-col p-5 [&>button]:hidden">
            <DialogTitle className="sr-only">{t('shareCard.title')}</DialogTitle>
            <div className="flex flex-wrap justify-end gap-2 shrink-0">
                <Button onClick={handleSave} disabled={!card} variant="outline" className="gap-2">
                    <Download className="h-4 w-4" /> {t('shareCard.savePng')}
                </Button>
                <Button onClick={copyImage} disabled={!card} variant="outline" className="gap-2">
                    <ClipboardCopy className="h-4 w-4" /> {t('shareCard.copyPng')}
                </Button>
                <Button onClick={copyHtml} disabled={!card} variant="outline" className="gap-2">
                    <Code2 className="h-4 w-4" /> {t('shareCard.copyHtml')}
                </Button>
            </div>
            {card ? <div className="min-h-0 overflow-y-auto rounded-xl bg-[#1b1b1b] p-8 text-[#f4f1ed]">
                {cardGroups(card.fields).map((group, groupIndex) => <div key={groupIndex} className="mb-6 flex gap-3 last:mb-0">
                    {group.map(({ label, value }) => <section key={label} className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2 text-[15px] font-bold text-[#e3c884]">
                            <span>{label}</span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0 text-[#e3c884] hover:bg-amber-500/15 hover:text-[#f4d994]"
                                onClick={() => copyField(value)}
                                aria-label={t('shareCard.copyField', { label })}
                                title={t('shareCard.copyField', { label })}
                            ><ClipboardCopy className="h-3.5 w-3.5" /></Button>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap break-words text-base">{value || '-'}</div>
                    </section>)}
                </div>)}
            </div> : <div className="min-h-40 flex items-center justify-center text-muted-foreground">{error ?? t('shareCard.preparing')}</div>}
        </DialogContent>
    </Dialog>
}
