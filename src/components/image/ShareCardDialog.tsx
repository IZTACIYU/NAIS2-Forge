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

const WIDTH = 720
const PADDING = 32
const IMAGE_HEIGHT = 400
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

async function createCard(imageUrl: string): Promise<string> {
    const metadata = await parseMetadataFromBase64(imageUrl)
    if (!metadata?.raw || !metadata.prompt || !metadata.model) throw new Error('NovelAI image metadata is required')
    const fields = cardFields(metadata)
    const source = new Image()
    source.src = imageUrl
    await source.decode()

    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.font = '16px sans-serif'
    const positiveLines = wrapText(ctx, fields.positive || '-', CONTENT_WIDTH)
    const negativeLines = wrapText(ctx, fields.negative || '-', CONTENT_WIDTH)
    const promptHeight = (lines: string[]) => 55 + Math.max(1, lines.length) * 23
    canvas.height = 32 + IMAGE_HEIGHT + 24 + 66 + promptHeight(positiveLines) + 12
        + promptHeight(negativeLines) + 12 + 73 + 12 + 73 + 12 + 73 + 12 + 73 + 32

    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(0, 0, WIDTH, canvas.height)
    ctx.fillStyle = '#252525'
    ctx.fillRect(PADDING, 32, CONTENT_WIDTH, IMAGE_HEIGHT)
    const scale = Math.min(CONTENT_WIDTH / source.naturalWidth, IMAGE_HEIGHT / source.naturalHeight)
    const imageWidth = source.naturalWidth * scale
    const imageHeight = source.naturalHeight * scale
    ctx.drawImage(source, PADDING + (CONTENT_WIDTH - imageWidth) / 2,
        32 + (IMAGE_HEIGHT - imageHeight) / 2, imageWidth, imageHeight)

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
    let y = 32 + IMAGE_HEIGHT + 24
    label('MODEL', PADDING, y + 22)
    value(fields.model, PADDING, y + 48)
    y += 78
    for (const [heading, lines] of [['BASE PROMPT', positiveLines], ['NEGATIVE PROMPT', negativeLines]] as const) {
        const height = promptHeight(lines)
        label(heading, PADDING, y + 23)
        ctx.font = '16px sans-serif'
        lines.forEach((line, index) => value(line, PADDING, y + 51 + index * 23))
        y += height + 12
    }
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
    return `data:image/png;base64,${embedNais2Params(btoa(binary), appParams)}`
}

interface ShareCardDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    image: string | null
}

export function ShareCardDialog({ open, onOpenChange, image }: ShareCardDialogProps) {
    const [card, setCard] = useState<string | null>(null)
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
            await writeFile(path, Uint8Array.from(atob(card.split(',')[1]), char => char.charCodeAt(0)))
            toast({ title: '공유 카드 저장 완료', variant: 'success' })
        } catch (reason) {
            console.error('Share card save failed:', reason)
            toast({ title: '공유 카드 저장 실패', variant: 'destructive' })
        }
    }

    return <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!max-w-[800px] max-h-[92vh] overflow-y-auto p-5 [&>button]:hidden">
            <DialogTitle className="sr-only">이미지 공유 카드</DialogTitle>
            {card ? <img src={card} alt="이미지 공유 카드 미리보기" className="w-full max-w-[720px] mx-auto rounded-xl" />
                : <div className="min-h-40 flex items-center justify-center text-muted-foreground">{error ?? '카드를 만드는 중...'}</div>}
            <Button onClick={handleSave} disabled={!card} className="justify-self-end gap-2">
                <Download className="h-4 w-4" /> PNG 저장
            </Button>
        </DialogContent>
    </Dialog>
}
