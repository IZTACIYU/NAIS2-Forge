import { useState } from 'react'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { flattenLibraryItems, flattenLibraryLeaves, LibraryItem, useLibraryStore } from '@/stores/library-store'
import { Trash2, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, remove, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { useExifStore } from '@/stores/exif-store'
import { bytesToImageDataUrl } from '@/lib/exif-stripper'
import { processAndSaveExifImage } from '@/lib/exif-actions'
import { useGenerationStore } from '@/stores/generation-store'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { ImageQuickActionItems } from '@/components/image/ImageQuickActionItems'

interface LibraryContextMenuProps {
    item: LibraryItem
    children: React.ReactNode
    onRename?: () => void
    onAddRef?: () => void
    onLoadMetadata?: () => void
}

export function LibraryContextMenu({ item, children, onRename, onAddRef, onLoadMetadata }: LibraryContextMenuProps) {
    const { t } = useTranslation()
    const { removeItem } = useLibraryStore()
    const navigate = useNavigate()
    const { setActiveImage, setRequestedTool } = useToolsStore()
    const { setSourceImage, setI2IMode } = useGenerationStore()
    const [inpaintImage, setInpaintImage] = useState<string | null>(null)
    const [inpaintOpen, setInpaintOpen] = useState(false)

    const getImageData = async () => bytesToImageDataUrl(await readFile(item.path), item.name)

    const handleCopy = async () => {
        try {
            const data = await readFile(item.path)
            const blob = new Blob([data], { type: 'image/png' })
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
            toast({ title: t('actions.copied', '복사 완료'), variant: 'success' })
        } catch (e) {
            console.error('Copy failed:', e)
            toast({ title: t('actions.copyFailed', '복사 실패'), variant: 'destructive' })
        }
    }

    const handleSaveAs = async () => {
        try {
            const data = await readFile(item.path)
            const filePath = await save({
                defaultPath: item.name,
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'webp'] }],
            })
            if (filePath) {
                await writeFile(filePath, data)
                toast({ title: t('toast.saved', '저장 완료'), variant: 'success' })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({ title: t('toast.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    const handleSmartTools = async () => {
        try {
            const data = await readFile(item.path)
            let binary = ''
            const len = data.byteLength
            for (let i = 0; i < len; i++) {
                binary += String.fromCharCode(data[i])
            }
            const base64 = btoa(binary)

            setActiveImage(`data:image/png;base64,${base64}`)
            navigate('/tools')
        } catch (e) {
            console.error('Failed to load for tools:', e)
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        }
    }

    const handleDrawOver = async () => {
        try {
            setActiveImage(await getImageData())
            setRequestedTool('draw-over')
            navigate('/tools')
        } catch (e) {
            console.error('Failed to load for draw over:', e)
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        }
    }

    const handleInpaint = async () => {
        try {
            setInpaintImage(await getImageData())
            setInpaintOpen(true)
        } catch (error) {
            toast({ title: t('smartTools.error'), variant: 'destructive' })
        }
    }

    const handleI2I = async () => {
        try {
            setSourceImage(await getImageData())
            setI2IMode('i2i')
            navigate('/')
        } catch (error) {
            toast({ title: t('smartTools.error'), variant: 'destructive' })
        }
    }

    const handleExifManager = async () => {
        try {
            const source = await bytesToImageDataUrl(await readFile(item.path), item.name)
            useExifStore.getState().setSource(source, item.name)
            navigate('/exif')
        } catch (e) {
            toast({ title: t('exif.loadFailed'), variant: 'destructive' })
        }
    }

    const handleExifDirectAction = async () => {
        try {
            const source = await bytesToImageDataUrl(await readFile(item.path), item.name)
            const filePath = await processAndSaveExifImage(source, item.name)
            toast({ title: t('exif.autoSaved'), description: filePath, variant: 'success' })
        } catch (error) {
            toast({ title: t('exif.failed'), description: String(error), variant: 'destructive' })
        }
    }

    const handleOpenFolder = async () => {
        try {
            await revealItemInDir(item.path)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleDelete = async () => {
        const sourceItems = flattenLibraryLeaves([item])
        const originalPaths = sourceItems.map(sourceItem => sourceItem.path)
        const thumbnailPaths = flattenLibraryItems([item])
            .map(sourceItem => sourceItem.thumbnailPath)
            .filter((path): path is string => Boolean(path))
        const pathsToDelete = [...new Set([...originalPaths, ...thumbnailPaths])]

        const results = await Promise.allSettled(pathsToDelete.map(path => remove(path)))
        const failed = results.filter(result => result.status === 'rejected')
        if (failed.length > 0) {
            console.error('Delete failed for some library files:', failed)
        }

        window.dispatchEvent(new CustomEvent('imageDeleted', {
            detail: { paths: originalPaths }
        }))
        removeItem(item.id)
        toast({ title: t('actions.deleted', '삭제 완료'), variant: 'success' })
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
                <ContextMenuItem onClick={onRename}>
                    <Pencil className="h-4 w-4 mr-2 text-violet-400" />
                    {t('actions.rename', '이름 변경')}
                </ContextMenuItem>
                <ImageQuickActionItems
                    onSaveAs={handleSaveAs}
                    onCopy={handleCopy}
                    onExifDirectAction={handleExifDirectAction}
                    onOpenExifManager={handleExifManager}
                    onOpenSmartTools={handleSmartTools}
                    onInpaint={handleInpaint}
                    onI2I={handleI2I}
                    onDrawOver={handleDrawOver}
                    onAddReference={onAddRef}
                    onLoadMetadata={onLoadMetadata}
                    onOpenFolder={handleOpenFolder}
                />
                <ContextMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
            <InpaintingDialog
                open={inpaintOpen}
                onOpenChange={(open) => {
                    setInpaintOpen(open)
                    if (!open) setInpaintImage(null)
                }}
                sourceImage={inpaintImage}
            />
        </ContextMenu>
    )
}
