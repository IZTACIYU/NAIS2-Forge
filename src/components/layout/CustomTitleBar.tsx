import { useState, useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { PanelLeft, PanelRight, Minus, Square, X, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLayoutStore } from '@/stores/layout-store'
import { Tip } from '@/components/ui/tooltip'

const appWindow = getCurrentWindow()

export function CustomTitleBar({ navigation }: { navigation?: ReactNode }) {
    const { t } = useTranslation()
    const [isMaximized, setIsMaximized] = useState(false)
    const {
        leftSidebarVisible,
        rightSidebarVisible,
        toggleLeftSidebar,
        toggleRightSidebar
    } = useLayoutStore()

    useEffect(() => {
        let active = true
        let resizeTimer: number | null = null
        let moveTimer: number | null = null
        const root = document.documentElement

        void appWindow.isMaximized().then(value => {
            if (active) setIsMaximized(value)
        })

        const unlistenResize = appWindow.onResized(() => {
            root.classList.add('window-resizing')
            if (resizeTimer !== null) window.clearTimeout(resizeTimer)
            resizeTimer = window.setTimeout(() => {
                resizeTimer = null
                root.classList.remove('window-resizing')
                void appWindow.isMaximized().then(value => {
                    if (active) setIsMaximized(value)
                })
            }, 120)
        })
        const unlistenMove = appWindow.onMoved(() => {
            root.classList.add('window-moving')
            if (moveTimer !== null) window.clearTimeout(moveTimer)
            moveTimer = window.setTimeout(() => {
                moveTimer = null
                root.classList.remove('window-moving')
            }, 120)
        })

        return () => {
            active = false
            if (resizeTimer !== null) window.clearTimeout(resizeTimer)
            if (moveTimer !== null) window.clearTimeout(moveTimer)
            root.classList.remove('window-resizing', 'window-moving')
            void unlistenResize.then(fn => fn())
            void unlistenMove.then(fn => fn())
        }
    }, [])

    const handleMinimize = async () => {
        await appWindow.minimize()
    }

    const handleMaximize = async () => {
        await appWindow.toggleMaximize()
    }

    const handleClose = async () => {
        await appWindow.close()
    }

    const handleMouseDown = async (e: React.MouseEvent) => {
        // Only start dragging on single click, not double click
        if (e.button === 0 && e.detail === 1) {
            document.documentElement.classList.add('window-moving')
            try {
                await appWindow.startDragging()
            } finally {
                window.setTimeout(() => document.documentElement.classList.remove('window-moving'), 120)
            }
        }
    }

    const handleDoubleClick = async () => {
        await appWindow.toggleMaximize()
    }

    return (
        <div className="relative h-12 flex items-center justify-between bg-background select-none shrink-0 border-b border-border/40">
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="pointer-events-auto">{navigation}</div>
            </div>
            {/* Drag Region */}
            <div
                className="flex-1 h-full cursor-default"
                onMouseDown={handleMouseDown}
                onDoubleClick={handleDoubleClick}
            />

            {/* Controls */}
            <div className="relative z-20 flex h-full">
                {/* Left Sidebar Toggle */}
                <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')} side="bottom">
                    <button
                        onClick={toggleLeftSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !leftSidebarVisible && "text-muted-foreground/50"
                        )}
                        aria-label="Toggle Left Sidebar"
                    >
                        <PanelLeft className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Right Sidebar Toggle */}
                <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')} side="bottom">
                    <button
                        onClick={toggleRightSidebar}
                        className={cn(
                            "h-full w-10 flex items-center justify-center",
                            "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            "transition-colors",
                            !rightSidebarVisible && "text-muted-foreground/50"
                        )}
                        aria-label="Toggle Right Sidebar"
                    >
                        <PanelRight className="h-4 w-4" />
                    </button>
                </Tip>

                {/* Separator */}
                <div className="w-px h-4 my-auto bg-border/50 mx-1" />

                {/* Minimize */}
                <button
                    onClick={handleMinimize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    aria-label="Minimize"
                >
                    <Minus className="h-4 w-4" />
                </button>

                {/* Maximize/Restore */}
                <button
                    onClick={handleMaximize}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                        "transition-colors"
                    )}
                    aria-label={isMaximized ? "Restore" : "Maximize"}
                >
                    {isMaximized ? <Maximize2 className="h-4 w-4" /> : <Square className="h-3.5 w-3.5" />}
                </button>

                {/* Close */}
                <button
                    onClick={handleClose}
                    className={cn(
                        "h-full w-[46px] flex items-center justify-center",
                        "text-muted-foreground hover:text-white hover:bg-red-500",
                        "transition-colors"
                    )}
                    aria-label="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        </div>
    )
}
