import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SceneCard } from '@/stores/scene-store'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { toast } from '@/components/ui/use-toast'
import { useSettingsStore } from '@/stores/settings-store'
import { getUniqueSceneOutputFileName } from '@/lib/scene-export-name'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'

interface ExportDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    activePresetName: string
    scenes: SceneCard[]
}

type ExportFormat = 'png' | 'jpeg' | 'webp'

interface SceneZipExportResult {
    exportedCount: number
    skippedCount: number
}

interface SceneZipProgress {
    exportId: string
    completed: number
    total: number
}

export function ExportDialog({ open, onOpenChange, activePresetName, scenes }: ExportDialogProps) {
    const { t } = useTranslation()
    const expertSceneExportNameEnabled = useSettingsStore(state => state.expertSceneExportNameEnabled)
    const sceneExportNamePart = useSettingsStore(state => state.sceneExportNamePart)
    const [format, setFormat] = useState<ExportFormat>('png')
    const [quality, setQuality] = useState(90)
    const [isExporting, setIsExporting] = useState(false)
    const [progress, setProgress] = useState(0)

    const handleExport = async () => {
        if (scenes.length === 0) return
        setIsExporting(true)
        setProgress(0)

        try {
            const usedFileNames = new Set<string>()
            const entries: Array<{ source: string; fileName: string }> = []

            for (const scene of scenes) {
                const targetImage = pickSceneRepresentativeImage(scene.images)
                if (!targetImage) continue

                const ext = format === 'jpeg' ? 'jpg' : format
                const fileName = getUniqueSceneOutputFileName({
                    sceneName: scene.name,
                    enabled: expertSceneExportNameEnabled,
                    part: sceneExportNamePart,
                    extension: ext,
                    usedFileNames,
                    fallback: `Scene_${entries.length}`,
                })
                entries.push({ source: targetImage.url, fileName })
            }

            if (entries.length === 0) {
                toast({ title: t('scene.noImagesToExport'), variant: 'destructive' })
                return
            }

            const fileName = `${activePresetName}_${format.toUpperCase()}_${Date.now()}.zip`
            const filePath = await save({ defaultPath: fileName, filters: [{ name: 'ZIP File', extensions: ['zip'] }] })
            if (!filePath) return

            const exportId = `scene-zip-${Date.now()}`
            const unlisten = await listen<SceneZipProgress>('scene-zip-progress', ({ payload }) => {
                if (payload.exportId === exportId) {
                    setProgress(Math.round((payload.completed / payload.total) * 100))
                }
            })
            try {
                const result = await invoke<SceneZipExportResult>('export_scene_images_zip', {
                    outputPath: filePath,
                    entries,
                    format,
                    quality,
                    exportId,
                })
                if (result.exportedCount > 0) {
                    toast({
                        title: t('common.saved'),
                        description: result.skippedCount > 0 ? `${result.skippedCount} image(s) could not be exported.` : undefined,
                        variant: 'success',
                    })
                    onOpenChange(false)
                } else {
                    toast({ title: t('scene.noImagesToExport'), variant: 'destructive' })
                }
            } finally {
                unlisten()
            }
        } catch (error) {
            console.error(error)
            toast({ title: t('display.exportFailed'), description: String(error), variant: 'destructive' })
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => !isExporting && onOpenChange(v)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('scene.exportZip', 'ZIP 내보내기 설정')}</DialogTitle>
                    <DialogDescription>{t('scene.exportZipDesc', '이미지 형식과 품질을 선택하세요.')}</DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label>{t('scene.format', '이미지 형식')}</Label>
                        <Select value={format} onValueChange={(v: ExportFormat) => setFormat(v)} disabled={isExporting}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="png">PNG (Lossless)</SelectItem>
                                <SelectItem value="webp">WEBP (High Efficiency)</SelectItem>
                                <SelectItem value="jpeg">JPG (Standard)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {format !== 'png' && (
                        <div className="grid gap-2">
                            <Label>{t('scene.quality', '품질')} ({quality}%)</Label>
                            <Slider
                                value={[quality]}
                                onValueChange={(v) => setQuality(v[0])}
                                min={10}
                                max={100}
                                step={1}
                                disabled={isExporting}
                            />
                        </div>
                    )}
                </div>

                <DialogFooter className="sm:justify-between items-center">
                    {isExporting && <span className="text-xs text-muted-foreground">Converting... {progress}%</span>}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={handleExport} disabled={isExporting}>
                            {isExporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {t('common.export')}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
