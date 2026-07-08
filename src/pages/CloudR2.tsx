import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, Folder, FolderPlus, Image as ImageIcon, Loader2, RefreshCw, Trash2, Upload, ChevronRight, Home, File } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import { createR2Folder, deleteR2Object, deleteR2Prefix, hasR2Config, listR2Objects, R2ObjectInfo, uploadR2Object } from '@/services/r2-api'

const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']

const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
})

const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const buildPublicUrl = (baseUrl: string, key: string) => {
    const base = baseUrl.trim().replace(/\/$/, '')
    if (!base) return ''
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    if (base.includes('{key}')) return base.replace(/\{key\}/g, encodedKey)
    if (base.includes('{rawKey}')) return base.replace(/\{rawKey\}/g, key)
    if (base.endsWith('/N') && key.startsWith('IMG/private/')) {
        return `${base}/${key.slice('IMG/private/'.length).split('/').map(encodeURIComponent).join('/')}`
    }
    return `${base}/${encodedKey}`
}

export default function CloudR2() {
    const { t } = useTranslation()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const {
        expertCloudR2Enabled,
        r2AccountId,
        r2AccessKeyId,
        r2SecretAccessKey,
        r2Bucket,
        r2PublicBaseUrl,
    } = useSettingsStore()
    const config = useMemo(() => ({
        accountId: r2AccountId,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
        bucket: r2Bucket,
    }), [r2AccountId, r2AccessKeyId, r2SecretAccessKey, r2Bucket])

    const [prefix, setPrefix] = useState('')
    const [folders, setFolders] = useState<R2ObjectInfo[]>([])
    const [files, setFiles] = useState<R2ObjectInfo[]>([])
    const [selected, setSelected] = useState<R2ObjectInfo | null>(null)
    const [newFolderName, setNewFolderName] = useState('')
    const [loading, setLoading] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<R2ObjectInfo | null>(null)

    const ready = expertCloudR2Enabled && hasR2Config(config)
    const breadcrumbs = prefix ? prefix.split('/').filter(Boolean) : []

    const refresh = async (nextPrefix = prefix) => {
        if (!ready) return
        setLoading(true)
        try {
            const result = await listR2Objects(config, nextPrefix)
            setFolders(result.folders)
            setFiles(result.files)
            setPrefix(nextPrefix)
            setSelected(null)
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (ready) refresh('')
    }, [ready])

    const openFolder = (key: string) => refresh(key)
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
            toast({ title: t('settingsPage.saved'), variant: 'success' })
            refresh()
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setLoading(false)
        }
    }

    const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const uploadFiles = Array.from(event.target.files || [])
        if (!uploadFiles.length || !ready) {
            event.target.value = ''
            return
        }
        setLoading(true)
        try {
            for (const file of uploadFiles) {
                const base64 = await fileToBase64(file)
                const safeName = file.name.replace(/^\/+/, '')
                await uploadR2Object(config, `${prefix}${safeName}`, base64, file.type || 'application/octet-stream')
            }
            toast({ title: t('cloudR2.uploaded'), variant: 'success' })
            refresh()
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        } finally {
            setLoading(false)
            event.target.value = ''
        }
    }

    const handleDelete = async (item: R2ObjectInfo) => {
        if (!ready) return
        try {
            if (item.is_folder) {
                await deleteR2Prefix(config, item.key)
            } else {
                await deleteR2Object(config, item.key)
            }
            if (selected?.key === item.key) setSelected(null)
            toast({ title: t('actions.deleted'), variant: 'success' })
            refresh()
        } catch (error) {
            toast({ title: t('cloudR2.error'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
        }
    }

    const publicUrl = selected && !selected.is_folder && r2PublicBaseUrl
        ? buildPublicUrl(r2PublicBaseUrl, selected.key)
        : ''
    const isImage = selected && imageExtensions.some(ext => selected.name.toLowerCase().endsWith(ext))

    if (!expertCloudR2Enabled) {
        return <div className="h-full flex items-center justify-center text-muted-foreground">{t('cloudR2.disabled')}</div>
    }

    if (!hasR2Config(config)) {
        return <div className="h-full flex items-center justify-center text-muted-foreground">{t('cloudR2.missingConfig')}</div>
    }

    return (
        <div className="h-full flex flex-col min-h-0">
            <div className="shrink-0 flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cloud className="h-4 w-4 text-primary" />
                        {t('cloudR2.title')}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 min-w-0">
                        <button className="hover:text-foreground" onClick={() => goToCrumb(-1)}><Home className="h-3.5 w-3.5" /></button>
                        {breadcrumbs.map((crumb, index) => (
                            <span key={`${crumb}-${index}`} className="flex items-center gap-1 min-w-0">
                                <ChevronRight className="h-3 w-3" />
                                <button className="truncate hover:text-foreground" onClick={() => goToCrumb(index)}>{crumb}</button>
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                        <Upload className="h-4 w-4 mr-2" />{t('cloudR2.upload')}
                    </Button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
                </div>
            </div>

            <div className="grid grid-cols-[260px_minmax(0,1fr)_320px] flex-1 min-h-0">
                <aside className="border-r border-border/40 p-3 space-y-3 overflow-y-auto">
                    <div className="flex gap-2">
                        <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder={t('cloudR2.newFolder')} className="h-8" />
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                            <FolderPlus className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="space-y-1">
                        {folders.map(folder => (
                            <ContextMenu key={folder.key}>
                                <ContextMenuTrigger asChild>
                                    <button onClick={() => openFolder(folder.key)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted text-left">
                                        <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                                        <span className="truncate">{folder.name}</span>
                                    </button>
                                </ContextMenuTrigger>
                                <ContextMenuContent className="w-36">
                                    <ContextMenuItem onClick={() => openFolder(folder.key)}>
                                        <Folder className="mr-2 h-4 w-4" />{t('actions.openFolder')}
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(folder)}>
                                        <Trash2 className="mr-2 h-4 w-4" />{t('common.delete')}
                                    </ContextMenuItem>
                                </ContextMenuContent>
                            </ContextMenu>
                        ))}
                    </div>
                </aside>

                <main className="min-w-0 overflow-y-auto p-4">
                    {loading && !files.length && !folders.length ? (
                        <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />{t('common.loading', 'Loading')}</div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                            {files.map(file => {
                                const image = imageExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
                                return (
                                    <ContextMenu key={file.key}>
                                        <ContextMenuTrigger asChild>
                                            <button onClick={() => setSelected(file)} className={cn('min-w-0 rounded-lg border border-border/50 bg-card/40 p-3 text-left hover:bg-muted/50 transition-colors', selected?.key === file.key && 'ring-1 ring-primary')}>
                                                <div className="aspect-square rounded-md bg-muted/40 flex items-center justify-center mb-2 overflow-hidden">
                                                    {image && r2PublicBaseUrl ? <img src={buildPublicUrl(r2PublicBaseUrl, file.key)} className="w-full h-full object-cover" /> : image ? <ImageIcon className="h-8 w-8 text-primary" /> : <File className="h-8 w-8 text-muted-foreground" />}
                                                </div>
                                                <div className="text-sm font-medium truncate">{file.name}</div>
                                                <div className="text-xs text-muted-foreground">{formatSize(file.size)}</div>
                                            </button>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent className="w-36">
                                            <ContextMenuItem onClick={() => setSelected(file)}>
                                                <File className="mr-2 h-4 w-4" />{t('cloudR2.selectFile')}
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteTarget(file)}>
                                                <Trash2 className="mr-2 h-4 w-4" />{t('common.delete')}
                                            </ContextMenuItem>
                                        </ContextMenuContent>
                                    </ContextMenu>
                                )
                            })}
                        </div>
                    )}
                </main>

                <aside className="border-l border-border/40 p-4 overflow-y-auto">
                    {selected ? (
                        <div className="space-y-4">
                            <div>
                                <div className="text-sm font-semibold break-all">{selected.name}</div>
                                <div className="text-xs text-muted-foreground break-all mt-1">{selected.key}</div>
                            </div>
                            {isImage && publicUrl && <img src={publicUrl} className="w-full rounded-lg border border-border/50 object-contain" />}
                            <div className="text-xs text-muted-foreground space-y-1">
                                <div>{formatSize(selected.size)}</div>
                                {selected.last_modified && <div>{new Date(selected.last_modified).toLocaleString()}</div>}
                            </div>
                            <Button variant="destructive" className="w-full" onClick={() => setDeleteTarget(selected)}>
                                <Trash2 className="h-4 w-4 mr-2" />{t('common.delete')}
                            </Button>
                        </div>
                    ) : (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground text-center">{t('cloudR2.selectFile')}</div>
                    )}
                </aside>
            </div>
            <ConfirmDialog
                open={!!deleteTarget}
                onOpenChange={(open) => !open && setDeleteTarget(null)}
                title={t('common.delete')}
                description={deleteTarget ? t('cloudR2.confirmDelete', { name: deleteTarget.name }) : ''}
                confirmText={t('common.delete')}
                cancelText={t('common.cancel')}
                variant="destructive"
                onConfirm={async () => {
                    if (deleteTarget) await handleDelete(deleteTarget)
                    setDeleteTarget(null)
                }}
            />
        </div>
    )
}
