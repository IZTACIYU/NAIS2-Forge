import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Droplets, Eraser, Image as ImageIcon, Paintbrush, RotateCcw } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

type DrawMode = 'pen' | 'blur' | 'eraser'
type TransferMode = 'i2i' | 'inpaint'

interface DrawOverDialogProps {
    open: boolean
    sourceImage: string | null
    onOpenChange: (open: boolean) => void
    onTransfer: (image: string, mode: TransferMode) => void
}

function dataUrlToBytes(dataUrl: string) {
    const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
    return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function DrawOverDialog({ open, sourceImage, onOpenChange, onTransfer }: DrawOverDialogProps) {
    const { t } = useTranslation()
    const baseCanvasRef = useRef<HTMLCanvasElement>(null)
    const editCanvasRef = useRef<HTMLCanvasElement>(null)
    const blurSourceRef = useRef<HTMLCanvasElement | null>(null)
    const lastPointRef = useRef<{ x: number; y: number } | null>(null)
    const drawingRef = useRef(false)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
    const [mode, setMode] = useState<DrawMode>('pen')
    const [brushSize, setBrushSize] = useState(48)
    const [blurAmount, setBlurAmount] = useState(12)
    const [color, setColor] = useState('#000000')
    const [opacity, setOpacity] = useState(100)

    const releaseCanvases = useCallback(() => {
        for (const canvas of [baseCanvasRef.current, editCanvasRef.current, blurSourceRef.current]) {
            if (canvas) {
                canvas.width = 0
                canvas.height = 0
            }
        }
        blurSourceRef.current = null
        lastPointRef.current = null
        drawingRef.current = false
        setImageSize(null)
    }, [])

    useEffect(() => {
        if (!open || !sourceImage) {
            if (!open) releaseCanvases()
            return
        }

        let cancelled = false
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload = () => {
            if (cancelled) return
            const baseCanvas = baseCanvasRef.current
            const editCanvas = editCanvasRef.current
            if (!baseCanvas || !editCanvas) return

            baseCanvas.width = image.naturalWidth
            baseCanvas.height = image.naturalHeight
            editCanvas.width = image.naturalWidth
            editCanvas.height = image.naturalHeight
            baseCanvas.getContext('2d')?.drawImage(image, 0, 0)
            editCanvas.getContext('2d')?.clearRect(0, 0, editCanvas.width, editCanvas.height)
            setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
        }
        image.onerror = () => {
            if (!cancelled) toast({ title: t('smartTools.error'), variant: 'destructive' })
        }
        image.src = sourceImage

        return () => {
            cancelled = true
            image.onload = null
            image.onerror = null
        }
    }, [open, releaseCanvases, sourceImage, t])

    const composeToCanvas = useCallback(() => {
        const base = baseCanvasRef.current
        const edit = editCanvasRef.current
        if (!base || !edit || base.width === 0 || base.height === 0) return null

        const output = document.createElement('canvas')
        output.width = base.width
        output.height = base.height
        const ctx = output.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(base, 0, 0)
        ctx.drawImage(edit, 0, 0)
        return output
    }, [])

    const captureBlurSource = useCallback(() => {
        const composite = composeToCanvas()
        if (!composite) return
        if (blurSourceRef.current) {
            blurSourceRef.current.width = 0
            blurSourceRef.current.height = 0
        }
        blurSourceRef.current = composite
    }, [composeToCanvas])

    const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = editCanvasRef.current
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        return {
            x: (event.clientX - rect.left) * (canvas.width / rect.width),
            y: (event.clientY - rect.top) * (canvas.height / rect.height),
        }
    }

    const drawBlurPoint = useCallback((x: number, y: number) => {
        const canvas = editCanvasRef.current
        const source = blurSourceRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !source || !ctx) return

        const radius = brushSize / 2
        ctx.save()
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.clip()
        ctx.filter = `blur(${blurAmount}px)`
        ctx.drawImage(source, 0, 0)
        ctx.restore()
    }, [blurAmount, brushSize])

    const drawSegment = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
        const canvas = editCanvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        if (mode === 'blur') {
            const distance = Math.hypot(to.x - from.x, to.y - from.y)
            const spacing = Math.max(2, brushSize / 5)
            const steps = Math.max(1, Math.ceil(distance / spacing))
            for (let index = 0; index <= steps; index++) {
                const ratio = index / steps
                drawBlurPoint(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio)
            }
            return
        }

        ctx.save()
        ctx.globalCompositeOperation = mode === 'eraser' ? 'destination-out' : 'source-over'
        ctx.globalAlpha = mode === 'pen' ? opacity / 100 : 1
        ctx.strokeStyle = color
        ctx.lineWidth = brushSize
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(to.x, to.y)
        ctx.stroke()
        ctx.restore()
    }, [brushSize, color, drawBlurPoint, mode, opacity])

    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = getCanvasPoint(event)
        if (!point) return
        event.currentTarget.setPointerCapture(event.pointerId)
        if (mode === 'blur') captureBlurSource()
        drawingRef.current = true
        lastPointRef.current = point
        drawSegment(point, { x: point.x + 0.01, y: point.y + 0.01 })
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current || !lastPointRef.current) return
        const point = getCanvasPoint(event)
        if (!point) return
        drawSegment(lastPointRef.current, point)
        lastPointRef.current = point
    }

    const stopDrawing = (event?: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        drawingRef.current = false
        lastPointRef.current = null
        if (blurSourceRef.current) {
            blurSourceRef.current.width = 0
            blurSourceRef.current.height = 0
            blurSourceRef.current = null
        }
    }

    const resetEdits = () => {
        const canvas = editCanvasRef.current
        canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }

    const getOutputDataUrl = () => {
        const output = composeToCanvas()
        if (!output) return null
        const dataUrl = output.toDataURL('image/png')
        output.width = 0
        output.height = 0
        return dataUrl
    }

    const handleDownload = async () => {
        const dataUrl = getOutputDataUrl()
        if (!dataUrl) return
        try {
            const path = await save({
                defaultPath: `NAIS_Draw_${Date.now()}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }],
            })
            if (!path) return
            await writeFile(path, dataUrlToBytes(dataUrl))
            toast({ title: t('common.saved'), variant: 'success' })
        } catch (error) {
            console.error('Failed to save drawn image:', error)
            toast({ title: t('common.saveFailed'), variant: 'destructive' })
        }
    }

    const handleTransfer = (target: TransferMode) => {
        const dataUrl = getOutputDataUrl()
        if (dataUrl) onTransfer(dataUrl, target)
    }

    const toolButton = (value: DrawMode, icon: typeof Paintbrush, label: string) => {
        const Icon = icon
        return (
            <Button
                type="button"
                size="sm"
                variant={mode === value ? 'secondary' : 'ghost'}
                className={cn(mode === value && 'bg-primary text-primary-foreground hover:bg-primary/90')}
                onClick={() => setMode(value)}
            >
                <Icon className="mr-2 h-4 w-4" />
                {label}
            </Button>
        )
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[85vh] w-[72vw] max-w-[72vw] flex-col gap-4 p-6">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Paintbrush className="h-5 w-5" />
                        {t('smartTools.drawOverEditor')}
                    </DialogTitle>
                    <DialogDescription>{t('smartTools.drawOverEditorDesc')}</DialogDescription>
                </DialogHeader>

                <div className="flex shrink-0 flex-wrap items-center justify-center gap-3 rounded-lg border bg-muted/20 p-2">
                    <div className="flex items-center gap-1">
                        {toolButton('pen', Paintbrush, t('smartTools.solidPen'))}
                        {toolButton('blur', Droplets, t('smartTools.blurBrush'))}
                        {toolButton('eraser', Eraser, t('common.eraser'))}
                    </div>
                    <div className="h-6 w-px bg-border" />
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('common.size')}</Label>
                        <Slider value={[brushSize]} min={4} max={240} step={2} onValueChange={([value]) => setBrushSize(value)} className="w-28" />
                        <span className="w-8 text-xs text-muted-foreground">{brushSize}</span>
                    </div>
                    {mode === 'pen' && (
                        <>
                            <div className="h-6 w-px bg-border" />
                            <Label className="flex items-center gap-2 text-xs">
                                {t('smartTools.color')}
                                <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
                            </Label>
                            <div className="flex items-center gap-2">
                                <Label className="text-xs">{t('smartTools.opacity')}</Label>
                                <Slider value={[opacity]} min={5} max={100} step={5} onValueChange={([value]) => setOpacity(value)} className="w-24" />
                                <span className="w-8 text-xs text-muted-foreground">{opacity}%</span>
                            </div>
                        </>
                    )}
                    {mode === 'blur' && (
                        <>
                            <div className="h-6 w-px bg-border" />
                            <div className="flex items-center gap-2">
                                <Label className="text-xs">{t('smartTools.blurAmount')}</Label>
                                <Slider value={[blurAmount]} min={2} max={30} step={1} onValueChange={([value]) => setBlurAmount(value)} className="w-24" />
                                <span className="w-7 text-xs text-muted-foreground">{blurAmount}</span>
                            </div>
                        </>
                    )}
                    <div className="h-6 w-px bg-border" />
                    <Button type="button" variant="ghost" size="icon" onClick={resetEdits} title={t('smartTools.reset')}>
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </div>

                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted/50 p-4">
                    {sourceImage && (
                        <div
                            className="relative max-h-full max-w-full"
                            style={{
                                aspectRatio: imageSize ? `${imageSize.width} / ${imageSize.height}` : undefined,
                                width: imageSize ? `min(100%, calc((85vh - 210px) * ${imageSize.width / imageSize.height}))` : '100%',
                                maxHeight: '100%',
                            }}
                        >
                            <canvas ref={baseCanvasRef} className="block h-full w-full object-contain" />
                            <canvas
                                ref={editCanvasRef}
                                className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={stopDrawing}
                                onPointerCancel={stopDrawing}
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="shrink-0 items-center gap-2 sm:justify-between">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={handleDownload}>
                            <Download className="mr-2 h-4 w-4" />
                            {t('library.download')}
                        </Button>
                        <Button variant="outline" onClick={() => handleTransfer('i2i')}>
                            <ImageIcon className="mr-2 h-4 w-4" />
                            {t('smartTools.sendToI2I')}
                        </Button>
                        <Button onClick={() => handleTransfer('inpaint')}>
                            <Paintbrush className="mr-2 h-4 w-4" />
                            {t('smartTools.sendToInpaint')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
