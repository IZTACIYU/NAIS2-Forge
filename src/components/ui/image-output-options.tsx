import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Label } from '@/components/ui/label'

export type ImageOutputFormat = 'png' | 'webp' | 'jpeg'

interface ImageOutputOptionsProps {
    format: ImageOutputFormat
    quality: number
    onFormatChange: (format: ImageOutputFormat) => void
    onQualityChange: (quality: number) => void
    disabled?: boolean
}

export function ImageOutputOptions({ format, quality, onFormatChange, onQualityChange, disabled }: ImageOutputOptionsProps) {
    const { t } = useTranslation()
    return (
        <div className="grid gap-4">
            <div className="grid gap-2">
                <Label>{t('scene.format', '이미지 형식')}</Label>
                <Select value={format} onValueChange={(value: ImageOutputFormat) => onFormatChange(value)} disabled={disabled}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="png">PNG</SelectItem>
                        <SelectItem value="webp">WebP</SelectItem>
                        <SelectItem value="jpeg">JPEG</SelectItem>
                    </SelectContent>
                </Select>
            </div>
            {format === 'webp' && (
                <div className="grid gap-2">
                    <Label>{t('settingsPage.save.exportDefaults.webpQuality')} ({quality}%)</Label>
                    <Slider value={[quality]} onValueChange={value => onQualityChange(value[0])} min={10} max={100} step={1} disabled={disabled} />
                </div>
            )}
        </div>
    )
}
