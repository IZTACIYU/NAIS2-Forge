import { useEffect, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import { parseMetadataFromBase64, type NAIMetadata } from '@/lib/metadata-parser'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { embedNais2Params, readNais2Params } from '@/lib/nais2-png-meta'
import { readPngTextMetadata, writePngTextMetadata } from '@/lib/png-metadata-editor'
import { getShareCardLayout } from './share-card-layout'

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

function cardFields(metadata: NAIMetadata) {
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

async function createCard(imageUrl: string): Promise<{ image: string; width: number }> {
    const metadata = await parseMetadataFromBase64(imageUrl)
    if (!metadata?.raw || !metadata.prompt || !metadata.model) throw new Error('NovelAI image metadata is required')
    const fields = cardFields(metadata)
    const source = new Image()
    source.src = imageUrl
    await source.decode()

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.font = '16px sans-serif'
    const initialLayout = getShareCardLayout(source.naturalWidth, source.naturalHeight, 1, 1)
    const positiveLines = wrapText(ctx, fields.positive || '-', initialLayout.textWidth)
    const negativeLines = wrapText(ctx, fields.negative || '-', initialLayout.textWidth)
    const layout = getShareCardLayout(source.naturalWidth, source.naturalHeight, positiveLines.length, negativeLines.length)
    canvas.width = layout.width
    const promptHeight = (lines: string[]) => 55 + Math.max(1, lines.length) * 23
    canvas.height = layout.height

    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(0, 0, layout.width, canvas.height)
    ctx.fillStyle = '#252525'
    ctx.fillRect(layout.image.x, layout.image.y, layout.image.width, layout.image.height)
    const scale = Math.min(layout.image.width / source.naturalWidth, layout.image.height / source.naturalHeight)
    const imageWidth = source.naturalWidth * scale
    const imageHeight = source.naturalHeight * scale
    ctx.drawImage(source, layout.image.x + (layout.image.width - imageWidth) / 2,
        layout.image.y + (layout.image.height - imageHeight) / 2, imageWidth, imageHeight)

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
    const drawModel = (x: number, y: number) => {
        label('MODEL', x, y + 22)
        value(fields.model, x, y + 48)
    }
    const drawParameterRows = (x: number, startY: number, contentWidth: number) => {
        let y = startY
        const paired = (leftLabel: string, leftValue: string, rightLabel?: string, rightValue?: string) => {
            const gap = 12
            const width = rightLabel ? (contentWidth - gap) / 2 : contentWidth
            label(leftLabel, x, y + 24)
            value(leftValue, x, y + 52)
            if (rightLabel) {
                const rightX = x + width + gap
                label(rightLabel, rightX, y + 24)
                value(rightValue ?? '-', rightX, y + 52)
            }
            y += 85
        }
        paired('STEPS', fields.steps)
        paired('CFG SCALE', fields.cfgScale, 'CFG RESCALE', fields.cfgRescale)
        paired('SAMPLER', fields.sampler, 'SCHEDULER', fields.scheduler)
        paired('QUALITY TAGS', fields.quality, 'UC PRESET', fields.uc)
    }
    if (layout.sideBySide) {
        drawPrompt('BASE PROMPT', positiveLines, layout.textX, layout.textY)
        drawPrompt('NEGATIVE PROMPT', negativeLines, layout.negativeX, layout.textY)
        drawModel(layout.parametersX, layout.textY)
        drawParameterRows(layout.parametersX, layout.textY + 78, layout.parametersWidth)
    } else {
        drawModel(layout.textX, layout.textY)
        const positiveY = layout.textY + 78
        drawPrompt('BASE PROMPT', positiveLines, layout.textX, positiveY)
        const negativeY = positiveY + promptHeight(positiveLines) + 12
        drawPrompt('NEGATIVE PROMPT', negativeLines, layout.textX, negativeY)
        drawParameterRows(layout.textX, negativeY + promptHeight(negativeLines) + 12, layout.textWidth)
    }

    const cardDataUrl = canvas.toDataURL('image/png')
    const originalText = imageUrl.startsWith('data:image/png') ? readPngTextMetadata(imageUrl) : {}
    const officialText = {
        Title: originalText.Title ?? 'NovelAI image share card',
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
    return { image: `data:image/png;base64,${embedNais2Params(btoa(binary), appParams)}`, width: layout.width }
}

interface ShareCardDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    image: string | null
}

export function ShareCardDialog({ open, onOpenChange, image }: ShareCardDialogProps) {
    const [card, setCard] = useState<{ image: string; width: number } | null>(null)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        if (!open || !image) return
        let active = true
        createCard(image).then(result => {
            if (active) setCard(result)
        }).catch(reason => {
            if (active) setError(reason instanceof Error ? reason.message : String(reason))
        })
        return () => { active = false; setCard(null); setError(null) }
    }, [open, image])

    const handleSave = async () => {
        if (!card) return
        try {
            const path = await save({
                defaultPath: `NAIS_share_${Date.now()}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            })
            if (!path) return
            await writeFile(path, Uint8Array.from(atob(card.image.split(',')[1]), char => char.charCodeAt(0)))
            toast({ title: '공유 카드 저장 완료', variant: 'success' })
        } catch (reason) {
            console.error('Share card save failed:', reason)
            toast({ title: '공유 카드 저장 실패', variant: 'destructive' })
        }
    }

    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
            className="!max-w-none max-h-[92vh] overflow-y-auto p-5 [&>button]:hidden"
            style={{ width: `min(calc(100vw - 32px), ${card ? card.width + 40 : 760}px)` }}
        >
            <DialogTitle className="sr-only">이미지 공유 카드</DialogTitle>
            {card ? <img src={card.image} alt="이미지 공유 카드 미리보기" className="max-w-full h-auto mx-auto rounded-xl" />
                : <div className="min-h-40 flex items-center justify-center text-muted-foreground">{error ?? '카드를 만드는 중...'}</div>}
            <Button onClick={handleSave} disabled={!card} className="justify-self-end gap-2">
                <Download className="h-4 w-4" /> PNG 저장
            </Button>
        </DialogContent>
    </Dialog>
}
