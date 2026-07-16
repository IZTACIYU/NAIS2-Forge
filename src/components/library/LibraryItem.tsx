import { memo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getFirstLibraryLeaf, LibraryItem as LibraryItemType, useLibraryStore } from '@/stores/library-store'
import { convertFileSrc } from '@tauri-apps/api/core'
import { LibraryContextMenu } from './LibraryContextMenu'
import { cn } from '@/lib/utils'
import { Check, Square, Layers } from 'lucide-react'
import { ensureLibraryThumbnail, LIBRARY_THUMBNAIL_VERSION } from '@/lib/library-thumbnail'
import { useNearViewport } from '@/hooks/use-near-viewport'

interface LibraryItemProps {
    item: LibraryItemType
    className?: string
    isOverlay?: boolean
    onRename?: (item: LibraryItemType) => void
    onAddRef?: (item: LibraryItemType) => void
    onLoadMetadata?: (item: LibraryItemType) => void
    onImageClick?: (imageUrl: string) => void
    isEditMode?: boolean
    isSelected?: boolean
    onSelectionClick?: (e: React.MouseEvent) => void
    isDropTarget?: boolean
}

export const LibraryItem = memo(function LibraryItem({ item, className, isOverlay, onRename, onAddRef, onLoadMetadata, onImageClick, isEditMode, isSelected, onSelectionClick, isDropTarget }: LibraryItemProps) {
    const { t } = useTranslation()
    const [imageUrl, setImageUrl] = useState<string>('')
    const [isLoading, setIsLoading] = useState(true)
    const [containerRef, isNearViewport] = useNearViewport<HTMLDivElement>('500px 0px', !isOverlay)

    const hasCurrentThumbnail = Boolean(
        item.thumbnailPath && item.thumbnailVersion === LIBRARY_THUMBNAIL_VERSION
    )

    useEffect(() => {
        let cancelled = false
        if (!isOverlay && !isNearViewport) {
            setImageUrl('')
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        if (isOverlay || hasCurrentThumbnail) {
            try {
                setImageUrl(convertFileSrc(hasCurrentThumbnail ? item.thumbnailPath! : item.path))
            } catch (error) {
                console.error('Failed to create asset URL:', error)
                setImageUrl('')
                setIsLoading(false)
            }
            return
        }

        const thumbnailSource = getFirstLibraryLeaf(item)
        void ensureLibraryThumbnail(thumbnailSource.id, thumbnailSource.path)
            .then(thumbnailPath => {
                if (cancelled) return
                const updates = {
                    thumbnailPath,
                    thumbnailVersion: LIBRARY_THUMBNAIL_VERSION,
                }
                const store = useLibraryStore.getState()
                store.updateItem(thumbnailSource.id, updates)
                if (thumbnailSource.id !== item.id) store.updateItem(item.id, updates)
                setImageUrl(convertFileSrc(thumbnailPath))
            })
            .catch(error => {
                if (cancelled) return
                console.warn('Failed to create library thumbnail:', error)
                try {
                    setImageUrl(convertFileSrc(item.path))
                } catch {
                    setImageUrl('')
                    setIsLoading(false)
                }
            })

        return () => { cancelled = true }
    }, [hasCurrentThumbnail, isNearViewport, isOverlay, item.id, item.path, item.thumbnailPath])

    const handleImageLoad = () => {
        setIsLoading(false)
    }

    const handleImageError = () => {
        if (hasCurrentThumbnail) {
            useLibraryStore.getState().updateItem(item.id, {
                thumbnailPath: undefined,
                thumbnailVersion: undefined,
            })
            setIsLoading(true)
            setImageUrl(convertFileSrc(item.path))
            return
        }
        setIsLoading(false)
    }

    const handleClick = (e: React.MouseEvent) => {
        if (isEditMode && onSelectionClick) {
            e.preventDefault()
            e.stopPropagation()
            onSelectionClick(e)
        } else if (onImageClick) {
            onImageClick(convertFileSrc(item.path))
        }
    }

    const content = (
        <div
            ref={containerRef}
            className={cn(
                "relative group aspect-[2/3] rounded-xl overflow-hidden bg-muted/30 border border-border/50 shadow-sm transition-all hover:ring-2 hover:ring-primary/50",
                isOverlay && "pointer-events-none opacity-50 ring-2 ring-primary shadow-xl cursor-grabbing z-50",
                isEditMode && isSelected && "ring-2 ring-orange-500",
                isDropTarget && "ring-2 ring-purple-400 bg-purple-500/15",
                className
            )}
            onClick={handleClick}
        >
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse bg-muted">
                    <span className="sr-only">Loading...</span>
                </div>
            )}
            {imageUrl && (
                <img
                    src={imageUrl}
                    alt={item.name}
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    className={cn(
                        "w-full h-full object-cover transition-[opacity,transform] duration-200 group-hover:scale-105",
                        isLoading && "opacity-0"
                    )}
                    draggable={false}
                />
            )}

            {/* Edit Mode Checkbox - not shown for stacks */}
            {isEditMode && !item.isStack && (
                <div className="absolute top-2 left-2 z-30">
                    <div className={cn(
                        "h-6 w-6 rounded-md flex items-center justify-center transition-all",
                        isSelected ? "bg-orange-500 text-white" : "bg-black/50 text-white/70"
                    )}>
                        {isSelected ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </div>
                </div>
            )}

            {/* Stack Badge */}
            {item.isStack && (
                <div className="absolute top-2 right-2 z-30 px-2 py-1 bg-purple-500 text-white text-xs font-bold rounded-full flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {t('library.stackCount', '{{count}}개', { count: item.stackItems?.length || 0 })}
                </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs text-white truncate px-1">{item.name}</p>
            </div>
        </div>
    )

    if (isOverlay || isEditMode) return content

    return (
        <LibraryContextMenu
            item={item}
            onRename={onRename ? () => onRename(item) : undefined}
            onAddRef={onAddRef ? () => onAddRef(item) : undefined}
            onLoadMetadata={onLoadMetadata ? () => onLoadMetadata(item) : undefined}
        >
            {content}
        </LibraryContextMenu>
    )
})
