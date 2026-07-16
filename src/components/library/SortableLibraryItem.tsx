import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { LibraryItem as LibraryItemType } from '@/stores/library-store'
import { LibraryItem } from './LibraryItem'

interface SortableLibraryItemProps {
    item: LibraryItemType
    onRename: (item: LibraryItemType) => void
    onAddRef: (item: LibraryItemType) => void
    onLoadMetadata: (item: LibraryItemType) => void
    onImageClick?: (item: LibraryItemType, imageUrl: string) => void
    isEditMode?: boolean
    isSelected?: boolean
    onSelectionClick?: (item: LibraryItemType, e: React.MouseEvent) => void
    isStackDropTarget?: boolean
    disabled?: boolean
}

export const SortableLibraryItem = memo(function SortableLibraryItem({ item, onRename, onAddRef, onLoadMetadata, onImageClick, isEditMode, isSelected, onSelectionClick, isStackDropTarget, disabled }: SortableLibraryItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id, disabled })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity: isDragging ? 0.2 : 1,
    }

    return (
        <div ref={setNodeRef} style={style} {...(disabled ? {} : { ...attributes, ...listeners })} id={item.id} className="w-full h-full">
            <LibraryItem 
                item={item} 
                onRename={onRename} 
                onAddRef={onAddRef} 
                onLoadMetadata={onLoadMetadata} 
                onImageClick={onImageClick ? imageUrl => onImageClick(item, imageUrl) : undefined}
                isEditMode={isEditMode}
                isSelected={isSelected}
                onSelectionClick={onSelectionClick ? event => onSelectionClick(item, event) : undefined}
                isDropTarget={item.isStack && isStackDropTarget}
            />
        </div>
    )
})
