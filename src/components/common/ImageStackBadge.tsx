import { Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ImageStackBadge({ count }: { count: number }) {
    const { t } = useTranslation()
    return <div className="pointer-events-none absolute top-2 right-2 z-30 px-2 py-1 bg-purple-500 text-white text-xs font-bold rounded-full flex items-center gap-1">
        <Layers className="h-3 w-3" />{t('library.stackCount', { count })}
    </div>
}
