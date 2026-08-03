import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardCopy, Download, Eraser, ImagePlus, Save, Trash2 } from 'lucide-react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/use-toast'
import { useExifStore } from '@/stores/exif-store'
import { useSettingsStore } from '@/stores/settings-store'
import { bytesToImageDataUrl, stripImageMetadata, StrippedImage } from '@/lib/exif-stripper'
import { getExifOutputName, saveStrippedExifImage, writeExifBlob } from '@/lib/exif-actions'
import { readPngTextMetadata, writePngTextMetadata, type PngTextMetadata } from '@/lib/png-metadata-editor'
import { ExifMetadataEditor } from '@/components/exif/ExifMetadataEditor'

export default function ExifManager() {
    const { t } = useTranslation()
    const activeImage = useExifStore(state => state.activeImage)
    const sourceName = useExifStore(state => state.sourceName)
    const setSource = useExifStore(state => state.setSource)
    const clearSource = useExifStore(state => state.clearSource)
    const enabled = useSettingsStore(state => state.expertExifManagerEnabled)
    const autoSaveEnabled = useSettingsStore(state => state.expertExifAutoSaveEnabled)
    const outputFormat = useSettingsStore(state => state.exifOutputFormat)
    const [result, setResult] = useState<StrippedImage | null>(null)
    const [resultUrl, setResultUrl] = useState<string | null>(null)
    const [processing, setProcessing] = useState(false)
    const [dragging, setDragging] = useState(false)
    const [activeTab, setActiveTab] = useState<'remove' | 'edit'>('remove')
    const [editImage, setEditImage] = useState<string | null>(null)
    const [editSourceName, setEditSourceName] = useState('')
    const [editSourcePath, setEditSourcePath] = useState<string | null>(null)
    const [editMetadata, setEditMetadata] = useState<PngTextMetadata | null>(null)
    const [editProcessing, setEditProcessing] = useState(false)
    const [rawJsonValid, setRawJsonValid] = useState(true)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setResult(null)
        setResultUrl(previous => {
            if (previous) URL.revokeObjectURL(previous)
            return null
        })
    }, [activeImage])

    useEffect(() => () => {
        if (resultUrl) URL.revokeObjectURL(resultUrl)
    }, [resultUrl])

    const loadEditImage = (image: string, name: string, path: string | null = null) => {
        try {
            const metadata = readPngTextMetadata(image)
            setEditImage(image)
            setEditSourceName(name)
            setEditSourcePath(path)
            setEditMetadata(metadata)
            setRawJsonValid(true)
        } catch (error) {
            clearEditImage()
            setEditMetadata(null)
            toast({ title: t('exif.editor.loadFailed'), description: String(error), variant: 'destructive' })
        }
    }

    const chooseEditImage = async () => {
        const path = await open({ multiple: false, filters: [{ name: 'PNG', extensions: ['png'] }] })
        if (!path || Array.isArray(path)) return
        try {
            const image = await bytesToImageDataUrl(await readFile(path), path)
            loadEditImage(image, path.split(/[\\/]/).pop() || 'image.png', path)
        } catch (error) {
            toast({ title: t('exif.editor.loadFailed'), description: String(error), variant: 'destructive' })
        }
    }

    const loadFile = (file?: File, targetTab = activeTab) => {
        if (!file || !file.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = () => {
            const image = String(reader.result)
            if (targetTab === 'edit') loadEditImage(image, file.name, typeof (file as File & { path?: unknown }).path === 'string' ? (file as File & { path: string }).path : null)
            else setSource(image, file.name)
        }
        reader.readAsDataURL(file)
    }

    const autoSave = async (processed: StrippedImage) => {
        const filePath = await saveStrippedExifImage(processed, sourceName)
        toast({ title: t('exif.autoSaved'), description: filePath, variant: 'success' })
    }

    const processImage = async () => {
        if (!activeImage || processing) return
        setProcessing(true)
        try {
            const processed = await stripImageMetadata(activeImage, outputFormat)
            const nextUrl = URL.createObjectURL(processed.blob)
            setResultUrl(previous => {
                if (previous) URL.revokeObjectURL(previous)
                return nextUrl
            })
            setResult(processed)
            if (autoSaveEnabled) await autoSave(processed)
            else toast({ title: t('exif.complete'), variant: 'success' })
        } catch (error) {
            toast({ title: t('exif.failed'), description: String(error), variant: 'destructive' })
        } finally {
            setProcessing(false)
        }
    }

    const saveResult = async () => {
        if (!result) return
        const filePath = await save({
            defaultPath: getExifOutputName(sourceName, result.extension),
            filters: [{ name: 'Image', extensions: [result.extension] }],
        })
        if (!filePath) return
        await writeExifBlob(result, filePath)
        toast({ title: t('toast.saved'), variant: 'success' })
    }

    const getEditedBytes = () => {
        if (!editImage || !editMetadata) throw new Error('No PNG image is selected')
        if (!rawJsonValid) throw new Error('Metadata JSON is invalid')
        return writePngTextMetadata(editImage, editMetadata)
    }

    const saveEditedImage = async (overwrite: boolean) => {
        if (editProcessing) return
        if (overwrite && !editSourcePath) {
            toast({ title: t('exif.editor.overwriteNeedsPath'), variant: 'destructive' })
            return
        }
        setEditProcessing(true)
        try {
            const bytes = getEditedBytes()
            const path = overwrite
                ? editSourcePath
                : await save({ defaultPath: `${editSourceName.replace(/\.png$/i, '') || 'image'}_edited.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
            if (!path) return
            await writeFile(path, bytes)
            toast({ title: t('exif.editor.saved'), variant: 'success' })
        } catch (error) {
            toast({ title: t('exif.failed'), description: String(error), variant: 'destructive' })
        } finally {
            setEditProcessing(false)
        }
    }

    const copyEditedImage = async () => {
        try {
            const bytes = getEditedBytes()
            const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)], { type: 'image/png' })
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            toast({ title: t('exif.editor.copied'), variant: 'success' })
        } catch (error) {
            toast({ title: t('exif.failed'), description: String(error), variant: 'destructive' })
        }
    }

    const clearEditImage = () => {
        setEditImage(null)
        setEditSourceName('')
        setEditSourcePath(null)
        setEditMetadata(null)
        setRawJsonValid(true)
    }

    if (!enabled) {
        return <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{t('exif.disabled')}</div>
    }

    return (
        <div
            className="h-full flex flex-col gap-4"
            onDragOver={event => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files?.[0]) }}
        >
            <div className="flex items-center justify-between gap-4 shrink-0">
                <div>
                    <h1 className="text-xl font-semibold">{t('exif.title')}</h1>
                    <p className="text-sm text-muted-foreground mt-1">{t('exif.description')}</p>
                </div>
            </div>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => loadFile(event.target.files?.[0])} />

            <Tabs
                value={activeTab}
                onValueChange={value => setActiveTab(value as 'remove' | 'edit')}
                className="flex flex-1 min-h-0 flex-col"
            >
                <TabsList className="w-fit shrink-0">
                    <TabsTrigger value="remove">{t('exif.tabs.remove')}</TabsTrigger>
                    <TabsTrigger value="edit">{t('exif.tabs.edit')}</TabsTrigger>
                </TabsList>

                <TabsContent value="remove" className="mt-4 flex flex-1 min-h-0 flex-col gap-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[460px]">
                        <div className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                            <div className="px-3 py-2 text-xs font-medium border-b border-border/50">{t('exif.original')}</div>
                            <div className="flex-1 min-h-0 flex items-center justify-center p-3 relative">
                                {activeImage ? <img src={activeImage} alt="" className="max-w-full max-h-full object-contain" /> : (
                                    <button type="button" onClick={() => inputRef.current?.click()} className="w-full h-full flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                                        <ImagePlus className="h-10 w-10 mb-3 opacity-50" />
                                        <span className="text-sm">{t('exif.drop')}</span>
                                    </button>
                                )}
                                {dragging && <div className="absolute inset-3 border-2 border-dashed border-primary bg-primary/10 rounded-lg pointer-events-none" />}
                            </div>
                        </div>
                        <div className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                            <div className="px-3 py-2 text-xs font-medium border-b border-border/50 flex items-center justify-between">
                                <span>{t('exif.result')}</span>
                                {result && <span className="text-muted-foreground">{result.width} x {result.height}</span>}
                            </div>
                            <div className="flex-1 min-h-0 flex items-center justify-center p-3">
                                {resultUrl ? <img src={resultUrl} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-sm text-muted-foreground">{t('exif.noResult')}</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 shrink-0">
                        <Button onClick={processImage} disabled={!activeImage || processing}>
                            <Eraser className="h-4 w-4 mr-2" />{processing ? t('exif.processing') : t('exif.process')}
                        </Button>
                        <Button variant="outline" onClick={saveResult} disabled={!result}>
                            <Download className="h-4 w-4 mr-2" />{t('common.download')}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={clearSource} disabled={!activeImage}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                </TabsContent>

                <TabsContent value="edit" className="mt-4 flex flex-1 min-h-0 flex-col">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-[460px]">
                        <div className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                            <div className="px-3 py-2 text-xs font-medium border-b border-border/50">{t('exif.original')}</div>
                            <div className="flex-1 min-h-0 flex items-center justify-center p-3 relative">
                                {editImage ? <img src={editImage} alt="" className="max-w-full max-h-full object-contain" /> : (
                                    <button type="button" onClick={chooseEditImage} className="w-full h-full flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                                        <ImagePlus className="h-10 w-10 mb-3 opacity-50" />
                                        <span className="text-sm">{t('exif.drop')}</span>
                                    </button>
                                )}
                                {dragging && <div className="absolute inset-3 border-2 border-dashed border-primary bg-primary/10 rounded-lg pointer-events-none" />}
                            </div>
                        </div>
                        <div className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                            <ExifMetadataEditor metadata={editMetadata} onChange={setEditMetadata} onRawJsonValidityChange={setRawJsonValid} />
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 shrink-0 pt-4">
                        <Button onClick={() => saveEditedImage(true)} disabled={!editSourcePath || !editMetadata || !rawJsonValid || editProcessing}>
                            <Save className="h-4 w-4 mr-2" />{t('exif.editor.overwrite')}
                        </Button>
                        <Button variant="outline" onClick={() => saveEditedImage(false)} disabled={!editMetadata || !rawJsonValid || editProcessing}>
                            <Download className="h-4 w-4 mr-2" />{t('exif.editor.saveAs')}
                        </Button>
                        <Button variant="outline" onClick={copyEditedImage} disabled={!editMetadata || !rawJsonValid}>
                            <ClipboardCopy className="h-4 w-4 mr-2" />{t('exif.editor.copyImage')}
                        </Button>
                        <Button variant="ghost" onClick={clearEditImage} disabled={!editImage}>
                            <Trash2 className="h-4 w-4 mr-2" />{t('exif.editor.cancelImage')}
                        </Button>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
