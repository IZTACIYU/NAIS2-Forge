import { Palette } from 'lucide-react'
import {
    ContextMenuItem,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { FOLDER_COLORS } from '@/stores/character-prompt-store'
import { cn } from '@/lib/utils'

interface FolderColorContextMenuProps {
    label: string
    selectedIndex?: number
    onSelect: (index: number) => void
}

export function FolderColorContextMenu({ label, selectedIndex = 0, onSelect }: FolderColorContextMenuProps) {
    return (
        <ContextMenuSub>
            <ContextMenuSubTrigger>
                <Palette className="mr-2 h-4 w-4" />
                {label}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-auto min-w-0 p-2">
                <div className="flex items-center gap-1.5">
                    {FOLDER_COLORS.map((color, index) => (
                        <ContextMenuItem
                            key={color.name}
                            aria-label={color.name}
                            title={color.name}
                            className={cn(
                                'h-6 w-6 min-w-0 cursor-pointer rounded-full border-2 p-0 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-popover',
                                selectedIndex === index ? 'border-foreground' : 'border-transparent'
                            )}
                            style={{ backgroundColor: color.swatch }}
                            onSelect={() => onSelect(index)}
                        />
                    ))}
                </div>
            </ContextMenuSubContent>
        </ContextMenuSub>
    )
}
