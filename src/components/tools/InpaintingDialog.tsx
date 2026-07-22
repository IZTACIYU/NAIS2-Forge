
import { useState, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useGenerationStore } from '@/stores/generation-store'
import { useToolsStore } from '@/stores/tools-store'
import { useTranslation } from 'react-i18next'
import { Paintbrush, Eraser, Undo, Trash2, Save, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

interface InpaintingDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    sourceImage: string | null
    onMaskSaved?: () => void
}

const GRID_SIZE = 8
const MAX_UNDO_STEPS = 50

interface MaskHistoryAction {
    painted: boolean
    cells: number[]
}

export function InpaintingDialog({ open, onOpenChange, sourceImage: propSourceImage, onMaskSaved }: InpaintingDialogProps) {
    const { t } = useTranslation()
    const {
        setSourceImage,
        setMask,
        setI2IMode,
        resetI2IParams,
        mask: existingMask
    } = useGenerationStore()

    const {
        inpaintingBrushSize,
        setInpaintingBrushSize
    } = useToolsStore()

    // Derived state for slider (it expects array)
    const brushSize = [inpaintingBrushSize]
    const setBrushSize = (val: number[]) => setInpaintingBrushSize(val[0])
    const [isErasing, setIsErasing] = useState(false)
    const [zoom, setZoom] = useState(1)

    // Canvas & State
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const brushCursorRef = useRef<HTMLDivElement>(null)
    const maskSavedRef = useRef(false)
    const isDrawingRef = useRef(false)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
    const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null)

    // The mask is an 8x8 grid, so undo stores only changed cells instead of
    // retaining a full RGBA canvas snapshot for every brush stroke.
    const gridDataRef = useRef<Set<number>>(new Set())
    const currentStrokeCellsRef = useRef<Set<number>>(new Set())
    const currentStrokePaintedRef = useRef(true)
    const historyRef = useRef<MaskHistoryAction[]>([])
    const historyStepRef = useRef(0)
    const [historyStep, setHistoryStep] = useState(0)

    const rebuildGridDataFromCanvas = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
        const nextGrid = new Set<number>()
        const columns = Math.ceil(canvas.width / GRID_SIZE)
        const rows = Math.ceil(canvas.height / GRID_SIZE)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data

        for (let gy = 0; gy < rows; gy++) {
            const sampleY = Math.min(gy * GRID_SIZE + Math.floor(GRID_SIZE / 2), canvas.height - 1)
            for (let gx = 0; gx < columns; gx++) {
                const sampleX = Math.min(gx * GRID_SIZE + Math.floor(GRID_SIZE / 2), canvas.width - 1)
                const alpha = pixels[(sampleY * canvas.width + sampleX) * 4 + 3]
                if (alpha > 10) nextGrid.add(gy * columns + gx)
            }
        }

        gridDataRef.current = nextGrid
    }

    // Reset when dialog closes - but only if we're NOT in the new sidebar workflow
    // (i.e., only reset if i2iMode is null, meaning dialog was opened for standalone generation)
    useEffect(() => {
        if (open) maskSavedRef.current = false
        if (!open) {
            // Check if we're in sidebar workflow mode - if so, don't reset
            const currentI2IMode = useGenerationStore.getState().i2iMode
            if (!currentI2IMode) {
                resetI2IParams()
            }
            historyRef.current = []
            historyStepRef.current = 0
            currentStrokeCellsRef.current = new Set()
            setHistoryStep(0)
            setImageSize(null)
            setDisplaySize(null)
            setZoom(1)
        }
    }, [open, propSourceImage, resetI2IParams, setSourceImage])

    useEffect(() => {
        if (open) setZoom(1)
    }, [open, propSourceImage])

    // Initial Canvas Setup - Now also restores existing mask
    useEffect(() => {
        if (!open || !propSourceImage) return

        const timer = setTimeout(() => {
            const canvas = canvasRef.current
            if (!canvas) return
            const ctx = canvas.getContext('2d')
            if (!ctx) return

            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                const width = img.naturalWidth || img.width
                const height = img.naturalHeight || img.height
                setImageSize({ width, height })
                canvas.width = width
                canvas.height = height
                ctx.clearRect(0, 0, canvas.width, canvas.height)

                // Restore existing mask if present
                if (existingMask) {
                    const maskImg = new Image()
                    maskImg.crossOrigin = 'anonymous'
                    maskImg.onload = () => {
                        ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height)
                        rebuildGridDataFromCanvas(canvas, ctx)
                    }
                    maskImg.src = existingMask
                } else {
                    gridDataRef.current = new Set()
                }
            }
            img.src = propSourceImage
        }, 100)
        return () => clearTimeout(timer)
    }, [open, propSourceImage, existingMask])

    useEffect(() => {
        const container = containerRef.current
        if (!open || !container || !imageSize) {
            setDisplaySize(null)
            return
        }

        const updateDisplaySize = () => {
            const style = window.getComputedStyle(container)
            const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0)
                + (Number.parseFloat(style.paddingRight) || 0)
            const verticalPadding = (Number.parseFloat(style.paddingTop) || 0)
                + (Number.parseFloat(style.paddingBottom) || 0)
            const availableWidth = Math.max(1, container.clientWidth - horizontalPadding)
            const availableHeight = Math.max(1, container.clientHeight - verticalPadding)
            const scale = Math.min(
                availableWidth / imageSize.width,
                availableHeight / imageSize.height,
            )
            const nextSize = {
                width: Math.max(1, Math.floor(imageSize.width * scale)),
                height: Math.max(1, Math.floor(imageSize.height * scale)),
            }

            setDisplaySize(current => current?.width === nextSize.width && current.height === nextSize.height
                ? current
                : nextSize)
        }

        updateDisplaySize()
        const observer = new ResizeObserver(updateDisplaySize)
        observer.observe(container)
        return () => observer.disconnect()
    }, [open, imageSize])

    // Last grid position for continuous drawing
    const lastGridPosRef = useRef<{ gx: number; gy: number } | null>(null)

    useEffect(() => {
        gridDataRef.current.clear()
        currentStrokeCellsRef.current = new Set()
        lastGridPosRef.current = null
        isDrawingRef.current = false
        setIsErasing(false)
        historyRef.current = []
        historyStepRef.current = 0
        setHistoryStep(0)

        if (!open) {
            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
    }, [open, propSourceImage])

    // Convert pixel coordinates to grid coordinates
    const pixelToGrid = (pixelX: number, pixelY: number, canvasWidth: number, canvasHeight: number) => {
        const gx = Math.floor(pixelX / GRID_SIZE)
        const gy = Math.floor(pixelY / GRID_SIZE)
        // Clamp to grid boundaries
        const maxGx = Math.floor(canvasWidth / GRID_SIZE) - 1
        const maxGy = Math.floor(canvasHeight / GRID_SIZE) - 1
        return {
            gx: Math.max(0, Math.min(gx, maxGx)),
            gy: Math.max(0, Math.min(gy, maxGy))
        }
    }

    const setGridCellState = (ctx: CanvasRenderingContext2D, gx: number, gy: number, painted: boolean) => {
        const canvas = ctx.canvas
        const columns = Math.ceil(canvas.width / GRID_SIZE)
        const rows = Math.ceil(canvas.height / GRID_SIZE)
        if (gx < 0 || gy < 0 || gx >= columns || gy >= rows) return false

        const cellId = gy * columns + gx
        const wasPainted = gridDataRef.current.has(cellId)
        if (wasPainted === painted) return false

        if (painted) {
            ctx.fillStyle = 'rgba(99, 102, 241, 0.7)'
            ctx.fillRect(gx * GRID_SIZE, gy * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            gridDataRef.current.add(cellId)
        } else {
            ctx.clearRect(gx * GRID_SIZE, gy * GRID_SIZE, GRID_SIZE, GRID_SIZE)
            gridDataRef.current.delete(cellId)
        }
        return true
    }

    // Fill a single grid cell and remember it once for the current stroke.
    const fillGridCell = (ctx: CanvasRenderingContext2D, gx: number, gy: number, erase: boolean) => {
        const painted = !erase
        if (!setGridCellState(ctx, gx, gy, painted)) return

        const columns = Math.ceil(ctx.canvas.width / GRID_SIZE)
        currentStrokeCellsRef.current.add(gy * columns + gx)
    }

    // Fill brush area (multiple grid cells based on brush size)
    const fillBrushArea = (ctx: CanvasRenderingContext2D, gx: number, gy: number, erase: boolean) => {
        const brushGridSize = Math.max(1, Math.floor(brushSize[0] / GRID_SIZE))
        const halfBrush = Math.floor(brushGridSize / 2)

        for (let offsetY = -halfBrush; offsetY <= halfBrush; offsetY++) {
            for (let offsetX = -halfBrush; offsetX <= halfBrush; offsetX++) {
                const targetGx = gx + offsetX
                const targetGy = gy + offsetY

                // Check bounds
                if (targetGx >= 0 && targetGy >= 0) {
                    fillGridCell(ctx, targetGx, targetGy, erase)
                }
            }
        }
    }

    // Draw line between two grid positions (Bresenham's algorithm)
    const drawGridLine = (ctx: CanvasRenderingContext2D, startGx: number, startGy: number, endGx: number, endGy: number, erase: boolean) => {
        const dx = Math.abs(endGx - startGx)
        const dy = Math.abs(endGy - startGy)
        const sx = startGx < endGx ? 1 : -1
        const sy = startGy < endGy ? 1 : -1
        let err = dx - dy

        let gx = startGx
        let gy = startGy

        while (true) {
            fillBrushArea(ctx, gx, gy, erase)

            if (gx === endGx && gy === endGy) break

            const e2 = 2 * err
            if (e2 > -dy) {
                err -= dy
                gx += sx
            }
            if (e2 < dx) {
                err += dx
                gy += sy
            }
        }
    }

    const startDrawing = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        e.currentTarget.setPointerCapture(e.pointerId)

        updateBrushCursor(e)
        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height
        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        const { gx, gy } = pixelToGrid(x, y, canvas.width, canvas.height)
        currentStrokeCellsRef.current = new Set()
        currentStrokePaintedRef.current = !isErasing
        lastGridPosRef.current = { gx, gy }
        fillBrushArea(ctx, gx, gy, isErasing)
        isDrawingRef.current = true
    }

    const stopDrawing = (e?: ReactPointerEvent<HTMLCanvasElement>) => {
        if (e?.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
        }
        if (isDrawingRef.current) {
            isDrawingRef.current = false
            commitHistory({
                painted: currentStrokePaintedRef.current,
                cells: [...currentStrokeCellsRef.current],
            })
            currentStrokeCellsRef.current = new Set()
        }
        lastGridPosRef.current = null
    }

    const draw = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        updateBrushCursor(e)
        if (!isDrawingRef.current || !lastGridPosRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        const x = (e.clientX - rect.left) * scaleX
        const y = (e.clientY - rect.top) * scaleY

        const { gx, gy } = pixelToGrid(x, y, canvas.width, canvas.height)

        // Only draw if moved to a different grid cell
        if (gx !== lastGridPosRef.current.gx || gy !== lastGridPosRef.current.gy) {
            drawGridLine(ctx, lastGridPosRef.current.gx, lastGridPosRef.current.gy, gx, gy, isErasing)
            lastGridPosRef.current = { gx, gy }
        }
    }

    const updateBrushCursor = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current
        const cursor = brushCursorRef.current
        if (!canvas || !cursor) return

        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const brushGridSize = Math.max(1, Math.floor(inpaintingBrushSize / GRID_SIZE))
        const brushRadius = Math.floor(brushGridSize / 2)
        const brushPixels = (brushRadius * 2 + 1) * GRID_SIZE
        const renderedBrushSize = brushPixels * (rect.width / canvas.width)
        cursor.style.width = `${renderedBrushSize}px`
        cursor.style.height = `${renderedBrushSize}px`
        cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
        cursor.style.opacity = '1'
    }

    const hideBrushCursor = () => {
        if (brushCursorRef.current) brushCursorRef.current.style.opacity = '0'
    }

    const commitHistory = (action: MaskHistoryAction) => {
        if (action.cells.length === 0) return

        const appliedHistory = historyRef.current.slice(0, historyStepRef.current)
        appliedHistory.push(action)
        const nextHistory = appliedHistory.length > MAX_UNDO_STEPS
            ? appliedHistory.slice(-MAX_UNDO_STEPS)
            : appliedHistory

        historyRef.current = nextHistory
        historyStepRef.current = nextHistory.length
        setHistoryStep(nextHistory.length)
    }

    // Undo last action
    const undo = () => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        const currentStep = historyStepRef.current
        if (!canvas || !ctx || currentStep <= 0) return

        const action = historyRef.current[currentStep - 1]
        const columns = Math.ceil(canvas.width / GRID_SIZE)
        for (const cellId of action.cells) {
            const gx = cellId % columns
            const gy = Math.floor(cellId / columns)
            setGridCellState(ctx, gx, gy, !action.painted)
        }

        const nextStep = currentStep - 1
        historyStepRef.current = nextStep
        setHistoryStep(nextStep)
    }

    // Clear canvas
    const clearCanvas = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const paintedCells = [...gridDataRef.current]
        if (paintedCells.length === 0) return

        ctx.clearRect(0, 0, canvas.width, canvas.height)
        gridDataRef.current = new Set()
        commitHistory({ painted: false, cells: paintedCells })
    }

    // Handle save mask button click - saves mask and sets up inpaint mode
    const handleSaveMask = () => {
        const canvas = canvasRef.current
        if (!canvas || !propSourceImage) return

        // Get mask data and save to store
        const maskDataUrl = canvas.toDataURL('image/png')
        
        // Set source image, mask, and mode together (triggers sidebar display)
        setSourceImage(propSourceImage)
        setMask(maskDataUrl)
        setI2IMode('inpaint')
        maskSavedRef.current = true

        // Close dialog - mask is now saved in store
        onOpenChange(false)
        onMaskSaved?.()
    }

    const handleCloseWithoutSaving = () => {
        setMask(null)
        setI2IMode(null)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (nextOpen) return
            if (maskSavedRef.current) {
                maskSavedRef.current = false
                onOpenChange(false)
                return
            }
            handleCloseWithoutSaving()
        }}>
            <DialogContent className="flex flex-col p-6 gap-4" style={{ maxWidth: '60vw', maxHeight: '85vh', width: '60vw', height: '85vh' }}>
                <DialogHeader className="mb-0 shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Paintbrush className="w-5 h-5" />
                        {t('tools.inpainting.title', 'Inpainting')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('tools.inpainting.description', 'Mask areas to regenerate.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
                    {/* Canvas Area - now takes full width */}
                    <div className="flex-1 flex flex-col gap-2 min-w-0">
                        {/* Toolbar */}
                        <div className="flex gap-6 shrink-0 items-center justify-center p-2 bg-muted/20 rounded-lg border">
                            <div className="flex items-center gap-2">
                                <Button
                                    variant={!isErasing ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setIsErasing(false)}
                                    className={!isErasing ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
                                >
                                    <Paintbrush className="w-4 h-4 mr-2" />
                                    {t('common.brush', 'Brush')}
                                </Button>
                                <Button
                                    variant={isErasing ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setIsErasing(true)}
                                    className={isErasing ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
                                >
                                    <Eraser className="w-4 h-4 mr-2" />
                                    {t('common.eraser', 'Eraser')}
                                </Button>
                            </div>

                            <div className="h-6 w-px bg-border mx-2" />

                            <div className="flex items-center gap-3">
                                <Label className="text-sm whitespace-nowrap">{t('common.size', 'Size')}</Label>
                                <div className="flex items-center gap-2">
                                    <Slider
                                        value={brushSize}
                                        min={5}
                                        max={100}
                                        step={5}
                                        onValueChange={setBrushSize}
                                        className="w-32"
                                    />
                                    <span className="text-xs text-muted-foreground w-8 text-center">{brushSize[0]}</span>
                                </div>
                            </div>

                            <div className="h-6 w-px bg-border mx-2" />

                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setZoom(current => Math.max(0.5, current - 0.25))}
                                    disabled={zoom <= 0.5}
                                    title={t('tools.inpainting.zoomOut', 'Zoom out')}
                                    aria-label={t('tools.inpainting.zoomOut', 'Zoom out')}
                                >
                                    <ZoomOut className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-14 tabular-nums"
                                    onClick={() => setZoom(1)}
                                    title={t('tools.inpainting.resetZoom', 'Reset zoom')}
                                >
                                    {Math.round(zoom * 100)}%
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setZoom(current => Math.min(3, current + 0.25))}
                                    disabled={zoom >= 3}
                                    title={t('tools.inpainting.zoomIn', 'Zoom in')}
                                    aria-label={t('tools.inpainting.zoomIn', 'Zoom in')}
                                >
                                    <ZoomIn className="w-4 h-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setZoom(1)}
                                    title={t('tools.inpainting.resetZoom', 'Reset zoom')}
                                    aria-label={t('tools.inpainting.resetZoom', 'Reset zoom')}
                                >
                                    <RotateCcw className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="h-6 w-px bg-border mx-2" />

                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="icon" onClick={undo} disabled={historyStep <= 0}>
                                    <Undo className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={clearCanvas}>
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Canvas Container */}
                        <div
                            ref={containerRef}
                            className="flex-1 relative overflow-auto rounded-lg bg-muted/50 flex items-center justify-center p-4 min-h-0"
                        >
                            {propSourceImage && (
                                <div
                                    className="relative shrink-0"
                                    style={{
                                        width: displaySize ? `${Math.round(displaySize.width * zoom)}px` : '1px',
                                        height: displaySize ? `${Math.round(displaySize.height * zoom)}px` : '1px',
                                        visibility: displaySize ? 'visible' : 'hidden',
                                    }}
                                >
                                    <img
                                        src={propSourceImage}
                                        alt="Source"
                                        className="block w-full h-full"
                                        onLoad={(e) => {
                                            const img = e.currentTarget
                                            setImageSize({ width: img.naturalWidth, height: img.naturalHeight })

                                            if (canvasRef.current) {
                                                // Set canvas internal resolution to image natural size
                                                canvasRef.current.width = img.naturalWidth
                                                canvasRef.current.height = img.naturalHeight

                                                // Restore existing mask
                                                if (existingMask) {
                                                    const ctx = canvasRef.current.getContext('2d')
                                                    if (ctx) {
                                                        const maskImg = new Image()
                                                        maskImg.crossOrigin = 'anonymous'
                                                        maskImg.onload = () => {
                                                            const canvas = canvasRef.current
                                                            if (!canvas) return
                                                            ctx.drawImage(maskImg, 0, 0, canvas.width, canvas.height)
                                                            rebuildGridDataFromCanvas(canvas, ctx)
                                                        }
                                                        maskImg.src = existingMask
                                                    }
                                                }
                                            }
                                        }}
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        className="absolute top-0 left-0 w-full h-full touch-none cursor-crosshair opacity-50"
                                        onPointerDown={startDrawing}
                                        onPointerMove={draw}
                                        onPointerUp={stopDrawing}
                                        onPointerCancel={stopDrawing}
                                        onPointerEnter={updateBrushCursor}
                                        onPointerLeave={hideBrushCursor}
                                    />
                                    <div
                                        ref={brushCursorRef}
                                        className="pointer-events-none absolute left-0 top-0 rounded-full border-2 border-white/90 bg-primary/15 shadow-[0_0_0_1px_rgba(0,0,0,0.7)] transition-opacity duration-100"
                                        style={{ opacity: 0 }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-4 sm:justify-end items-center gap-2">
                    <Button variant="outline" onClick={handleCloseWithoutSaving}>
                        {t('common.cancel', 'Cancel')}
                    </Button>
                    <Button
                        className="bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-700 hover:to-rose-700 text-white"
                        onClick={handleSaveMask}
                        disabled={!propSourceImage}
                    >
                        <Save className="w-4 h-4 mr-2" />
                        {t('sourcePanel.saveMask', '마스크 저장')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
