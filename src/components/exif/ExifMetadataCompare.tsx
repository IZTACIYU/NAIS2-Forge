import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { PngTextMetadata } from '@/lib/png-metadata-editor'

type ComparisonSide = 'left' | 'right'

export interface CompareImage {
    name: string
    preview: string
    metadata: PngTextMetadata
}

interface ComparisonRow {
    key: string
    left?: string
    right?: string
    status: 'same' | 'changed' | 'leftOnly' | 'rightOnly'
}

interface ExifMetadataCompareProps {
    left: CompareImage | null
    right: CompareImage | null
    onChoose: (side: ComparisonSide) => void
    onClear: (side: ComparisonSide) => void
    onDrop: (side: ComparisonSide, file: File) => void
}

const toDisplayValue = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value)

const flattenValue = (target: Map<string, string>, prefix: string, value: unknown) => {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => flattenValue(target, `${prefix}[${index}]`, entry))
        if (value.length === 0) target.set(prefix, '[]')
        return
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
        if (entries.length === 0) target.set(prefix, '{}')
        entries.forEach(([key, entry]) => flattenValue(target, prefix ? `${prefix}.${key}` : key, entry))
        return
    }
    target.set(prefix, toDisplayValue(value))
}

const flattenMetadata = (metadata: PngTextMetadata) => {
    const values = new Map<string, string>()
    for (const [key, value] of Object.entries(metadata)) {
        if (key !== 'Comment') {
            values.set(key, value)
            continue
        }
        try {
            flattenValue(values, 'Comment', JSON.parse(value))
        } catch {
            values.set('Comment', value)
        }
    }
    return values
}

const buildRows = (left: PngTextMetadata, right: PngTextMetadata): ComparisonRow[] => {
    const leftValues = flattenMetadata(left)
    const rightValues = flattenMetadata(right)
    const keys = [...new Set([...leftValues.keys(), ...rightValues.keys()])].sort((a, b) => a.localeCompare(b))
    return keys.map(key => {
        const leftValue = leftValues.get(key)
        const rightValue = rightValues.get(key)
        const status = leftValue === undefined
            ? 'rightOnly'
            : rightValue === undefined
                ? 'leftOnly'
                : leftValue === rightValue
                    ? 'same'
                    : 'changed'
        return { key, left: leftValue, right: rightValue, status }
    })
}

const valueClass = (status: ComparisonRow['status']) => {
    if (status === 'changed') return 'text-amber-300'
    if (status === 'leftOnly' || status === 'rightOnly') return 'text-rose-300'
    return 'text-muted-foreground'
}

export function ExifMetadataCompare({ left, right, onChoose, onClear, onDrop }: ExifMetadataCompareProps) {
    const { t } = useTranslation()
    const [view, setView] = useState<'changes' | 'all'>('changes')
    const rows = useMemo(() => left && right ? buildRows(left.metadata, right.metadata) : [], [left, right])
    const changes = rows.filter(row => row.status !== 'same')
    const displayRows = view === 'changes' ? changes : rows

    const imagePanel = (side: ComparisonSide, image: CompareImage | null) => (
        <div
            className="min-h-0 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col"
            onDragOver={event => event.preventDefault()}
            onDrop={event => {
                event.preventDefault()
                event.stopPropagation()
                const file = event.dataTransfer.files?.[0]
                if (file) onDrop(side, file)
            }}
        >
            <div className="px-3 py-2 text-xs font-medium border-b border-border/50 flex items-center justify-between gap-2">
                <span>{t(side === 'left' ? 'exif.compare.firstImage' : 'exif.compare.secondImage')}</span>
                {image && <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onClear(side)}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center p-3 relative">
                {image ? <img src={image.preview} alt="" className="max-w-full max-h-full object-contain" /> : (
                    <button type="button" onClick={() => onChoose(side)} className="w-full h-full flex flex-col items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                        <ImagePlus className="h-9 w-9 mb-3 opacity-50" />
                        <span className="text-sm">{t('exif.compare.drop')}</span>
                    </button>
                )}
            </div>
            {image && <div className="border-t border-border/50 px-3 py-2 text-xs truncate text-muted-foreground">{image.name}</div>}
        </div>
    )

    return (
        <div className="mt-4 flex flex-1 min-h-0 flex-col gap-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-[260px] flex-[0_0_38%]">
                {imagePanel('left', left)}
                {imagePanel('right', right)}
            </div>
            <div className="min-h-0 flex-1 border border-border/50 rounded-lg bg-muted/15 overflow-hidden flex flex-col">
                <div className="px-3 py-2 border-b border-border/50 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium">{t('exif.compare.result')}</span>
                    {left && right && <span className="text-xs text-muted-foreground">{t('exif.compare.summary', { changes: changes.length, total: rows.length })}</span>}
                </div>
                {!left || !right ? <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">{t('exif.compare.selectBoth')}</div> : (
                    <Tabs value={view} onValueChange={value => setView(value as 'changes' | 'all')} className="flex min-h-0 flex-1 flex-col">
                        <div className="px-3 pt-3"><TabsList className="h-8"><TabsTrigger value="changes" className="px-2.5 py-1 text-xs">{t('exif.compare.changes')}</TabsTrigger><TabsTrigger value="all" className="px-2.5 py-1 text-xs">{t('exif.compare.all')}</TabsTrigger></TabsList></div>
                        <TabsContent value="changes" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3">
                            {displayRows.length === 0 ? <p className="py-8 text-center text-sm text-emerald-400">{t('exif.compare.identical')}</p> : <ComparisonTable rows={displayRows} leftName={left.name} rightName={right.name} />}
                        </TabsContent>
                        <TabsContent value="all" className="mt-0 min-h-0 flex-1 overflow-y-auto p-3"><ComparisonTable rows={displayRows} leftName={left.name} rightName={right.name} /></TabsContent>
                    </Tabs>
                )}
            </div>
        </div>
    )
}

function ComparisonTable({ rows, leftName, rightName }: { rows: ComparisonRow[]; leftName: string; rightName: string }) {
    const { t } = useTranslation()
    return <div className="grid gap-2">
        <div className="hidden gap-2 px-2 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(140px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)]"><span>{t('exif.compare.field')}</span><span className="truncate">{leftName}</span><span className="truncate">{rightName}</span></div>
        {rows.map(row => <div key={row.key} className="grid gap-2 rounded-md border border-border/40 bg-background/20 p-2 md:grid-cols-[minmax(140px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="break-all text-xs font-medium">{row.key}</span>
            <span className={`whitespace-pre-wrap break-words text-xs ${valueClass(row.status)}`}>{row.left ?? '-'}</span>
            <span className={`whitespace-pre-wrap break-words text-xs ${valueClass(row.status)}`}>{row.right ?? '-'}</span>
        </div>)}
    </div>
}
