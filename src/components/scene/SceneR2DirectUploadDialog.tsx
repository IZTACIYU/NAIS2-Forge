import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { readFile } from '@tauri-apps/plugin-fs'
import { ChevronRight, Cloud, Folder, FolderPlus, Home, Loader2, RefreshCw, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImageOutputOptions, type ImageOutputFormat } from '@/components/ui/image-output-options'
import { toast } from '@/components/ui/use-toast'
import { createR2Folder, hasR2Config, listR2Objects, R2Config, R2ObjectInfo, uploadR2Object } from '@/services/r2-api'
import { useSettingsStore } from '@/stores/settings-store'
import { SceneCard, SceneImage } from '@/stores/scene-store'
import { bytesToImageDataUrl } from '@/lib/exif-stripper'
import { exifFormatExtension, prepareImageForR2Upload } from '@/lib/exif-actions'
import { applySceneOutputNameOverrides, getUniqueSceneOutputFileName } from '@/lib/scene-export-name'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'

interface SceneR2DirectUploadDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    scenes?: SceneCard[]
    items?: UploadCandidate[]
}

export interface UploadCandidate {
    sceneId: string
    sceneName: string
    image: SceneImage
}

const LIST_CACHE_TTL_MS = 60_000
const listCache = new Map<string, { time: number; folders: R2ObjectInfo[] }>()

export function SceneR2DirectUploadDialog({ open, onOpenChange, scenes = [], items }: SceneR2DirectUploadDialogProps) {
    const { t } = useTranslation()
    const {
        r2AccountId,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Bucket,
        expertR2ExifRemovalEnabled,
        expertSceneExportNameEnabled,
        sceneExportNamePart,
    } = useSettingsStore()
    const exportImageFormat = useSettingsStore(state => state.exportImageFormat)
    const exportWebpQuality = useSettingsStore(state => state.exportWebpQuality)
    const config: R2Config = useMemo(() => ({
        accountId: r2AccountId,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
        bucket: r2Bucket,
    }), [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket])

    const [prefix, setPrefix] = useState('')
    const [folders, setFolders] = useState<R2ObjectInfo[]>([])
    const [newFolderName, setNewFolderName] = useState('')
    const [loading, setLoading] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState(0)
    const [customNames, setCustomNames] = useState<Record<string, string>>({})
    const [format, setFormat] = useState<ImageOutputFormat>(exportImageFormat)
    const [quality, setQuality] = useState(exportWebpQuality)

    useEffect(() => {
        if (open) {
            setFormat(exportImageFormat)
            setQuality(exportWebpQuality)
        }
    }, [open, exportImageFormat, exportWebpQuality])

    const ready = hasR2Config(config)
    const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : []
    const candidates = useMemo<UploadCandidate[]>(() => items || scenes
        .map(scene => {
            if ('image' in scene) return scene
            const image = pickSceneRepresentativeImage(scene.images)
            return image ? { sceneId: scene.id, sceneName: scene.name, image } : null
        })
        .filter((item): item is UploadCandidate => Boolean(item)), [items, scenes])
    const candidateFileNames = useMemo(() => {
        const usedFileNames = new Set<string>()
        return candidates.map(candidate => getUniqueSceneOutputFileName({
            sceneName: candidate.sceneName,
            enabled: expertSceneExportNameEnabled,
            part: sceneExportNamePart,
            extension: exifFormatExtension(format),
            usedFileNames,
            fallback: 'Scene',
        }))
    }, [candidates, expertSceneExportNameEnabled, format, sceneExportNamePart])
    const uploadFileNames = useMemo(() => applySceneOutputNameOverrides(candidateFileNames,
        candidates.map(candidate => customNames[`${candidate.sceneId}:${candidate.image.id}`])),
    [candidates, candidateFileNames, customNames])
    const hasEmptyName = candidates.some((candidate, index) => !(customNames[`${candidate.sceneId}:${candidate.image.id}`]
        ?? candidateFileNames[index].replace(/\.[^.]+$/, '')).trim())

    const resetRuntime = () => {
        setProgress(0)
        setUploading(false)
        setCustomNames({})
    }

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) resetRuntime()
        onOpenChange(nextOpen)
    }

    const refresh = async (nextPrefix = prefix, force = false) => {
        if (!ready) return
        const cacheKey = `${r2AccountId}:${r2Bucket}:${nextPrefix}`
        const cached = listCache.get(cacheKey)
        if (!force && cached && Date.now() - cached.time < LIST_CACHE_TTL_MS) {
            setFolders(cached.folders)
            setPrefix(nextPrefix)
            return
        }
        setLoading(true)
        try {
            const result = await listR2Objects(config, nextPrefix)
            listCache.set(cacheKey, { time: Date.now(), folders: result.folders })
            setFolders(result.folders)
            setPrefix(nextPrefix)
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (open && ready) refresh('')
    }, [open, ready])

    const goToCrumb = (index: number) => {
        const next = index < 0 ? '' : `${breadcrumbs.slice(0, index + 1).join('/')}/`
        refresh(next)
    }

    const handleCreateFolder = async () => {
        const name = newFolderName.trim().replace(/^\/+|\/+$/g, '')
        if (!name || !ready) return
        setLoading(true)
        try {
            await createR2Folder(config, `${prefix}${name}/`)
            setNewFolderName('')
            listCache.clear()
            await refresh(prefix, true)
            toast({ title: t('settingsPage.saved'), variant: 'success' })
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    const readImageDataUrl = async (image: SceneImage) => {
        if (image.url.startsWith('data:')) return image.url
        return bytesToImageDataUrl(await readFile(image.url), image.url)
    }

    const handleUpload = async () => {
        if (!ready || candidates.length === 0 || hasEmptyName) return
        setUploading(true)
        setProgress(0)
        try {
            const current = await listR2Objects(config, prefix)
            const existingKeys = new Set(current.files.map(file => file.key))
            const conflict = uploadFileNames.find(fileName => existingKeys.has(`${prefix}${fileName}`))
            if (conflict) throw new Error(t('scene.r2DirectUpload.nameConflict', { name: conflict }))
            for (let index = 0; index < candidates.length; index++) {
                const candidate = candidates[index]
                const processed = await prepareImageForR2Upload(
                    await readImageDataUrl(candidate.image), format, quality, expertR2ExifRemovalEnabled,
                )
                if (!uploadFileNames[index].endsWith(`.${processed.extension}`)) throw new Error(t('cloudR2.error'))
                const key = `${prefix}${uploadFileNames[index]}`
                await uploadR2Object(config, key, processed.contentBase64, processed.contentType)
                setProgress(Math.round(((index + 1) / candidates.length) * 100))
            }
            listCache.clear()
            await refresh(prefix, true)
            toast({ title: t('cloudR2.uploaded'), variant: 'success' })
            handleOpenChange(false)
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setUploading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-5xl h-[82vh] flex flex-col overflow-hidden backdrop-blur-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Cloud className="h-5 w-5 text-primary" />
                        {t('scene.r2DirectUpload.title', 'R2 Direct Upload')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('scene.r2DirectUpload.description', 'Upload one selected scene image per scene to the current R2 folder.')}
                    </DialogDescription>
                    <ImageOutputOptions format={format} quality={quality} onFormatChange={setFormat} onQualityChange={setQuality} disabled={uploading} />
                </DialogHeader>

                {!ready ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        {t('cloudR2.missingConfig')}
                    </div>
                ) : (
                    <div className="grid grid-cols-[280px_minmax(0,1fr)] flex-1 min-h-0 gap-4">
                        <aside className="border border-border/50 rounded-xl p-3 space-y-3 overflow-y-auto bg-card/40">
                            <div className="flex gap-2">
                                <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t('cloudR2.newFolder')} className="h-8" disabled={loading || uploading} />
                                <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleCreateFolder} disabled={!newFolderName.trim() || loading || uploading}>
                                    <FolderPlus className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="space-y-1">
                                {folders.map(folder => (
                                    <button key={folder.key} onClick={() => refresh(folder.key)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted text-left" disabled={loading || uploading}>
                                        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                                        <span className="truncate">{folder.name}</span>
                                    </button>
                                ))}
                                {!loading && folders.length === 0 && (
                                    <div className="px-2 py-8 text-xs text-muted-foreground text-center">
                                        {t('cloudR2.noFolders', 'No folders')}
                                    </div>
                                )}
                            </div>
                        </aside>

                        <section className="min-w-0 border border-border/50 rounded-xl bg-card/30 flex flex-col overflow-hidden">
                            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                                        <button className="hover:text-foreground" onClick={() => goToCrumb(-1)} disabled={uploading}><Home className="h-3.5 w-3.5" /></button>
                                        {breadcrumbs.map((crumb, index) => (
                                            <span key={`${crumb}-${index}`} className="flex items-center gap-1 min-w-0">
                                                <ChevronRight className="h-3 w-3" />
                                                <button className="truncate hover:text-foreground" onClick={() => goToCrumb(index)} disabled={uploading}>{crumb}</button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => refresh(prefix, true)} disabled={loading || uploading}>
                                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
                                {candidates.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                                        {t('scene.noImagesToExport', 'No images to upload')}
                                    </div>
                                ) : candidates.map((candidate, index) => {
                                    return (
                                        <div key={`${candidate.sceneId}:${candidate.image.id}`} className="flex min-w-0 items-center gap-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2 text-sm">
                                            <Input
                                                value={customNames[`${candidate.sceneId}:${candidate.image.id}`] ?? candidateFileNames[index].replace(/\.[^.]+$/, '')}
                                                onChange={event => setCustomNames(names => ({ ...names, [`${candidate.sceneId}:${candidate.image.id}`]: event.target.value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') }))}
                                                aria-label={t('scene.r2DirectUpload.fileName')}
                                                className="h-8 min-w-0 flex-1"
                                                disabled={uploading}
                                            />
                                            <span className="shrink-0 text-xs text-muted-foreground">.{candidateFileNames[index].split('.').pop()}</span>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="shrink-0 flex items-center justify-between gap-3 border-t border-border/40 px-4 py-3">
                                <div className="text-xs text-muted-foreground">
                                    {uploading ? `${progress}%` : t('scene.r2DirectUpload.count', '{{count}} images', { count: candidates.length })}
                                </div>
                                <Button onClick={handleUpload} disabled={uploading || loading || candidates.length === 0 || hasEmptyName}>
                                    {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                                    {t('scene.r2DirectUpload.upload', 'Upload Selected')}
                                </Button>
                            </div>
                        </section>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
