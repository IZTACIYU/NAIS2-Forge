import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { useState } from 'react'
import { Brush, Copy, FolderOpen, Save, Trash2, Wand2, Users, FileSearch, Paintbrush, Image as ImageIcon, Cloud, Eraser } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, remove, readFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { SceneImage } from '@/stores/scene-store'
import { SceneR2DirectUploadDialog, UploadCandidate } from '@/components/scene/SceneR2DirectUploadDialog'
import { useExifStore } from '@/stores/exif-store'
import { bytesToImageDataUrl } from '@/lib/exif-stripper'
import { processAndSaveExifImage } from '@/lib/exif-actions'

interface SceneContextMenuProps {
    image: SceneImage
    children: React.ReactNode
    onDelete: () => void
    onAddRef?: () => void
    onLoadMetadata?: () => void
    onInpaint?: (base64: string) => void
}

export function SceneImageContextMenu({ image, children, onDelete, onAddRef, onLoadMetadata, onInpaint }: SceneContextMenuProps) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { setActiveImage, setRequestedTool } = useToolsStore()
    const { setSourceImage, setI2IMode } = useGenerationStore()
    const [r2DirectUploadOpen, setR2DirectUploadOpen] = useState(false)
    const showExifDirectAction = useSettingsStore(s => s.expertExifDirectActionEnabled)
    const showExifQuickAction = useSettingsStore(s => s.expertExifManagerEnabled && s.expertExifQuickActionEnabled)

    // Determine file path. 
    // image.url is expected to be the full file path for saved images.
    // If it's data: URI, some features like Open Folder won't work well, but logic below handles standard paths.
    const isFile = !image.url.startsWith('data:')

    const handleCopy = async () => {
        try {
            let blob: Blob
            if (isFile) {
                const data = await readFile(image.url)
                blob = new Blob([data], { type: 'image/png' })
            } else {
                // Handle Base64 (Streaming/Preview)
                const res = await fetch(image.url)
                blob = await res.blob()
            }

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
            let data: Uint8Array
            if (isFile) {
                data = await readFile(image.url)
            } else {
                const res = await fetch(image.url)
                const buffer = await res.arrayBuffer()
                data = new Uint8Array(buffer)
            }

            const { imageFormat } = useSettingsStore.getState()
            const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
            const filePath = await save({
                defaultPath: `NAIS_${image.timestamp}.${fileExt}`,
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
            let base64 = ''
            if (isFile) {
                const data = await readFile(image.url)
                // Convert to base64
                let binary = ''
                const len = data.byteLength
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(data[i])
                }
                base64 = btoa(binary)
            } else {
                base64 = image.url.split(',')[1]
            }

            setActiveImage(`data:image/png;base64,${base64}`)
            navigate('/tools')
        } catch (e) {
            console.error('Failed to load for tools:', e)
            toast({ title: t('smartTools.error', '이미지 로드 실패'), variant: 'destructive' })
        }
    }

    const exifSourceName = `NAIS_${image.timestamp}.${image.url.toLowerCase().endsWith('.webp') ? 'webp' : 'png'}`
    const getExifSource = () => isFile
        ? readFile(image.url).then(data => bytesToImageDataUrl(data, image.url))
        : Promise.resolve(image.url)

    const handleExifManager = async () => {
        try {
            useExifStore.getState().setSource(await getExifSource(), exifSourceName)
            navigate('/exif')
        } catch (e) {
            toast({ title: t('exif.loadFailed'), variant: 'destructive' })
        }
    }

    const handleExifDirectAction = async () => {
        try {
            const filePath = await processAndSaveExifImage(await getExifSource(), exifSourceName)
            toast({ title: t('exif.autoSaved'), description: filePath, variant: 'success' })
        } catch (error) {
            toast({ title: t('exif.failed'), description: String(error), variant: 'destructive' })
        }
    }

    const handleOpenFolder = async () => {
        if (!isFile) return
        try {
            await revealItemInDir(image.url)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const r2UploadItems: UploadCandidate[] = [{
        sceneId: image.id,
        sceneName: `Image_${image.timestamp}`,
        image,
    }]

    // Helper to get base64 data
    const getImageBase64 = async (): Promise<string | null> => {
        try {
            if (isFile) {
                const data = await readFile(image.url)
                let binary = ''
                const len = data.byteLength
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(data[i])
                }
                return `data:image/png;base64,${btoa(binary)}`
            } else {
                return image.url
            }
        } catch (e) {
            console.error('Failed to get image data:', e)
            return null
        }
    }

    // Inpainting: Call parent callback with base64 data
    const handleInpaint = async () => {
        if (!onInpaint) return
        const base64 = await getImageBase64()
        if (!base64) return
        onInpaint(base64)
    }

    const handleI2I = async () => {
        const base64 = await getImageBase64()
        if (!base64) return
        
        setSourceImage(base64)
        setI2IMode('i2i')
        navigate('/')
    }

    const handleDrawOver = async () => {
        const base64 = await getImageBase64()
        if (!base64) return

        setActiveImage(base64)
        setRequestedTool('draw-over')
        navigate('/tools')
    }

    const handleDelete = async () => {
        if (isFile) {
            try {
                await remove(image.url)
            } catch (e) {
                console.error('File delete failed (might already be deleted):', e)
            }
            window.dispatchEvent(new CustomEvent('imageDeleted', { detail: { path: image.url } }))
        }
        // Always call parent onDelete to remove from UI store
        onDelete()
        toast({ title: t('actions.deleted', '삭제 완료'), variant: 'success' })
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                {children}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
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
                <ContextMenuSeparator />
                <ContextMenuItem onClick={handleInpaint} disabled={!onInpaint}>
                    <Paintbrush className="h-4 w-4 mr-2 text-pink-400" />
                    {t('tools.inpainting.title', '인페인팅')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleI2I}>
                    <ImageIcon className="h-4 w-4 mr-2 text-indigo-400" />
                    {t('tools.i2i.title', 'Image to Image')}
                </ContextMenuItem>
                <ContextMenuItem onClick={handleDrawOver}>
                    <Brush className="h-4 w-4 mr-2 text-lime-400" />
                    {t('smartTools.drawOver')}
                </ContextMenuItem>
                <ContextMenuSeparator />

                {onAddRef && (
                    <ContextMenuItem onClick={onAddRef}>
                        <Users className="h-4 w-4 mr-2 text-emerald-400" />
                        {t('actions.addAsRef', '이미지 참조')}
                    </ContextMenuItem>
                )}

                {onLoadMetadata && (
                    <ContextMenuItem onClick={onLoadMetadata}>
                        <FileSearch className="h-4 w-4 mr-2 text-yellow-400" />
                        {t('metadata.loadFromImage', '메타데이터 불러오기')}
                    </ContextMenuItem>
                )}

                {isFile && (
                    <ContextMenuItem onClick={handleOpenFolder}>
                        <FolderOpen className="h-4 w-4 mr-2 text-orange-400" />
                        {t('actions.openFolder', '탐색기에서 열기')}
                    </ContextMenuItem>
                )}

                {useSettingsStore.getState().expertR2DirectUploadEnabled && (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => setR2DirectUploadOpen(true)}>
                            <Cloud className="h-4 w-4 mr-2 text-sky-400" />
                            {t('scene.r2DirectUpload.title', 'R2 Direct Upload')}
                        </ContextMenuItem>
                    </>
                )}

                <ContextMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    <Trash2 className="h-4 w-4 mr-2 text-red-500" />
                    {t('actions.delete', '삭제')}
                </ContextMenuItem>
            </ContextMenuContent>
            <SceneR2DirectUploadDialog
                open={r2DirectUploadOpen}
                onOpenChange={setR2DirectUploadOpen}
                items={r2UploadItems}
            />
        </ContextMenu>
    )
}
