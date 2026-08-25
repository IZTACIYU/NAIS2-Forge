import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { useState, useRef, useCallback, useEffect, MouseEvent } from "react"
import { useTranslation } from "react-i18next"
import { Download, Grid3X3, Minus, Plus, Redo, Undo } from "lucide-react"
import { save } from "@tauri-apps/plugin-dialog"
import { writeFile } from "@tauri-apps/plugin-fs"
import { toast } from "@/components/ui/use-toast"
import { useToolsStore } from '@/stores/tools-store'
import { appendBoundedHistory, getHistoryShortcut } from '@/lib/utils'

const MAX_HISTORY_STEPS = 50

interface MosaicBlock {
    key: string
    x: number
    y: number
    size: number
    color: string
}

interface MosaicHistoryAction {
    added: MosaicBlock[]
    removed: MosaicBlock[]
}

interface MosaicDialogProps {
    sourceImage: string | null
    isOpen: boolean
    onClose: () => void
}

export function MosaicDialog({
    sourceImage,
    isOpen,
    onClose
}: MosaicDialogProps) {
    const { t } = useTranslation()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDrawing, setIsDrawing] = useState(false)


    // Persisted state
    const {
        mosaicPixelSize: pixelSize,
        setMosaicPixelSize: setPixelSize,
        mosaicBrushSize: brushSize,
        setMosaicBrushSize: setBrushSize
    } = useToolsStore()

    // Track rendered blocks so undo can rebuild from the untouched source pixels.
    const mosaicBlocksRef = useRef<Map<string, MosaicBlock>>(new Map())
    const currentStrokeBlocksRef = useRef<MosaicBlock[]>([])
    // Store original image pixels
    const originalImageDataRef = useRef<ImageData | null>(null)
    const historyRef = useRef<MosaicHistoryAction[]>([])
    const historyStepRef = useRef(0)
    const [historyStep, setHistoryStep] = useState(0)


    // Initialize canvas when dialog opens or image changes
    useEffect(() => {
        if (!isOpen || !sourceImage) return

        // Small delay to ensure canvas is rendered
        const timer = setTimeout(() => {
            const canvas = canvasRef.current
            if (!canvas) {
                console.log("Canvas not ready")
                return
            }

            const ctx = canvas.getContext('2d')
            if (!ctx) {
                console.log("Context not ready")
                return
            }

            const img = new Image()
            img.crossOrigin = 'anonymous'
            img.onload = () => {
                console.log("Image loaded:", img.width, img.height)
                // Set canvas size to match image
                canvas.width = img.width
                canvas.height = img.height

                // Draw original image
                ctx.drawImage(img, 0, 0)

                // Store original image data for reference
                originalImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)

                // Clear mosaicked regions tracking
                mosaicBlocksRef.current.clear()
                currentStrokeBlocksRef.current = []
                historyRef.current = []
                historyStepRef.current = 0
                setHistoryStep(0)
            }
            img.onerror = (e) => {
                console.error("Image load error", e)
            }
            img.src = sourceImage
        }, 100)

        return () => clearTimeout(timer)
    }, [isOpen, sourceImage])

    useEffect(() => {
        if (isOpen) return
        mosaicBlocksRef.current.clear()
        currentStrokeBlocksRef.current = []
        historyRef.current = []
        historyStepRef.current = 0
        setHistoryStep(0)
    }, [isOpen])

    const rebuildCanvas = useCallback(() => {
        const canvas = canvasRef.current
        const original = originalImageDataRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !original || !ctx) return
        ctx.putImageData(original, 0, 0)
        for (const block of mosaicBlocksRef.current.values()) {
            ctx.fillStyle = block.color
            ctx.fillRect(block.x, block.y, block.size, block.size)
        }
    }, [])

    const commitHistory = useCallback((action: MosaicHistoryAction) => {
        if (action.added.length === 0 && action.removed.length === 0) return
        const nextHistory = appendBoundedHistory(
            historyRef.current,
            historyStepRef.current,
            action,
            MAX_HISTORY_STEPS,
        )
        historyRef.current = nextHistory
        historyStepRef.current = nextHistory.length
        setHistoryStep(nextHistory.length)
    }, [])

    const undo = useCallback(() => {
        const currentStep = historyStepRef.current
        const action = historyRef.current[currentStep - 1]
        if (!action) return
        for (const block of action.added) mosaicBlocksRef.current.delete(block.key)
        for (const block of action.removed) mosaicBlocksRef.current.set(block.key, block)
        rebuildCanvas()
        historyStepRef.current = currentStep - 1
        setHistoryStep(currentStep - 1)
    }, [rebuildCanvas])

    const redo = useCallback(() => {
        const currentStep = historyStepRef.current
        const action = historyRef.current[currentStep]
        if (!action) return
        for (const block of action.removed) mosaicBlocksRef.current.delete(block.key)
        for (const block of action.added) mosaicBlocksRef.current.set(block.key, block)
        rebuildCanvas()
        historyStepRef.current = currentStep + 1
        setHistoryStep(currentStep + 1)
    }, [rebuildCanvas])

    const getCellKey = (cellX: number, cellY: number): string => {
        return `${pixelSize}:${cellX},${cellY}`
    }

    const applyMosaicToRegion = useCallback((clientX: number, clientY: number) => {
        const canvas = canvasRef.current
        if (!canvas || !originalImageDataRef.current) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        const centerX = (clientX - rect.left) * scaleX
        const centerY = (clientY - rect.top) * scaleY

        const halfBrush = brushSize / 2
        const startX = Math.max(0, centerX - halfBrush)
        const startY = Math.max(0, centerY - halfBrush)
        const endX = Math.min(canvas.width, centerX + halfBrush)
        const endY = Math.min(canvas.height, centerY + halfBrush)

        // Calculate grid-aligned positions
        const gridStartX = Math.floor(startX / pixelSize) * pixelSize
        const gridStartY = Math.floor(startY / pixelSize) * pixelSize

        const originalData = originalImageDataRef.current

        for (let py = gridStartY; py < endY; py += pixelSize) {
            for (let px = gridStartX; px < endX; px += pixelSize) {
                const cellX = Math.floor(px / pixelSize)
                const cellY = Math.floor(py / pixelSize)
                const cellKey = getCellKey(cellX, cellY)

                // Skip if this cell was already mosaicked
                if (mosaicBlocksRef.current.has(cellKey)) continue

                // Get the average color from the ORIGINAL image data
                const sampleX = Math.min(Math.floor(px), canvas.width - 1)
                const sampleY = Math.min(Math.floor(py), canvas.height - 1)
                const pixelIndex = (sampleY * canvas.width + sampleX) * 4

                const r = originalData.data[pixelIndex]
                const g = originalData.data[pixelIndex + 1]
                const b = originalData.data[pixelIndex + 2]
                const a = originalData.data[pixelIndex + 3]

                // Draw mosaic block
                const color = `rgba(${r},${g},${b},${a / 255})`
                ctx.fillStyle = color
                ctx.fillRect(px, py, pixelSize, pixelSize)

                // Mark this cell as mosaicked
                const block = { key: cellKey, x: px, y: py, size: pixelSize, color }
                mosaicBlocksRef.current.set(cellKey, block)
                currentStrokeBlocksRef.current.push(block)
            }
        }
    }, [pixelSize, brushSize])

    const handleMouseDown = useCallback((e: MouseEvent) => {
        if (e.button !== 0) return
        currentStrokeBlocksRef.current = []
        setIsDrawing(true)
        applyMosaicToRegion(e.clientX, e.clientY)
    }, [applyMosaicToRegion])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDrawing) return
        applyMosaicToRegion(e.clientX, e.clientY)
    }, [isDrawing, applyMosaicToRegion])

    const handleMouseUp = useCallback(() => {
        setIsDrawing(false)
        commitHistory({ added: currentStrokeBlocksRef.current, removed: [] })
        currentStrokeBlocksRef.current = []
    }, [commitHistory])

    useEffect(() => {
        if (isDrawing) {
            window.addEventListener('mouseup', handleMouseUp)
            return () => window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [handleMouseUp, isDrawing])

    useEffect(() => {
        if (!isOpen) return
        const handleHistoryShortcut = (event: KeyboardEvent) => {
            const action = getHistoryShortcut(event)
            if (!action) return
            event.preventDefault()
            if (action === 'undo') undo()
            else redo()
        }
        window.addEventListener('keydown', handleHistoryShortcut)
        return () => window.removeEventListener('keydown', handleHistoryShortcut)
    }, [isOpen, redo, undo])

    const handleReset = useCallback(() => {
        if (!canvasRef.current || !originalImageDataRef.current) return

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const removed = [...mosaicBlocksRef.current.values()]
        if (removed.length === 0) return
        mosaicBlocksRef.current.clear()
        ctx.putImageData(originalImageDataRef.current, 0, 0)
        commitHistory({ added: [], removed })
    }, [commitHistory])

    const handleSaveAs = async () => {
        if (!canvasRef.current) return

        try {
            const filePath = await save({
                defaultPath: `mosaic_${Date.now()}.png`,
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            })

            if (!filePath) return

            const dataUrl = canvasRef.current.toDataURL('image/png')
            const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
            const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

            await writeFile(filePath, binaryData)

            toast({ title: t('common.saved', '저장되었습니다'), variant: 'success' })
            onClose()
        } catch (e) {
            console.error("Failed to save image", e)
            toast({ title: t('common.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="flex flex-col p-6" style={{ maxWidth: '60vw', maxHeight: '85vh', width: '60vw', height: '85vh' }}>
                <DialogHeader className="mb-2 shrink-0">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <Grid3X3 className="h-5 w-5" />
                        {t('smartTools.mosaicEditor', '모자이크 편집기')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('smartTools.mosaicEditorDesc', '마우스로 드래그하여 모자이크를 적용하세요.')}
                    </DialogDescription>
                </DialogHeader>

                {/* Controls */}
                <div className="flex gap-6 mb-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <Label className="text-sm whitespace-nowrap">{t('smartTools.pixelSize', '픽셀 크기')}</Label>
                        <div className="flex items-center gap-2">
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <Slider
                                value={[pixelSize]}
                                onValueChange={(v) => setPixelSize(v[0])}
                                min={5}
                                max={30}
                                step={1}
                                className="w-24"
                            />
                            <Plus className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground w-6">{pixelSize}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Label className="text-sm whitespace-nowrap">{t('smartTools.brushSize', '브러쉬 크기')}</Label>
                        <div className="flex items-center gap-2">
                            <Minus className="h-3 w-3 text-muted-foreground" />
                            <Slider
                                value={[brushSize]}
                                onValueChange={(v) => setBrushSize(v[0])}
                                min={20}
                                max={150}
                                step={5}
                                className="w-24"
                            />
                            <Plus className="h-3 w-3 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground w-8">{brushSize}</span>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={undo} disabled={historyStep === 0} title={t('smartTools.undo')} aria-label={t('smartTools.undo')}>
                        <Undo className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={redo} disabled={historyStep >= historyRef.current.length} title={t('smartTools.redo')} aria-label={t('smartTools.redo')}>
                        <Redo className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleReset}>
                        {t('smartTools.reset', '초기화')}
                    </Button>
                </div>

                {/* Canvas Container */}
                <div
                    ref={containerRef}
                    className="flex-1 relative overflow-hidden rounded-lg bg-muted/50 flex items-center justify-center p-4"
                    style={{ minHeight: '400px' }}
                >
                    <canvas
                        ref={canvasRef}
                        className="cursor-crosshair"
                        style={{
                            imageRendering: 'pixelated',
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain'
                        }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />
                </div>

                <DialogFooter className="mt-4 sm:justify-end items-center gap-2">
                    <Button variant="outline" onClick={onClose}>
                        {t('common.cancel', '취소')}
                    </Button>
                    <Button onClick={handleSaveAs}>
                        <Download className="h-4 w-4 mr-2" />
                        {t('library.download', '저장')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
