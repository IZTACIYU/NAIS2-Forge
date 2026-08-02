import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { CHARACTER_POSITION_GRID_SIZE, snapCharacterPosition } from '@/lib/character-position-grid'

export interface CharacterPositionMarker {
    id: string
    label: string
    position: { x: number, y: number }
    color: string
    enabled?: boolean
}

interface CharacterPositionBoardProps {
    markers: CharacterPositionMarker[]
    aspectRatio: number
    onPositionChange: (id: string, x: number, y: number) => void
    className?: string
    markerClassName?: string
    emptyContent?: ReactNode
    selectedId?: string | null
    onSelectedIdChange?: (id: string | null) => void
}

export function CharacterPositionBoard({
    markers,
    aspectRatio,
    onPositionChange,
    className,
    markerClassName = 'h-10 w-10 text-sm',
    emptyContent,
    selectedId: controlledSelectedId,
    onSelectedIdChange,
}: CharacterPositionBoardProps) {
    const boardRef = useRef<HTMLDivElement>(null)
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<string | null>(null)
    const enabledMarkers = markers.filter(marker => marker.enabled !== false)
    const selectedId = controlledSelectedId === undefined ? uncontrolledSelectedId : controlledSelectedId
    const setSelectedId = (id: string | null) => {
        if (controlledSelectedId === undefined) setUncontrolledSelectedId(id)
        onSelectedIdChange?.(id)
    }

    const updatePositionFromPointer = (id: string, clientX: number, clientY: number) => {
        if (!boardRef.current) return
        const rect = boardRef.current.getBoundingClientRect()
        const x = snapCharacterPosition((clientX - rect.left) / rect.width)
        const y = snapCharacterPosition((clientY - rect.top) / rect.height)
        onPositionChange(id, x, y)
    }

    const handleMarkerMouseDown = (event: ReactMouseEvent, id: string) => {
        event.preventDefault()
        setDraggingId(id)
        setSelectedId(id)
    }

    const handleBoardMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.target !== event.currentTarget || !selectedId) return
        updatePositionFromPointer(selectedId, event.clientX, event.clientY)
    }

    const handleBoardMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (draggingId) updatePositionFromPointer(draggingId, event.clientX, event.clientY)
    }

    useEffect(() => {
        const stopDragging = () => setDraggingId(null)
        window.addEventListener('mouseup', stopDragging)
        return () => window.removeEventListener('mouseup', stopDragging)
    }, [])

    useEffect(() => {
        if (selectedId && enabledMarkers.some(marker => marker.id === selectedId)) return
        setSelectedId(enabledMarkers[0]?.id || null)
    }, [enabledMarkers, selectedId])

    return (
        <div
            ref={boardRef}
            className={cn('relative mx-auto w-full cursor-crosshair select-none overflow-hidden rounded-lg border bg-muted/30 shadow-inner', className)}
            style={{ aspectRatio }}
            onMouseDown={handleBoardMouseDown}
            onMouseMove={handleBoardMouseMove}
            onMouseUp={() => setDraggingId(null)}
            onMouseLeave={() => setDraggingId(null)}
        >
            <div className="pointer-events-none absolute inset-0 grid grid-cols-5 grid-rows-5">
                {Array.from({ length: CHARACTER_POSITION_GRID_SIZE ** 2 }, (_, index) => (
                    <div key={index} className="border border-border/20" />
                ))}
            </div>

            {enabledMarkers.map(marker => (
                <div
                    key={marker.id}
                    className={cn(
                        'absolute flex items-center justify-center rounded-full font-bold text-white shadow-lg transition-transform cursor-grab active:cursor-grabbing',
                        markerClassName,
                        selectedId === marker.id && 'z-10 scale-110 ring-2 ring-white ring-offset-2 ring-offset-black/50',
                        draggingId === marker.id && 'z-20 scale-125',
                    )}
                    style={{
                        left: `${marker.position.x * 100}%`,
                        top: `${marker.position.y * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: marker.color,
                    }}
                    onMouseDown={event => handleMarkerMouseDown(event, marker.id)}
                    title={marker.label}
                >
                    {marker.label}
                </div>
            ))}

            {enabledMarkers.length === 0 && emptyContent}
        </div>
    )
}
