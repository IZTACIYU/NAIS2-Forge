import { Brush, Cloud, Copy, Eraser, FileSearch, FolderOpen, Image as ImageIcon, Paintbrush, RotateCcw, Save, Users, Wand2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'
import { useSettingsStore } from '@/stores/settings-store'

interface ImageQuickActionItemsProps {
    onSaveAs?: () => void
    onCopy?: () => void
    onRegenerate?: () => void
    regenerateDisabled?: boolean
    onExifDirectAction?: () => void
    onOpenExifManager?: () => void
    onOpenSmartTools?: () => void
    onInpaint?: () => void
    onI2I?: () => void
    onDrawOver?: () => void
    onAddReference?: () => void
    onLoadMetadata?: () => void
    onOpenFolder?: () => void
    folderDisabled?: boolean
    onR2DirectUpload?: () => void
}

export function ImageQuickActionItems({
    onSaveAs,
    onCopy,
    onRegenerate,
    regenerateDisabled = false,
    onExifDirectAction,
    onOpenExifManager,
    onOpenSmartTools,
    onInpaint,
    onI2I,
    onDrawOver,
    onAddReference,
    onLoadMetadata,
    onOpenFolder,
    folderDisabled = false,
    onR2DirectUpload,
}: ImageQuickActionItemsProps) {
    const { t } = useTranslation()
    const showExifDirectAction = useSettingsStore(s => s.expertExifDirectActionEnabled && Boolean(onExifDirectAction))
    const showExifQuickAction = useSettingsStore(s => s.expertExifManagerEnabled && s.expertExifQuickActionEnabled && Boolean(onOpenExifManager))
    const showR2DirectUpload = useSettingsStore(s => s.expertR2DirectUploadEnabled && Boolean(onR2DirectUpload))
    const hasFileActions = Boolean(onSaveAs || onCopy || onRegenerate)
    const hasExifActions = showExifDirectAction || showExifQuickAction
    const hasPrimaryActions = Boolean(onOpenSmartTools)
    const hasEditorActions = Boolean(onInpaint || onI2I || onDrawOver)
    const hasToolActions = hasPrimaryActions || hasEditorActions
    const hasReferenceActions = Boolean(onAddReference || onLoadMetadata || onOpenFolder)

    return (
        <>
            {onSaveAs && <ContextMenuItem onClick={onSaveAs}><Save className="mr-2 h-4 w-4 text-cyan-400" />{t('actions.saveAs')}</ContextMenuItem>}
            {onCopy && <ContextMenuItem onClick={onCopy}><Copy className="mr-2 h-4 w-4 text-blue-400" />{t('actions.copy')}</ContextMenuItem>}
            {onRegenerate && <ContextMenuItem onClick={onRegenerate} disabled={regenerateDisabled}><RotateCcw className="mr-2 h-4 w-4 text-amber-400" />{t('actions.regenerate')}</ContextMenuItem>}

            {showExifDirectAction && <ContextMenuItem onClick={onExifDirectAction}><Eraser className="mr-2 h-4 w-4 text-rose-400" />{t('exif.directAction')}</ContextMenuItem>}
            {showExifQuickAction && <ContextMenuItem onClick={onOpenExifManager}><Eraser className="mr-2 h-4 w-4 text-rose-400" />{t('exif.quickAction')}</ContextMenuItem>}

            {onOpenSmartTools && <ContextMenuItem onClick={onOpenSmartTools}><Wand2 className="mr-2 h-4 w-4 text-purple-400" />{t('smartTools.title')}</ContextMenuItem>}
            {(hasFileActions || hasExifActions || hasPrimaryActions) && hasEditorActions && <ContextMenuSeparator />}
            {onI2I && <ContextMenuItem onClick={onI2I}><ImageIcon className="mr-2 h-4 w-4 text-indigo-400" />{t('tools.i2i.title')}</ContextMenuItem>}
            {onInpaint && <ContextMenuItem onClick={onInpaint}><Paintbrush className="mr-2 h-4 w-4 text-pink-400" />{t('tools.inpainting.title')}</ContextMenuItem>}
            {onDrawOver && <ContextMenuItem onClick={onDrawOver}><Brush className="mr-2 h-4 w-4 text-lime-400" />{t('smartTools.drawOver')}</ContextMenuItem>}

            {hasToolActions && hasReferenceActions && <ContextMenuSeparator />}
            {onAddReference && <ContextMenuItem onClick={onAddReference}><Users className="mr-2 h-4 w-4 text-emerald-400" />{t('actions.addAsRef')}</ContextMenuItem>}
            {onLoadMetadata && <ContextMenuItem onClick={onLoadMetadata}><FileSearch className="mr-2 h-4 w-4 text-yellow-400" />{t('metadata.loadFromImage')}</ContextMenuItem>}
            {onOpenFolder && <ContextMenuItem onClick={onOpenFolder} disabled={folderDisabled}><FolderOpen className="mr-2 h-4 w-4 text-orange-400" />{t('actions.openFolder')}</ContextMenuItem>}

            {(hasFileActions || hasExifActions || hasToolActions || hasReferenceActions) && showR2DirectUpload && <ContextMenuSeparator />}
            {showR2DirectUpload && <ContextMenuItem onClick={onR2DirectUpload}><Cloud className="mr-2 h-4 w-4 text-sky-400" />{t('scene.r2DirectUpload.title')}</ContextMenuItem>}
        </>
    )
}
