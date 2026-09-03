import { useMemo } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'
import type { SceneCard } from '@/stores/scene-store'

interface SceneReviewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    scenes: SceneCard[]
}

export function SceneReviewDialog({ open, onOpenChange, scenes }: SceneReviewDialogProps) {
    const { t } = useTranslation()
    const images = useMemo(() => open
        ? scenes.flatMap(scene => {
            const image = pickSceneRepresentativeImage(scene.images)
            return image ? [{ ...image, sceneId: scene.id, sceneName: scene.name }] : []
        })
        : [], [open, scenes])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!h-[88vh] !w-[92vw] !max-w-[1600px] flex flex-col gap-3 overflow-hidden p-4">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{t('scene.reviewImages')}</DialogTitle>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    {images.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            {t('scene.noGeneratedImages')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pr-1">
                            {images.map(image => (
                                <div key={`${image.sceneId}:${image.id}`} className="aspect-square overflow-hidden rounded-lg border border-border/60 bg-black/30">
                                    <img
                                        src={image.url.startsWith('data:') ? image.url : convertFileSrc(image.url)}
                                        alt={image.sceneName}
                                        loading="lazy"
                                        decoding="async"
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
