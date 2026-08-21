import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
    CHARACTER_POSITION_GRID_SIZE,
    resolveCharacterPosition,
    type CharacterPositionMode,
} from '@/lib/character-position-grid'

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
    onPositionCommit?: (id: string, x: number, y: number) => void
    className?: string
    markerClassName?: string
    gridClassName?: string
    emptyContent?: ReactNode
    selectedId?: string | null
    onSelectedIdChange?: (id: string | null) => void
    mode?: CharacterPositionMode
    onDraggingChange?: (dragging: boolean) => void
}

export function CharacterPositionBoard({
    markers,
    aspectRatio,
    onPositionChange,
    onPositionCommit,
    className,
    markerClassName = 'h-10 w-10 text-sm',
    gridClassName = 'border-border/20',
    emptyContent,
    selectedId: controlledSelectedId,
    onSelectedIdChange,
    mode = 'grid',
    onDraggingChange,
}: CharacterPositionBoardProps) {
    const boardRef = useRef<HTMLDivElement>(null)
    const draggingIdRef = useRef<string | null>(null)
    const lastPositionRef = useRef<{ id: string, x: number, y: number } | null>(null)
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
        const x = resolveCharacterPosition((clientX - rect.left) / rect.width, mode)
        const y = resolveCharacterPosition((clientY - rect.top) / rect.height, mode)
        lastPositionRef.current = { id, x, y }
        onPositionChange(id, x, y)
        return { x, y }
    }

    const handleMarkerMouseDown = (event: ReactMouseEvent, id: string) => {
        event.preventDefault()
        draggingIdRef.current = id
        lastPositionRef.current = null
        setDraggingId(id)
        onDraggingChange?.(true)
        setSelectedId(id)
    }

    const handleBoardMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.target !== event.currentTarget || !selectedId) return
        const position = updatePositionFromPointer(selectedId, event.clientX, event.clientY)
        if (position) onPositionCommit?.(selectedId, position.x, position.y)
    }

    const handleBoardMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
        if (draggingId) updatePositionFromPointer(draggingId, event.clientX, event.clientY)
    }

    useEffect(() => {
        const stopDragging = () => {
            const lastPosition = lastPositionRef.current
            if (lastPosition && lastPosition.id === draggingIdRef.current) {
                onPositionCommit?.(lastPosition.id, lastPosition.x, lastPosition.y)
            }
            draggingIdRef.current = null
            lastPositionRef.current = null
            setDraggingId(null)
            onDraggingChange?.(false)
        }
        window.addEventListener('mouseup', stopDragging)
        return () => window.removeEventListener('mouseup', stopDragging)
    }, [onDraggingChange, onPositionCommit])

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
        >
            {mode === 'grid' && (
                <div className="pointer-events-none absolute inset-0 grid grid-cols-5 grid-rows-5">
                    {Array.from({ length: CHARACTER_POSITION_GRID_SIZE ** 2 }, (_, index) => (
                        <div key={index} className={cn('border', gridClassName)} />
                    ))}
                </div>
            )}

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
