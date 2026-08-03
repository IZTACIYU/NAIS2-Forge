import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tip } from '@/components/ui/tooltip'
import { Check, ChevronDown, Lock, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings-store'
import { cn } from '@/lib/utils'

export const RESOLUTION_PRESETS = [
    { key: 'portrait', width: 832, height: 1216 },
    { key: 'landscape', width: 1216, height: 832 },
    { key: 'square', width: 1024, height: 1024 },
    { key: 'tallPortrait', width: 640, height: 1536 },
    { key: 'wideLandscape', width: 1536, height: 640 },
]

export const roundTo64 = (value: number): number => Math.round(value / 64) * 64

export interface Resolution {
    label: string
    width: number
    height: number
}

interface ResolutionSelectorProps {
    value: Resolution
    onChange: (resolution: Resolution) => void
    disabled?: boolean
}

export function ResolutionSelector({ value, onChange, disabled }: ResolutionSelectorProps) {
    const { t } = useTranslation()
    const customResolutions = useSettingsStore(state => state.customResolutions)
    const addCustomResolution = useSettingsStore(state => state.addCustomResolution)
    const removeCustomResolution = useSettingsStore(state => state.removeCustomResolution)
    const [open, setOpen] = useState(false)
    const [widthInput, setWidthInput] = useState(() => String(value.width))
    const [heightInput, setHeightInput] = useState(() => String(value.height))
    const [saveDialogOpen, setSaveDialogOpen] = useState(false)
    const [presetName, setPresetName] = useState('')

    useEffect(() => {
        setWidthInput(String(value.width))
        setHeightInput(String(value.height))
    }, [value.width, value.height])

    const standardPreset = RESOLUTION_PRESETS.find(
        preset => preset.width === value.width && preset.height === value.height
    )
    const customPreset = customResolutions.find(
        preset => preset.width === value.width && preset.height === value.height
    )
    const isSavedPreset = Boolean(standardPreset || customPreset)
    const displayText = standardPreset
        ? t(`resolutions.${standardPreset.key}`)
        : customPreset?.label || `${value.width} × ${value.height}`

    const selectResolution = (preset: { key?: string; width: number; height: number; label?: string }) => {
        const label = preset.key
            ? t(`resolutions.${preset.key}`)
            : preset.label || `${preset.width}x${preset.height}`
        onChange({ label, width: preset.width, height: preset.height })
        setOpen(false)
    }

    const commitDimensions = () => {
        const rawWidth = Number(widthInput)
        const rawHeight = Number(heightInput)
        if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth < 64 || rawHeight < 64) {
            setWidthInput(String(value.width))
            setHeightInput(String(value.height))
            return
        }

        const width = roundTo64(rawWidth)
        const height = roundTo64(rawHeight)
        if (width !== value.width || height !== value.height) {
            onChange({ label: `${width}x${height}`, width, height })
        }
    }

    const openSaveDialog = () => {
        setPresetName('')
        setSaveDialogOpen(true)
    }

    const savePreset = () => {
        const label = presetName.trim()
        if (!label || isSavedPreset) return

        addCustomResolution({ label, width: value.width, height: value.height })
        onChange({ label, width: value.width, height: value.height })
        setSaveDialogOpen(false)
    }

    const isSelected = (width: number, height: number) => value.width === width && value.height === height
    const inputClassName = 'h-full min-w-0 rounded-none border-0 bg-transparent px-2 text-center font-mono text-xs shadow-none [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

    return (
        <>
            <div className="grid gap-2">
                <div className="flex items-center justify-between">
                    <Label>{t('resolutions.title')}</Label>
                    <Tip content={isSavedPreset ? t('resolutions.alreadySaved') : t('resolutions.savePreset')}>
                        <span>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 rounded-md"
                                onClick={openSaveDialog}
                                disabled={disabled || isSavedPreset}
                            >
                                {isSavedPreset ? <Lock className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            </Button>
                        </span>
                    </Tip>
                </div>

                <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-2">
                    <Popover open={open} onOpenChange={setOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={open}
                                disabled={disabled}
                                className="h-9 min-w-0 justify-between rounded-xl font-normal"
                            >
                                <span className="truncate">{displayText}</span>
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent
                            className="p-0"
                            align="start"
                            style={{ width: 'var(--radix-popover-trigger-width)' }}
                        >
                            <div className="max-h-[300px] overflow-auto">
                                <div className="p-1">
                                    {RESOLUTION_PRESETS.map(preset => (
                                        <button
                                            key={preset.key}
                                            onClick={() => selectResolution(preset)}
                                            className={cn(
                                                'flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                                                isSelected(preset.width, preset.height) && 'bg-accent'
                                            )}
                                        >
                                            <span className="flex items-center gap-2">
                                                {isSelected(preset.width, preset.height) ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                                                <span>{t(`resolutions.${preset.key}`)}</span>
                                            </span>
                                            <span className="text-xs text-muted-foreground">{preset.width} × {preset.height}</span>
                                        </button>
                                    ))}
                                </div>

                                {customResolutions.length > 0 && (
                                    <>
                                        <div className="mx-1 h-px bg-border" />
                                        <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                                            {t('resolutions.custom')}
                                        </div>
                                        <div className="p-1 pt-0">
                                            {customResolutions.map(preset => (
                                                <div
                                                    key={preset.id}
                                                    className={cn(
                                                        'group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                                                        isSelected(preset.width, preset.height) && 'bg-accent'
                                                    )}
                                                >
                                                    <button
                                                        onClick={() => selectResolution(preset)}
                                                        className="flex flex-1 cursor-pointer items-center gap-2 text-left"
                                                    >
                                                        {isSelected(preset.width, preset.height) ? <Check className="h-4 w-4" /> : <span className="w-4" />}
                                                        <span>{preset.label}</span>
                                                    </button>
                                                    <span className="flex items-center gap-1">
                                                        <span className="text-xs text-muted-foreground">{preset.width} × {preset.height}</span>
                                                        <Tip content={t('common.delete')}>
                                                            <button
                                                                onClick={(event) => {
                                                                    event.stopPropagation()
                                                                    removeCustomResolution(preset.id)
                                                                    if (isSelected(preset.width, preset.height)) {
                                                                        onChange({
                                                                            label: t('resolutions.portrait'),
                                                                            width: 832,
                                                                            height: 1216,
                                                                        })
                                                                    }
                                                                }}
                                                                className="cursor-pointer p-0.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </Tip>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>

                    <div className="flex h-9 min-w-0 items-center rounded-xl border border-input bg-transparent shadow-sm">
                        <Input
                            type="number"
                            inputMode="numeric"
                            value={widthInput}
                            onChange={event => setWidthInput(event.target.value)}
                            onBlur={commitDimensions}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                            disabled={disabled}
                            aria-label={t('resolutions.width')}
                            className={inputClassName}
                        />
                        <span className="shrink-0 text-muted-foreground">×</span>
                        <Input
                            type="number"
                            inputMode="numeric"
                            value={heightInput}
                            onChange={event => setHeightInput(event.target.value)}
                            onBlur={commitDimensions}
                            onKeyDown={event => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                            }}
                            disabled={disabled}
                            aria-label={t('resolutions.height')}
                            className={inputClassName}
                        />
                    </div>
                </div>
            </div>

            <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogContent onInteractOutside={event => event.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle>{t('resolutions.addCustom')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-2 py-3">
                        <Label htmlFor="resolution-preset-name">{t('resolutions.presetName')}</Label>
                        <Input
                            id="resolution-preset-name"
                            value={presetName}
                            onChange={event => setPresetName(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter') savePreset()
                            }}
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button onClick={savePreset} disabled={!presetName.trim()}>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
