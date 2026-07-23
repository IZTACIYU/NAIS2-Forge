import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Circle, Download, Droplets, Eraser, Image as ImageIcon, Paintbrush, RotateCcw, Square, Undo, ZoomIn, ZoomOut } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile } from '@tauri-apps/plugin-fs'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'

type DrawMode = 'pen' | 'blur' | 'eraser'
type TransferMode = 'i2i' | 'inpaint'
type BrushShape = 'round' | 'square'

const MAX_UNDO_STEPS = 12

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
    const containerRef = useRef<HTMLDivElement>(null)
    const brushCursorRef = useRef<HTMLDivElement>(null)
    const lastPointRef = useRef<{ x: number; y: number } | null>(null)
    const drawingRef = useRef(false)
    const panningRef = useRef(false)
    const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
    const undoHistoryRef = useRef<string[]>([])
    const zoomRef = useRef(1)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
    const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null)
    const [mode, setMode] = useState<DrawMode>('pen')
    const [brushShape, setBrushShape] = useState<BrushShape>('round')
    const [brushSize, setBrushSize] = useState(48)
    const [blurAmount, setBlurAmount] = useState(12)
    const [color, setColor] = useState('#000000')
    const [opacity, setOpacity] = useState(100)
    const [zoom, setZoom] = useState(1)
    const [undoCount, setUndoCount] = useState(0)

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
        panningRef.current = false
        panStartRef.current = null
        undoHistoryRef.current = []
        zoomRef.current = 1
        setImageSize(null)
        setDisplaySize(null)
        setZoom(1)
        setUndoCount(0)
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
            undoHistoryRef.current = []
            setUndoCount(0)
            zoomRef.current = 1
            setZoom(1)
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

    useEffect(() => {
        const container = containerRef.current
        if (!open || !container || !imageSize) {
            setDisplaySize(null)
            return
        }

        const updateDisplaySize = () => {
            const style = window.getComputedStyle(container)
            const availableWidth = Math.max(1, container.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0))
            const availableHeight = Math.max(1, container.clientHeight - (Number.parseFloat(style.paddingTop) || 0) - (Number.parseFloat(style.paddingBottom) || 0))
            const scale = Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height)
            const nextSize = {
                width: Math.max(1, Math.floor(imageSize.width * scale)),
                height: Math.max(1, Math.floor(imageSize.height * scale)),
            }
            setDisplaySize(current => current?.width === nextSize.width && current.height === nextSize.height ? current : nextSize)
        }

        updateDisplaySize()
        const observer = new ResizeObserver(updateDisplaySize)
        observer.observe(container)
        return () => observer.disconnect()
    }, [imageSize, open])

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

    const clearUndoHistory = () => {
        undoHistoryRef.current = []
        setUndoCount(0)
    }

    const captureUndoSnapshot = () => {
        const canvas = editCanvasRef.current
        if (!canvas || canvas.width === 0 || canvas.height === 0) return

        undoHistoryRef.current = [...undoHistoryRef.current, canvas.toDataURL('image/webp', 0.9)].slice(-MAX_UNDO_STEPS)
        setUndoCount(undoHistoryRef.current.length)
    }

    const drawBlurPoint = useCallback((x: number, y: number) => {
        const canvas = editCanvasRef.current
        const source = blurSourceRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !source || !ctx) return

        ctx.save()
        ctx.beginPath()
        if (brushShape === 'round') {
            ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)
        } else {
            ctx.rect(x - brushSize / 2, y - brushSize / 2, brushSize, brushSize)
        }
        ctx.clip()
        ctx.filter = `blur(${blurAmount}px)`
        ctx.drawImage(source, 0, 0)
        ctx.restore()
    }, [blurAmount, brushShape, brushSize])

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
        ctx.lineCap = brushShape === 'round' ? 'round' : 'square'
        ctx.lineJoin = brushShape === 'round' ? 'round' : 'bevel'
        ctx.beginPath()
        ctx.moveTo(from.x, from.y)
        ctx.lineTo(to.x, to.y)
        ctx.stroke()
        ctx.restore()
    }, [brushShape, brushSize, color, drawBlurPoint, mode, opacity])

    const updateBrushCursor = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = editCanvasRef.current
        const cursor = brushCursorRef.current
        if (!canvas || !cursor) return

        const rect = canvas.getBoundingClientRect()
        cursor.style.width = `${brushSize * (rect.width / canvas.width)}px`
        cursor.style.height = `${brushSize * (rect.height / canvas.height)}px`
        cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px) translate(-50%, -50%)`
        cursor.style.borderRadius = brushShape === 'round' ? '9999px' : '0'
        cursor.style.borderColor = mode === 'eraser' ? 'rgba(248, 113, 113, 0.95)' : 'rgba(255, 255, 255, 0.9)'
        cursor.style.backgroundColor = mode === 'eraser' ? 'rgba(248, 113, 113, 0.1)' : 'rgba(99, 102, 241, 0.1)'
        cursor.style.opacity = '1'
    }

    const hideBrushCursor = () => {
        if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0'
    }

    const startPanning = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 1 || !containerRef.current) return false
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        panningRef.current = true
        panStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            scrollLeft: containerRef.current.scrollLeft,
            scrollTop: containerRef.current.scrollTop,
        }
        hideBrushCursor()
        return true
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (startPanning(event)) return
        if (event.button !== 0) return
        const point = getCanvasPoint(event)
        if (!point) return
        event.currentTarget.setPointerCapture(event.pointerId)
        captureUndoSnapshot()
        if (mode === 'blur') captureBlurSource()
        drawingRef.current = true
        lastPointRef.current = point
        updateBrushCursor(event)
        drawSegment(point, { x: point.x + 0.01, y: point.y + 0.01 })
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (panningRef.current && panStartRef.current && containerRef.current) {
            containerRef.current.scrollLeft = panStartRef.current.scrollLeft - (event.clientX - panStartRef.current.x)
            containerRef.current.scrollTop = panStartRef.current.scrollTop - (event.clientY - panStartRef.current.y)
            return
        }
        updateBrushCursor(event)
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
        if (panningRef.current) {
            panningRef.current = false
            panStartRef.current = null
            return
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
        clearUndoHistory()
    }

    const undo = useCallback(() => {
        const canvas = editCanvasRef.current
        const snapshot = undoHistoryRef.current.pop()
        if (!canvas || !snapshot) return

        setUndoCount(undoHistoryRef.current.length)
        const image = new Image()
        image.onload = () => {
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        }
        image.src = snapshot
    }, [])

    useEffect(() => {
        if (!open) return
        const handleUndoShortcut = (event: KeyboardEvent) => {
            if (!event.ctrlKey || event.shiftKey || event.key.toLowerCase() !== 'z') return
            event.preventDefault()
            undo()
        }
        window.addEventListener('keydown', handleUndoShortcut)
        return () => window.removeEventListener('keydown', handleUndoShortcut)
    }, [open, undo])

    const setZoomLevel = (nextZoom: number, pivot?: { clientX: number; clientY: number }) => {
        const previousZoom = zoomRef.current
        const clampedZoom = Math.max(0.5, Math.min(3, nextZoom))
        if (clampedZoom === previousZoom) return

        const container = containerRef.current
        const rect = container?.getBoundingClientRect()
        const pivotX = pivot && rect ? pivot.clientX - rect.left : 0
        const pivotY = pivot && rect ? pivot.clientY - rect.top : 0
        const contentX = container ? container.scrollLeft + pivotX : 0
        const contentY = container ? container.scrollTop + pivotY : 0

        zoomRef.current = clampedZoom
        setZoom(clampedZoom)
        hideBrushCursor()

        window.requestAnimationFrame(() => {
            if (!container) return
            if (clampedZoom <= 1) {
                container.scrollLeft = 0
                container.scrollTop = 0
                return
            }
            const scale = clampedZoom / previousZoom
            container.scrollLeft = Math.max(0, contentX * scale - pivotX)
            container.scrollTop = Math.max(0, contentY * scale - pivotY)
        })
    }

    const handleZoomWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        if (!event.ctrlKey) return
        event.preventDefault()
        setZoomLevel(zoomRef.current + (event.deltaY < 0 ? 0.25 : -0.25), event)
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
            <DialogContent className="flex h-[92vh] w-[78vw] max-w-[78vw] flex-col gap-3 p-4">
                <DialogHeader className="sr-only">
                    <DialogTitle>{t('smartTools.drawOverEditor')}</DialogTitle>
                </DialogHeader>

                <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 rounded-lg border bg-muted/20 p-1.5">
                    <div className="flex items-center gap-1">
                        {toolButton('pen', Paintbrush, t('smartTools.solidPen'))}
                        {toolButton('blur', Droplets, t('smartTools.blurBrush'))}
                        {toolButton('eraser', Eraser, t('common.eraser'))}
                    </div>
                    <div className="h-6 w-px bg-border" />
                    <div className="flex items-center gap-1">
                        <Button type="button" variant={brushShape === 'round' ? 'secondary' : 'ghost'} size="icon" className={cn('h-8 w-8', brushShape === 'round' && 'bg-primary text-primary-foreground hover:bg-primary/90')} onClick={() => setBrushShape('round')} title={t('smartTools.roundBrush')}>
                            <Circle className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant={brushShape === 'square' ? 'secondary' : 'ghost'} size="icon" className={cn('h-8 w-8', brushShape === 'square' && 'bg-primary text-primary-foreground hover:bg-primary/90')} onClick={() => setBrushShape('square')} title={t('smartTools.squareBrush')}>
                            <Square className="h-4 w-4" />
                        </Button>
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
                    <div className="flex items-center gap-1">
                        <Button type="button" variant="ghost" size="icon" onClick={() => setZoomLevel(zoomRef.current - 0.25)} disabled={zoom <= 0.5} title={t('smartTools.zoomOut')}>
                            <ZoomOut className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="w-14 tabular-nums" onClick={() => setZoomLevel(1)} title={t('smartTools.resetZoom')}>
                            {Math.round(zoom * 100)}%
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => setZoomLevel(zoomRef.current + 0.25)} disabled={zoom >= 3} title={t('smartTools.zoomIn')}>
                            <ZoomIn className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="h-6 w-px bg-border" />
                    <Button type="button" variant="ghost" size="icon" onClick={undo} disabled={undoCount === 0} title={t('smartTools.undo')}>
                        <Undo className="h-4 w-4" />
                    </Button>
                    <div className="h-6 w-px bg-border" />
                    <Button type="button" variant="ghost" size="icon" onClick={resetEdits} title={t('smartTools.reset')}>
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </div>

                <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg bg-muted/50 p-2" onWheel={handleZoomWheel}>
                    {sourceImage && (
                        <div
                            className="relative shrink-0"
                            style={{
                                width: displaySize ? `${Math.round(displaySize.width * zoom)}px` : '1px',
                                height: displaySize ? `${Math.round(displaySize.height * zoom)}px` : '1px',
                                visibility: displaySize ? 'visible' : 'hidden',
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
                                onPointerEnter={updateBrushCursor}
                                onPointerLeave={hideBrushCursor}
                                onContextMenu={event => event.preventDefault()}
                            />
                            <div ref={brushCursorRef} className="pointer-events-none absolute left-0 top-0 border border-white/90 transition-opacity duration-100" style={{ opacity: 0 }} />
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
