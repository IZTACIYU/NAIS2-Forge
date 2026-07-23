import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { flattenLibraryItems, flattenLibraryLeaves, LibraryItem, useLibraryStore } from '@/stores/library-store'
import { Brush, Copy, FolderOpen, Save, Trash2, Wand2, Users, Pencil, FileSearch, Eraser } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, remove, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useExifStore } from '@/stores/exif-store'
import { bytesToImageDataUrl } from '@/lib/exif-stripper'
import { processAndSaveExifImage } from '@/lib/exif-actions'

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
    const showExifDirectAction = useSettingsStore(s => s.expertExifDirectActionEnabled)
    const showExifQuickAction = useSettingsStore(s => s.expertExifManagerEnabled && s.expertExifQuickActionEnabled)

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
            const data = await readFile(item.path)
            let binary = ''
            for (const byte of data) binary += String.fromCharCode(byte)
            setActiveImage(`data:image/png;base64,${btoa(binary)}`)
            setRequestedTool('draw-over')
            navigate('/tools')
        } catch (e) {
            console.error('Failed to load for draw over:', e)
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
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
                <ContextMenuItem onClick={handleSaveAs}>
                    <Save className="h-4 w-4 mr-2 text-cyan-400" />
                    {t('actions.saveAs', '다른 이름으로 저장')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-2 text-blue-400" />
                    {t('actions.copy', '복사')}
                </ContextMenuItem>
                {showExifDirectAction && (
                    <ContextMenuItem onClick={handleExifDirectAction}>
                        <Eraser className="h-4 w-4 mr-2 text-rose-400" />
                        {t('exif.directAction')}
                    </ContextMenuItem>
                )}
                {showExifQuickAction && (
                    <ContextMenuItem onClick={handleExifManager}>
                        <Eraser className="h-4 w-4 mr-2 text-rose-400" />
                        {t('exif.quickAction')}
                    </ContextMenuItem>
                )}
                <ContextMenuItem onClick={handleSmartTools}>
                    <Wand2 className="h-4 w-4 mr-2 text-purple-400" />
                    {t('smartTools.title', '스마트 툴')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleDrawOver}>
                    <Brush className="h-4 w-4 mr-2 text-lime-400" />
                    {t('smartTools.drawOver')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onAddRef}>
                    <Users className="h-4 w-4 mr-2 text-emerald-400" />
                    {t('actions.addAsRef', '이미지 참조')}
                </ContextMenuItem>
                <ContextMenuItem onClick={onLoadMetadata}>
                    <FileSearch className="h-4 w-4 mr-2 text-yellow-400" />
                    {t('metadata.loadFromImage', '메타데이터 불러오기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleOpenFolder}>
                    <FolderOpen className="h-4 w-4 mr-2 text-orange-400" />
                    {t('actions.openFolder', '폴더 열기')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    )
}
