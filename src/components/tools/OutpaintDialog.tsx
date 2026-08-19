import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RotateCcw } from 'lucide-react'
import { useGenerationStore } from '@/stores/generation-store'

type Edge = 'top' | 'right' | 'bottom' | 'left'
type Expansion = Record<Edge, number>

const EMPTY_EXPANSION: Expansion = { top: 0, right: 0, bottom: 0, left: 0 }
const SNAP_SIZE = 64
const OVERLAP = 32

const snap = (value: number) => Math.max(0, Math.round(value / SNAP_SIZE) * SNAP_SIZE)

interface OutpaintDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    sourceImage: string | null
    onReady: () => void
}

export function OutpaintDialog({ open, onOpenChange, sourceImage, onReady }: OutpaintDialogProps) {
    const { t } = useTranslation()
    const svgRef = useRef<SVGSVGElement>(null)
    const sourceRef = useRef<HTMLImageElement | null>(null)
    const dragRef = useRef<{ edge: Edge; x: number; y: number; scale: number; expansion: Expansion } | null>(null)
    const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null)
    const [expansion, setExpansion] = useState<Expansion>(EMPTY_EXPANSION)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        if (!open || !sourceImage) return
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.onload = () => {
            sourceRef.current = image
            setSourceSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height })
            setExpansion(EMPTY_EXPANSION)
        }
        image.src = sourceImage
        return () => { sourceRef.current = null }
    }, [open, sourceImage])

    useEffect(() => {
        if (!dragging) return
        const move = (event: PointerEvent) => {
            const drag = dragRef.current
            if (!drag) return
            const dx = (event.clientX - drag.x) / drag.scale
            const dy = (event.clientY - drag.y) / drag.scale
            const delta = drag.edge === 'left' ? -dx : drag.edge === 'right' ? dx : drag.edge === 'top' ? -dy : dy
            setExpansion({ ...drag.expansion, [drag.edge]: snap(drag.expansion[drag.edge] + delta) })
        }
        const end = () => {
            dragRef.current = null
            setDragging(false)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end, { once: true })
        return () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
        }
    }, [dragging])

    const target = useMemo(() => sourceSize && {
        width: sourceSize.width + expansion.left + expansion.right,
        height: sourceSize.height + expansion.top + expansion.bottom,
    }, [sourceSize, expansion])
    const overlap = sourceSize ? Math.min(OVERLAP, Math.floor(Math.min(sourceSize.width, sourceSize.height) / 4)) : 0
    const startDrag = (edge: Edge, event: ReactPointerEvent<SVGLineElement>) => {
        event.preventDefault()
        const scale = Math.abs(svgRef.current?.getScreenCTM()?.a || 1)
        dragRef.current = { edge, x: event.clientX, y: event.clientY, scale, expansion: { ...expansion } }
        setDragging(true)
    }

    const sendToInpaint = () => {
        const image = sourceRef.current
        if (!image || !sourceSize || !target || Object.values(expansion).every(value => value === 0)) return

        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = target.width
        sourceCanvas.height = target.height
        const sourceContext = sourceCanvas.getContext('2d')
        const maskCanvas = document.createElement('canvas')
        maskCanvas.width = target.width
        maskCanvas.height = target.height
        const maskContext = maskCanvas.getContext('2d')
        if (!sourceContext || !maskContext) return

        sourceContext.fillStyle = '#000'
        sourceContext.fillRect(0, 0, target.width, target.height)
        sourceContext.drawImage(image, expansion.left, expansion.top, sourceSize.width, sourceSize.height)
        // Keep preserved pixels transparent. The shared API mask converter treats
        // every opaque pixel as an inpaint region, regardless of its RGB value.
        maskContext.fillStyle = '#fff'
        if (expansion.top) maskContext.fillRect(0, 0, target.width, expansion.top + overlap)
        if (expansion.bottom) maskContext.fillRect(0, expansion.top + sourceSize.height - overlap, target.width, expansion.bottom + overlap)
        if (expansion.left) maskContext.fillRect(0, 0, expansion.left + overlap, target.height)
        if (expansion.right) maskContext.fillRect(expansion.left + sourceSize.width - overlap, 0, expansion.right + overlap, target.height)

        const generation = useGenerationStore.getState()
        generation.setSourceImage(sourceCanvas.toDataURL('image/png'))
        generation.setMask(maskCanvas.toDataURL('image/png'))
        generation.setI2IMode('inpaint')
        onOpenChange(false)
        onReady()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!flex h-[82vh] max-h-[82vh] min-h-0 w-[78vw] max-w-none !flex-col gap-3 overflow-hidden p-4">
                <DialogHeader className="flex-row items-center justify-between space-y-0 pr-8">
                    <DialogTitle>{t('smartTools.outpaintEditor', '이미지 확장')}</DialogTitle>
                    <Button variant="ghost" size="icon" onClick={() => setExpansion(EMPTY_EXPANSION)} title={t('smartTools.outpaintReset', '확장 초기화')}>
                        <RotateCcw className="h-4 w-4" />
                    </Button>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-muted/20 p-2">
                    {sourceImage && target && sourceSize && (
                        <svg
                            ref={svgRef}
                            viewBox={`0 0 ${target.width} ${target.height}`}
                            preserveAspectRatio="xMidYMid meet"
                            className="h-full w-full select-none drop-shadow-xl"
                        >
                            <rect width={target.width} height={target.height} fill="black" />
                            <image href={sourceImage} x={expansion.left} y={expansion.top} width={sourceSize.width} height={sourceSize.height} preserveAspectRatio="none" />
                            {expansion.top > 0 && <rect width={target.width} height={expansion.top + overlap} fill="white" fillOpacity={0.15} />}
                            {expansion.bottom > 0 && <rect y={expansion.top + sourceSize.height - overlap} width={target.width} height={expansion.bottom + overlap} fill="white" fillOpacity={0.15} />}
                            {expansion.left > 0 && <rect width={expansion.left + overlap} height={target.height} fill="white" fillOpacity={0.15} />}
                            {expansion.right > 0 && <rect x={expansion.left + sourceSize.width - overlap} width={expansion.right + overlap} height={target.height} fill="white" fillOpacity={0.15} />}
                            <rect x={expansion.left} y={expansion.top} width={sourceSize.width} height={sourceSize.height} fill="none" stroke="white" strokeOpacity={0.45} vectorEffect="non-scaling-stroke" />
                            {(['top', 'right', 'bottom', 'left'] as Edge[]).map(edge => {
                                const vertical = edge === 'left' || edge === 'right'
                                const fixed = edge === 'top'
                                    ? expansion.top
                                    : edge === 'bottom'
                                        ? expansion.top + sourceSize.height
                                        : edge === 'left'
                                            ? expansion.left
                                            : expansion.left + sourceSize.width
                                return <line
                                    key={edge}
                                    x1={vertical ? fixed : expansion.left}
                                    y1={vertical ? expansion.top : fixed}
                                    x2={vertical ? fixed : expansion.left + sourceSize.width}
                                    y2={vertical ? expansion.top + sourceSize.height : fixed}
                                    onPointerDown={event => startDrag(edge, event)}
                                    className="stroke-primary opacity-70 transition-opacity hover:opacity-100"
                                    style={{ cursor: vertical ? 'ew-resize' : 'ns-resize' }}
                                    strokeWidth={10}
                                    strokeLinecap="round"
                                    vectorEffect="non-scaling-stroke"
                                    aria-label={edge}
                                />
                            })}
                        </svg>
                    )}
                </div>
                <DialogFooter className="flex-row items-center justify-between sm:justify-between">
                    <span className="text-xs text-muted-foreground">{target ? `${target.width} x ${target.height}` : ''}</span>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', '취소')}</Button>
                        <Button onClick={sendToInpaint} disabled={!target || Object.values(expansion).every(value => value === 0)}>{t('smartTools.sendToInpaint', '인페인트로 보내기')}</Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
