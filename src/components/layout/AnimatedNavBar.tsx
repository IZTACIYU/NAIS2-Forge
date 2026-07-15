import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Tip } from '@/components/ui/tooltip'

export interface NavItem {
    path: string
    icon: LucideIcon
    labelKey: string
    leadingAction?: {
        icon: LucideIcon
        labelKey: string
        onClick: () => void
        disabled?: boolean
    }
}

interface AnimatedNavBarProps {
    items: NavItem[]
}

export function AnimatedNavBar({ items }: AnimatedNavBarProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const [isCompact, setIsCompact] = useState(window.innerWidth < 1382)

    useEffect(() => {
        let frameId: number | null = null
        const handleResize = () => {
            if (frameId !== null) return
            frameId = window.requestAnimationFrame(() => {
                frameId = null
                setIsCompact(window.innerWidth < 1382)
            })
        }
        window.addEventListener('resize', handleResize)
        return () => {
            window.removeEventListener('resize', handleResize)
            if (frameId !== null) window.cancelAnimationFrame(frameId)
        }
    }, [])

    return (
        <nav className="flex items-center gap-1 p-1">
            {items.map((item) => {
                const isActive = location.pathname === item.path
                const leadingAction = item.leadingAction
                return (
                    <div key={item.path} className="flex items-center gap-0.5">
                    {leadingAction && (
                        <Tip content={t(leadingAction.labelKey)} side="bottom">
                            <button
                                type="button"
                                onClick={leadingAction.onClick}
                                disabled={leadingAction.disabled}
                                className={cn(
                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors",
                                    "hover:bg-foreground/10 hover:text-foreground",
                                    leadingAction.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
                                )}
                                aria-label={t(leadingAction.labelKey)}
                            >
                                <leadingAction.icon className="h-4 w-4" />
                            </button>
                        </Tip>
                    )}
                    <NavLink
                        to={item.path}
                        title={isCompact ? t(item.labelKey) : undefined}
                        className={cn(
                            "relative rounded-full text-sm font-medium transition-colors z-0",
                            isCompact ? "p-2" : "px-4 py-2",
                            isActive
                                ? "text-foreground"
                                : "text-muted-foreground hover:text-foreground/80"
                        )}
                    >
                        {isActive && (
                            <motion.div
                                layoutId="activeTab"
                                className="absolute inset-0 bg-foreground/10 backdrop-blur-md rounded-full border border-foreground/10 shadow-sm -z-10"
                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                            />
                        )}
                        <span className="flex items-center gap-2 relative z-10">
                            <item.icon className="h-4 w-4" />
                            {!isCompact && <span>{t(item.labelKey)}</span>}
                        </span>
                    </NavLink>
                    </div>
                )
            })}
        </nav>
    )
}
