
import { useState, useRef, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'
import { smartTools } from '@/services/smart-tools'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { Eraser, Grid3X3, Upload, RefreshCw, Download, X, Maximize2, Image as ImageIcon, Paintbrush, ImagePlus, PenTool, Pencil, Droplets, Smile, Sparkles, ChevronRight } from 'lucide-react'
import { writeFile, BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { pictureDir, join } from '@tauri-apps/api/path'
import { BackgroundRemovalDialog } from '@/components/tools/BackgroundRemovalDialog'
import { MosaicDialog } from '@/components/tools/MosaicDialog'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { I2IDialog } from '@/components/tools/I2IDialog'


export default function ToolsMode() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { activeImage, setActiveImage } = useToolsStore(useShallow(state => ({
        activeImage: state.activeImage,
        setActiveImage: state.setActiveImage,
    })))
    const { token, tier } = useAuthStore(useShallow(state => ({
        token: state.token,
        tier: state.tier,
    })))

    const [processedImage, setProcessedImage] = useState<string | null>(activeImage)
    const [isLoading, setIsLoading] = useState(false)
    const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null)
    const [upscaleScale, setUpscaleScale] = useState(2)
    const toolCosts = useMemo(() => {
        if (!imageDimensions) return null
        const isOpus = tier?.toLowerCase() === 'opus'
        return {
            upscale: directorToolCost(imageDimensions.width, imageDimensions.height, isOpus),
            background: directorAugmentCost('bg-removal', imageDimensions.width, imageDimensions.height, isOpus),
            standard: directorAugmentCost('lineart', imageDimensions.width, imageDimensions.height, isOpus),
        }
    }, [imageDimensions, tier])

    // Background Removal State
    const [isRembgOpen, setIsRembgOpen] = useState(false)
    const [rembgOriginal, setRembgOriginal] = useState<string | null>(null)
    const [rembgResult, setRembgResult] = useState<string | null>(null)


    // Mosaic State
    const [isMosaicOpen, setIsMosaicOpen] = useState(false)
    const [isI2IOpen, setIsI2IOpen] = useState(false)
    const [isInpaintingOpen, setIsInpaintingOpen] = useState(false)  // For mask editing only
    const [colorizeOptions, setColorizeOptions] = useState({ defry: 0, prompt: '' })
    const [emotionOptions, setEmotionOptions] = useState({ defry: 0, prompt: '', emotion: 'neutral' })
    const containerRef = useRef<HTMLDivElement>(null)
    const [isDragOver, setIsDragOver] = useState(false)
    const dragCounter = useRef(0)

    // Sync store to local state
    useEffect(() => {
        setProcessedImage(activeImage)
        setImageDimensions(null)
    }, [activeImage])

    // Handle File Upload
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onload = (e) => {
                const result = e.target?.result as string
                setActiveImage(result)
            }
            reader.readAsDataURL(file)
        }
    }

    // Drag & Drop Handlers
    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current++
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true)
        }
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragOver(false)
        }
    }

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
        setIsDragOver(false)

        const file = e.dataTransfer.files?.[0]
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = (ev) => {
                const result = ev.target?.result as string
                setActiveImage(result)
            }
            reader.readAsDataURL(file)
        }
    }

    const handleRemoveBackground = async () => {
        if (!processedImage) return
        setIsLoading(true)
        try {
            const result = token
                ? await smartTools.directorTool(processedImage, token, 'bg-removal')
                : await smartTools.removeBackground(processedImage)
            // Open comparison dialog instead of directly replacing
            setRembgOriginal(processedImage)
            setRembgResult(result)
            setIsRembgOpen(true)
        } catch (e) {
            console.error(e)
            toast({ title: t('smartTools.error', '작업 실패'), description: String(e), variant: 'destructive' })
        } finally {
            setIsLoading(false)
        }
    }



    const handleUpscale = async () => {
        if (!processedImage) return
        if (!token) {
            toast({ title: t('toast.tokenRequired.title', 'API 토큰 필요'), description: t('toast.tokenRequired.desc', '설정에서 토큰을 입력해주세요.'), variant: 'destructive' })
            return
        }

        setIsLoading(true)
        try {
            const result = await smartTools.upscale(processedImage, token, upscaleScale)

            // Save to configured save path with UPSCALE prefix
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const outputDir = savePath || 'NAIS_Output'
            const fileName = `NAIS_UPSCALE_${Date.now()}.png`

            try {
                const base64Data = result.replace(/^data:image\/png;base64,/, '')
                const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

                let fullPath: string

                if (useAbsolutePath) {
                    // Save to absolute path directly
                    const dirExists = await exists(outputDir)
                    if (!dirExists) {
                        await mkdir(outputDir, { recursive: true })
                    }
                    fullPath = await join(outputDir, fileName)
                    await writeFile(fullPath, binaryData)
                } else {
                    // Save relative to Pictures directory
                    const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                    if (!dirExists) {
                        await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                    }
                    await writeFile(`${outputDir}/${fileName}`, binaryData, { baseDir: BaseDirectory.Picture })
                    const picPath = await pictureDir()
                    fullPath = await join(picPath, outputDir, fileName)
                }

                // Dispatch event for instant history update
                try {
                    window.dispatchEvent(new CustomEvent('newImageGenerated', {
                        detail: { path: fullPath, data: result }
                    }))
                } catch (e) {
                    console.warn('Failed to dispatch newImageGenerated event:', e)
                }
            } catch (e) {
                console.warn('Failed to save upscaled image:', e)
            }

            // Set as preview image
            const { setPreviewImage } = useGenerationStore.getState()
            setPreviewImage(result)

            toast({ title: t('smartTools.upscaleComplete', '업스케일 완료'), description: `${upscaleScale}x`, variant: 'success' })

            // Navigate to main mode
            navigate('/')
        } catch (e) {
            console.error(e)
            toast({ title: t('smartTools.error', '작업 실패'), description: String(e), variant: 'destructive' })
        } finally {
            setIsLoading(false)
        }
    }

    // Director Tools handler
    const handleDirectorTool = async (reqType: 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'declutter', options?: { defry?: number; prompt?: string; emotion?: string }) => {
        if (!processedImage) return
        if (!token) {
            toast({ title: t('toast.tokenRequired.title', 'API 토큰 필요'), description: t('toast.tokenRequired.desc', '설정에서 토큰을 입력해주세요.'), variant: 'destructive' })
            return
        }

        setIsLoading(true)
        try {
            const result = await smartTools.directorTool(processedImage, token, reqType, options)

            // Save to disk
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const outputDir = savePath || 'NAIS_Output'
            const label = reqType.toUpperCase().replace('-', '_')
            const fileName = `NAIS_${label}_${Date.now()}.png`

            try {
                const base64Data = result.replace(/^data:image\/\w+;base64,/, '')
                const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

                let fullPath: string

                if (useAbsolutePath) {
                    const dirExists = await exists(outputDir)
                    if (!dirExists) await mkdir(outputDir, { recursive: true })
                    fullPath = await join(outputDir, fileName)
                    await writeFile(fullPath, binaryData)
                } else {
                    const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                    if (!dirExists) await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                    await writeFile(`${outputDir}/${fileName}`, binaryData, { baseDir: BaseDirectory.Picture })
                    const picPath = await pictureDir()
                    fullPath = await join(picPath, outputDir, fileName)
                }

                // Dispatch for instant history update
                window.dispatchEvent(new CustomEvent('newImageGenerated', {
                    detail: { path: fullPath, data: result }
                }))
            } catch (e) {
                console.warn('Failed to save director tool image:', e)
            }

            setActiveImage(result)
            toast({ title: t('smartTools.directorComplete', '처리 완료'), variant: 'success' })
        } catch (e) {
            console.error(e)
            toast({ title: t('smartTools.error', '작업 실패'), description: String(e), variant: 'destructive' })
        } finally {
            setIsLoading(false)
        }
    }

    // Save to Disk (New functionality for Tools Page)
    const handleSaveFile = async () => {
        if (!processedImage) return
        try {
            // Remove header
            const base64Data = processedImage.replace(/^data:image\/\w+;base64,/, "")
            // Decode
            const binary = atob(base64Data)
            const array = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i)

            const filename = `NAIS_Edit_${Date.now()}.png`
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const outputDir = savePath || 'NAIS_Output'

            if (useAbsolutePath) {
                // Save to absolute path directly
                const dirExists = await exists(outputDir)
                if (!dirExists) {
                    await mkdir(outputDir, { recursive: true })
                }
                const fullPath = await join(outputDir, filename)
                await writeFile(fullPath, array)
            } else {
                // Save relative to Pictures directory
                const dirExists = await exists(outputDir, { baseDir: BaseDirectory.Picture })
                if (!dirExists) {
                    await mkdir(outputDir, { baseDir: BaseDirectory.Picture })
                }
                await writeFile(`${outputDir}/${filename}`, array, { baseDir: BaseDirectory.Picture })
            }

            toast({ title: t('common.saved', '저장됨'), description: filename, variant: 'success' })
        } catch (e) {
            console.error(e)
            toast({ title: t('common.saveFailed', '저장 실패'), variant: 'destructive' })
        }
    }

    return (
        <div
            className="flex h-full gap-4 relative"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {/* Drag overlay */}
            {isDragOver && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center rounded-xl">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary via-purple-500 to-primary animate-pulse opacity-50 blur-xl" />
                        <div className="relative bg-background/80 backdrop-blur-xl border border-white/20 rounded-3xl p-12 shadow-2xl">
                            <div className="text-center space-y-4">
                                <div className="relative mx-auto w-20 h-20">
                                    <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                                    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center">
                                        <ImagePlus className="h-10 w-10 text-white" />
                                    </div>
                                </div>
                                <div>
                                    <p className="text-xl font-semibold text-foreground">
                                        {t('smartTools.dropToLoad', '이미지를 드롭하여 열기')}
                                    </p>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {t('smartTools.supportedFormats', 'PNG, JPG, WEBP 지원')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Left: Image Workspace */}
            <div className="flex-1 bg-muted/20 rounded-xl border border-border overflow-hidden flex flex-col relative" ref={containerRef}>
                {processedImage ? (
                    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
                        <img
                            src={processedImage}
                            onLoad={(event) => {
                                const image = event.currentTarget
                                setImageDimensions({ width: image.naturalWidth, height: image.naturalHeight })
                            }}
                            className="max-w-full max-h-full object-contain shadow-lg"
                            alt="Workspace"
                        />

                        {isLoading && (
                            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white z-10">
                                <div className="relative">
                                    <div className="absolute inset-0 w-20 h-20 rounded-full bg-primary/30 animate-ping" />
                                    <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center shadow-xl">
                                        <RefreshCw className="h-8 w-8 animate-spin" />
                                    </div>
                                </div>
                                <div className="mt-6 text-lg font-semibold tracking-wide">
                                    {t('smartTools.processing', '처리 중...')}
                                </div>
                                <div className="mt-2 text-sm text-white/60">
                                    {t('smartTools.pleaseWait', '잠시만 기다려주세요')}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div
                        className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 border-2 border-dashed border-border rounded-lg m-4 transition-colors hover:border-primary/50"
                    >
                        <Upload className="h-16 w-16 mb-4 opacity-20" />
                        <h3 className="text-xl font-medium mb-2">{t('smartTools.dropHint', '이미지를 열거나 드래그하세요')}</h3>
                        <p className="text-sm opacity-60 mb-6">{t('smartTools.supportedFormats', 'PNG, JPG, WEBP 지원')}</p>
                        <Button variant="outline" className="relative">
                            {t('smartTools.openImage', '이미지 열기')}
                            <input
                                type="file"
                                className="absolute inset-0 opacity-0 cursor-pointer"
                                accept="image/*"
                                onChange={handleFileChange}
                            />
                        </Button>
                    </div>
                )}

                {/* Image Actions (Bottom Overlay) */}
                {processedImage && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-background/80 backdrop-blur-md rounded-full shadow-lg border border-border z-20">
                        <Button size="icon" variant="ghost" className="rounded-full" onClick={() => setActiveImage(null)}>
                            <X className="h-4 w-4" />
                        </Button>
                        <div className="w-px h-6 bg-border mx-1 my-auto" />
                        <Button size="icon" variant="ghost" className="rounded-full" onClick={handleSaveFile}>
                            <Download className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>

            {/* Right: Tools Options */}
            <div className="w-[320px] bg-card rounded-xl border border-border flex flex-col overflow-hidden">

                <div
                    className="p-3 flex-1 overflow-y-auto overscroll-contain flex flex-col gap-2.5"
                    style={{ scrollbarGutter: 'stable' }}
                >
                    <ToolCard icon={ImageIcon} color="text-indigo-400" title={t('tools.i2i.title', 'I2I')} description={t('tools.i2i.open', '이 이미지로 img2img')} disabled={!processedImage || isLoading} onRun={() => {
                        useGenerationStore.getState().setI2IMode('i2i')
                        setIsI2IOpen(true)
                    }} />
                    <ToolCard icon={Paintbrush} color="text-pink-400" title={t('tools.inpainting.title', '인페인트')} description={t('tools.inpainting.open', '마스크 칠해 부분 재생성')} disabled={!processedImage || isLoading} onRun={() => setIsInpaintingOpen(true)} />

                    <div className="my-0.5 h-px shrink-0 bg-border" />

                    <ToolCard icon={Maximize2} color="text-cyan-400" title={t('smartTools.upscale', '업스케일')} description={t('smartTools.upscaleDesc', '해상도를 배수로 키움')} cost={toolCosts?.upscale} disabled={!processedImage || isLoading || !token} onRun={handleUpscale}>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            {[2, 4].map((scale) => (
                                <button key={scale} type="button" onClick={() => setUpscaleScale(scale)} className={cn('flex-1 rounded-md border py-1 text-xs font-medium transition-colors', upscaleScale === scale ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>{scale}x</button>
                            ))}
                        </div>
                    </ToolCard>
                    <ToolCard icon={Eraser} color="text-rose-400" title={t('smartTools.rembg', '배경 제거')} description={t('smartTools.rembgDesc', '캐릭터만 남기고 배경을 투명하게')} cost={token ? toolCosts?.background : processedImage ? 0 : null} disabled={!processedImage || isLoading} onRun={handleRemoveBackground} />
                    <ToolCard icon={PenTool} color="text-sky-400" title={t('smartTools.lineart', '라인아트')} description={t('smartTools.lineartDesc', '선화 추출')} cost={toolCosts?.standard} disabled={!processedImage || isLoading || !token} onRun={() => handleDirectorTool('lineart')} />
                    <ToolCard icon={Pencil} color="text-amber-400" title={t('smartTools.sketch', '스케치')} description={t('smartTools.sketchDesc', '스케치풍으로 변환')} cost={toolCosts?.standard} disabled={!processedImage || isLoading || !token} onRun={() => handleDirectorTool('sketch')} />
                    <ToolCard icon={Droplets} color="text-emerald-400" title={t('smartTools.colorize', '색칠')} description={t('smartTools.colorizeDesc', '선화를 채색')} cost={toolCosts?.standard} disabled={!processedImage || isLoading || !token} onRun={() => handleDirectorTool('colorize', { defry: colorizeOptions.defry, prompt: colorizeOptions.prompt })}>
                        <DirectorToolOptions value={colorizeOptions} onChange={setColorizeOptions} promptPlaceholder={t('smartTools.colorizePrompt', '색 유도 프롬프트 (선택)')} t={t} />
                    </ToolCard>
                    <ToolCard icon={Smile} color="text-fuchsia-400" title={t('smartTools.emotion', '표정 변경')} description={t('smartTools.emotionDesc', '얼굴 표정을 교체')} cost={toolCosts?.standard} disabled={!processedImage || isLoading || !token} onRun={() => handleDirectorTool('emotion', emotionOptions)}>
                        <DirectorToolOptions value={emotionOptions} onChange={setEmotionOptions} promptPlaceholder={t('smartTools.emotionPrompt', '추가 프롬프트 (선택)')} showEmotion t={t} />
                    </ToolCard>
                    <ToolCard icon={Sparkles} color="text-violet-400" title={t('smartTools.declutter', '이미지 정리')} description={t('smartTools.declutterDesc', '불필요한 요소 제거')} cost={toolCosts?.standard} disabled={!processedImage || isLoading || !token} onRun={() => handleDirectorTool('declutter')} />

                    <div className="my-0.5 h-px shrink-0 bg-border" />

                    <ToolCard icon={Grid3X3} color="text-orange-400" title={t('smartTools.mosaic', '모자이크')} description={t('smartTools.mosaicDesc', '브러시로 칠해 가리기')} disabled={!processedImage || isLoading} onRun={() => setIsMosaicOpen(true)} />
                </div>
            </div>

            <BackgroundRemovalDialog
                originalImage={rembgOriginal}
                processedImage={rembgResult}
                isOpen={isRembgOpen}
                onClose={() => setIsRembgOpen(false)}
            />

            <MosaicDialog
                sourceImage={processedImage}
                isOpen={isMosaicOpen}
                onClose={() => setIsMosaicOpen(false)}
            />

            <I2IDialog
                open={isI2IOpen}
                onOpenChange={setIsI2IOpen}
                sourceImage={processedImage}
            />

            <InpaintingDialog
                open={isInpaintingOpen}
                onOpenChange={(open) => {
                    setIsInpaintingOpen(open)
                    // Navigate to main mode after mask editing is done
                    if (!open && useGenerationStore.getState().i2iMode === 'inpaint') {
                        navigate('/')
                    }
                }}
                sourceImage={processedImage}
            />
        </div>
    )
}

function CostChip({ cost }: { cost: number | null | undefined }) {
    const { t } = useTranslation()
    if (cost == null) return null
    return (
        <span className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
            cost === 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-destructive/15 text-destructive"
        )}>
            <span>{cost === 0 ? t('smartTools.freeCost', '무료') : `-${cost}`}</span>
        </span>
    )
}

function directorToolCost(width: number, height: number, isOpus: boolean): number {
    const pixels = width * height
    if (isOpus && pixels <= 409600) return 0
    if (pixels <= 262144) return 1
    if (pixels <= 409600) return 2
    if (pixels <= 524288) return 3
    if (pixels <= 786432) return 5
    return 7
}

function directorAugmentCost(method: 'bg-removal' | 'lineart', width: number, height: number, isOpus: boolean): number {
    if (width <= 0 || height <= 0) return 0
    let normalizedWidth = width
    let normalizedHeight = height
    const pixels = width * height
    const targetPixels = pixels > 3_145_728 ? 3_145_728 : pixels < 1_048_576 ? 1_048_576 : pixels
    if (targetPixels !== pixels) {
        const ratio = Math.sqrt(targetPixels / pixels)
        normalizedWidth = Math.floor(width * ratio)
        normalizedHeight = Math.floor(height * ratio)
    }
    const normalizedPixels = Math.max(normalizedWidth * normalizedHeight, 65_536)
    const perImage = Math.max(Math.ceil(2.951823174884865e-6 * normalizedPixels + 5.753298233447344e-7 * normalizedPixels * 28), 2)
    if (method === 'bg-removal') return perImage * 3 + 5
    return isOpus && normalizedPixels <= 1_048_576 ? 0 : perImage
}

function ToolCard({ children, icon: Icon, color, title, description, disabled, cost, onRun }: any) {
    return (
        <div
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
            onClick={() => !disabled && onRun?.()}
            onKeyDown={(event) => {
                if (!disabled && (event.key === 'Enter' || event.key === ' ')) onRun?.()
            }}
            className={cn(
                "group shrink-0 rounded-xl border border-border bg-card/60 p-3 transition-colors",
                disabled ? "opacity-55" : "cursor-pointer hover:bg-muted/45 hover:border-primary/40"
            )}
            style={{ contain: 'layout paint style' }}
        >
            <div className={cn("flex items-center gap-2.5", children && "mb-2")}>
                <Icon className={cn("h-[18px] w-[18px] shrink-0", color)} />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="truncate text-xs text-muted-foreground">{description}</p>
                </div>
                <CostChip cost={cost} />
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </div>
            {children}
        </div>
    )
}

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'

const EMOTIONS = [
    'neutral', 'happy', 'sad', 'angry', 'scared', 'surprised',
    'tired', 'excited', 'nervous', 'thinking', 'confused',
    'shy', 'disgusted', 'smug', 'bored', 'laughing',
    'crying', 'tsundere', 'yandere', 'kuudere', 'blushing',
] as const

function DirectorToolOptions({ value, onChange, showEmotion, promptPlaceholder, t }: {
    value: { defry: number; prompt: string; emotion?: string }
    onChange: (value: any) => void
    showEmotion?: boolean
    promptPlaceholder?: string
    t: any
}) {
    return (
        <div className="grid gap-1.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            {showEmotion && (
                    <Select value={value.emotion ?? 'neutral'} onValueChange={(emotion) => onChange({ ...value, emotion })}>
                        <SelectTrigger className="h-8 w-full text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[200px]">
                            {EMOTIONS.map(e => (
                                <SelectItem key={e} value={e}>{e}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
            )}
            <Input value={value.prompt} onChange={(event) => onChange({ ...value, prompt: event.target.value })} placeholder={promptPlaceholder} className="h-8 text-sm" />
            <div className="flex items-center gap-2 px-0.5">
                <span className="shrink-0 text-[11px] text-muted-foreground">{t('smartTools.defry', '약화')} {value.defry}</span>
                <Slider
                    value={[value.defry]}
                    onValueChange={([defry]) => onChange({ ...value, defry })}
                    min={0}
                    max={5}
                    step={1}
                    className="flex-1"
                />
            </div>
        </div>
    )
}
