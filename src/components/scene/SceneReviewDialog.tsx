import { useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'
import { useGenerationStore } from '@/stores/generation-store'
import type { SceneCard, SceneImage } from '@/stores/scene-store'

interface SceneReviewDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    scenes: SceneCard[]
}

type ReviewTab = 'all' | 'individual' | 'pending' | 'completed'

interface ReviewImage extends SceneImage {
    sceneId: string
    sceneName: string
}

const imageSrc = (url: string) => url.startsWith('data:') ? url : convertFileSrc(url)

function ReviewImageGrid({ images, onSelect }: { images: ReviewImage[]; onSelect: (image: ReviewImage) => void }) {
    const { t } = useTranslation()

    if (images.length === 0) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noGeneratedImages')}</div>
    }

    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 pr-1">
            {images.map(image => (
                <button
                    key={`${image.sceneId}:${image.id}`}
                    type="button"
                    className="aspect-square overflow-hidden rounded-lg border border-border/60 bg-black/30 transition-colors hover:border-primary/60"
                    onClick={() => onSelect(image)}
                >
                    <img src={imageSrc(image.url)} alt={image.sceneName} loading="lazy" decoding="async" className="h-full w-full object-contain" />
                </button>
            ))}
        </div>
    )
}

function ReviewPromptField({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
    return (
        <label className="flex min-h-0 flex-1 flex-col gap-1">
            <span className={cn('text-xs font-medium text-muted-foreground', negative && 'text-destructive/80')}>{label}</span>
            <textarea
                readOnly
                value={value}
                className={cn('min-h-0 flex-1 resize-none rounded-lg border border-border/60 bg-background/50 p-2 text-xs outline-none', negative && 'border-destructive/20')}
            />
        </label>
    )
}

function IndividualReviewView({ scene, image, onSelectImage, onBack }: {
    scene?: SceneCard
    image?: SceneImage | null
    onSelectImage: (imageId: string) => void
    onBack?: () => void
}) {
    const { t } = useTranslation()
    const { basePrompt, additionalPrompt, detailPrompt, negativePrompt } = useGenerationStore.getState()

    if (!scene || !image) {
        return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noGeneratedImages')}</div>
    }

    return (
        <div className="grid h-full min-h-0 grid-cols-[minmax(210px,0.8fr)_minmax(0,2fr)_minmax(180px,0.7fr)] gap-3">
            <aside className="flex min-h-0 flex-col gap-2 rounded-xl border border-border/50 bg-card/40 p-3">
                <ReviewPromptField label={t('prompt.base')} value={basePrompt} />
                <ReviewPromptField label={t('prompt.additional')} value={additionalPrompt} />
                <ReviewPromptField label={t('prompt.detail')} value={detailPrompt} />
                <ReviewPromptField label={t('prompt.negative')} value={negativePrompt} negative />
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border/50 bg-card/40 p-3">
                <div className="flex min-w-0 items-center gap-2">
                    {onBack && (
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onBack} aria-label={t('scene.reviewBack')}>
                            <ArrowLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <h2 className="truncate text-sm font-semibold" title={scene.name}>{scene.name}</h2>
                </div>
                <label className="mt-2 flex shrink-0 flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground">{t('scene.scenePrompt')}</span>
                    <textarea readOnly value={scene.scenePrompt} className="h-24 resize-none rounded-lg border border-border/60 bg-background/50 p-2 text-xs outline-none" />
                </label>
                <div className="mt-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black/30">
                    <img src={imageSrc(image.url)} alt={scene.name} className="h-full w-full object-contain" />
                </div>
            </section>

            <aside className="flex min-h-0 flex-col rounded-xl border border-border/50 bg-card/40 p-3">
                <div className="mb-2 text-sm font-medium">{t('history.title')}</div>
                <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto custom-scrollbar pr-1">
                    {scene.images.map(historyImage => (
                        <button
                            key={historyImage.id}
                            type="button"
                            className={cn('aspect-square overflow-hidden rounded-md border bg-black/30', historyImage.id === image.id ? 'border-primary ring-1 ring-primary' : 'border-border/50 hover:border-primary/50')}
                            onClick={() => onSelectImage(historyImage.id)}
                        >
                            <img src={imageSrc(historyImage.url)} alt={scene.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        </button>
                    ))}
                </div>
            </aside>
        </div>
    )
}

export function SceneReviewDialog({ open, onOpenChange, scenes }: SceneReviewDialogProps) {
    const { t } = useTranslation()
    const [activeTab, setActiveTab] = useState<ReviewTab>('all')
    const [allDetailOpen, setAllDetailOpen] = useState(false)
    const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
    const images = useMemo(() => open
        ? scenes.flatMap(scene => {
            const image = pickSceneRepresentativeImage(scene.images)
            return image ? [{ ...image, sceneId: scene.id, sceneName: scene.name }] : []
        })
        : [], [open, scenes])
    const selectedScene = scenes.find(scene => scene.id === selectedSceneId)
        || scenes.find(scene => scene.id === images[0]?.sceneId)
    const selectedImage = selectedScene?.images.find(image => image.id === selectedImageId)
        || (selectedScene ? pickSceneRepresentativeImage(selectedScene.images) : null)

    const selectImage = (image: ReviewImage, stayInAll: boolean) => {
        setSelectedSceneId(image.sceneId)
        setSelectedImageId(image.id)
        if (stayInAll) setAllDetailOpen(true)
        else setActiveTab('individual')
    }

    const selectTab = (tab: ReviewTab) => {
        setActiveTab(tab)
        if (tab === 'all') setAllDetailOpen(false)
    }

    const tabs: Array<{ id: ReviewTab; label: string }> = [
        { id: 'all', label: t('scene.reviewAll') },
        { id: 'individual', label: t('scene.reviewIndividual') },
        { id: 'pending', label: t('scene.reviewPending') },
        { id: 'completed', label: t('scene.reviewCompleted') },
    ]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!flex !h-[88vh] !w-[92vw] !max-w-[1600px] flex-col gap-3 overflow-hidden p-4">
                <DialogHeader className="shrink-0">
                    <DialogTitle>{t('scene.reviewImages')}</DialogTitle>
                </DialogHeader>
                <div role="tablist" className="flex h-9 shrink-0 items-end gap-1 border-b border-border/60">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={cn('h-9 border-b-2 px-3 text-xs font-medium transition-colors', activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                            onClick={() => selectTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="min-h-0 flex-1">
                    {activeTab === 'all' && (
                        <>
                            <div className={cn('h-full overflow-y-auto custom-scrollbar', allDetailOpen && 'hidden')}>
                                <ReviewImageGrid images={images} onSelect={image => selectImage(image, true)} />
                            </div>
                            {allDetailOpen && (
                                <IndividualReviewView scene={selectedScene} image={selectedImage} onSelectImage={setSelectedImageId} onBack={() => setAllDetailOpen(false)} />
                            )}
                        </>
                    )}
                    {activeTab === 'individual' && (
                        <IndividualReviewView scene={selectedScene} image={selectedImage} onSelectImage={setSelectedImageId} />
                    )}
                    {activeTab === 'pending' && (
                        <div className="h-full overflow-y-auto custom-scrollbar">
                            <ReviewImageGrid images={images} onSelect={image => selectImage(image, false)} />
                        </div>
                    )}
                    {activeTab === 'completed' && (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('scene.noReviewedImages')}</div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
