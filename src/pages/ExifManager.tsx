import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Eraser, ImagePlus, Trash2, Upload } from 'lucide-react'
import { save } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { join, pictureDir } from '@tauri-apps/api/path'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { useExifStore } from '@/stores/exif-store'
import { useSettingsStore } from '@/stores/settings-store'
import { stripImageMetadata, StrippedImage, ExifOutputFormat } from '@/lib/exif-stripper'

const isAbsolutePath = (path: string) => /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('/')
const safeFileName = (name: string) => name.replace(/[<>:"/\\|?*]/g, '_').trim()

const getAvailableFilePath = async (directory: string, fileName: string) => {
    let candidate = await join(directory, fileName)
    if (!(await exists(candidate))) return candidate

    const extensionIndex = fileName.lastIndexOf('.')
    const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
    const extension = extensionIndex > 0 ? fileName.slice(extensionIndex) : ''
    let index = 1
    do {
        candidate = await join(directory, `${baseName} (${index})${extension}`)
        index++
    } while (await exists(candidate))
    return candidate
}

export default function ExifManager() {
    const { t } = useTranslation()
    const activeImage = useExifStore(state => state.activeImage)
    const sourceName = useExifStore(state => state.sourceName)
    const setSource = useExifStore(state => state.setSource)
    const clearSource = useExifStore(state => state.clearSource)
    const enabled = useSettingsStore(state => state.expertExifManagerEnabled)
    const autoSaveEnabled = useSettingsStore(state => state.expertExifAutoSaveEnabled)
    const autoSaveName = useSettingsStore(state => state.exifAutoSaveName)
    const autoSavePath = useSettingsStore(state => state.exifAutoSavePath)
    const [result, setResult] = useState<StrippedImage | null>(null)
    const [resultUrl, setResultUrl] = useState<string | null>(null)
    const [processing, setProcessing] = useState(false)
    const [outputFormat, setOutputFormat] = useState<ExifOutputFormat>('jpeg')
    const [dragging, setDragging] = useState(false)
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

    const loadFile = (file?: File) => {
        if (!file || !file.type.startsWith('image/')) return
        const reader = new FileReader()
        reader.onload = () => setSource(String(reader.result), file.name)
        reader.readAsDataURL(file)
    }

    const outputName = (extension: StrippedImage['extension']) => {
        const fallback = sourceName.replace(/\.[^.]+$/g, '') || 'exif_cleaned'
        const requested = safeFileName(autoSaveName.replace(/\.[^.]+$/g, '') || `${fallback}_clean`)
        return `${requested}.${extension}`
    }

    const writeResult = async (processed: StrippedImage, path: string) => {
        await writeFile(path, new Uint8Array(await processed.blob.arrayBuffer()))
    }

    const autoSave = async (processed: StrippedImage) => {
        const configuredPath = autoSavePath.trim()
        const directory = isAbsolutePath(configuredPath)
            ? configuredPath
            : await join(await pictureDir(), configuredPath || 'NAIS_EXIF')
        if (!(await exists(directory))) await mkdir(directory, { recursive: true })
        const filePath = await getAvailableFilePath(directory, outputName(processed.extension))
        await writeResult(processed, filePath)
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
            defaultPath: outputName(result.extension),
            filters: [{ name: 'Image', extensions: [result.extension] }],
        })
        if (!filePath) return
        await writeResult(result, filePath)
        toast({ title: t('toast.saved'), variant: 'success' })
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
                <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-border overflow-hidden">
                        {(['jpeg', 'png', 'webp'] as ExifOutputFormat[]).map(format => (
                            <Button
                                key={format}
                                type="button"
                                variant={outputFormat === format ? 'secondary' : 'ghost'}
                                className="h-9 rounded-none px-3 text-xs"
                                onClick={() => setOutputFormat(format)}
                            >
                                {format === 'jpeg' ? 'JPG' : format.toUpperCase()}
                            </Button>
                        ))}
                    </div>
                    <Button variant="outline" onClick={() => inputRef.current?.click()}>
                        <Upload className="h-4 w-4 mr-2" />{t('exif.open')}
                    </Button>
                    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => loadFile(event.target.files?.[0])} />
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
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
                <div className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                    <div className="px-3 py-2 text-xs font-medium border-b border-border/50">{t('exif.original')}</div>
                    <div className="flex-1 min-h-0 flex items-center justify-center p-4 relative">
                        {activeImage ? <img src={activeImage} alt="" className="max-w-full max-h-full object-contain" /> : (
                            <button type="button" onClick={() => inputRef.current?.click()} className="w-full h-full border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center text-muted-foreground hover:border-primary/50">
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
                    <div className="flex-1 min-h-0 flex items-center justify-center p-4">
                        {resultUrl ? <img src={resultUrl} alt="" className="max-w-full max-h-full object-contain" /> : <span className="text-sm text-muted-foreground">{t('exif.noResult')}</span>}
                    </div>
                </div>
            </div>
        </div>
    )
}
