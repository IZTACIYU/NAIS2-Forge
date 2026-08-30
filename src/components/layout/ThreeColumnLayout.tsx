import { lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { PromptPanel } from './PromptPanel'
import { HistoryPanel } from './HistoryPanel'
import { AnimatedNavBar } from './AnimatedNavBar'
import { CustomTitleBar } from './CustomTitleBar'
import { PresetDropdown } from '@/components/preset/PresetDropdown'
import { FragmentPromptDialog } from '@/components/fragments/FragmentPromptDialog'
import { useAuthStore } from '@/stores/auth-store'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import GlassSurface from '@/components/ui/GlassSurface'
import { Tip } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { getAuthTokenLabel, normalizeAuthTokenList } from '@/lib/auth-token-list'
import { getUserInfo } from '@/services/novelai-api'
import { toast } from '@/components/ui/use-toast'
import {
    Home,
    Film,
    Globe,
    Images,
    Cloud,
    Settings,
    Coins,
    Wand2,
    Eraser,
    PanelLeft,
    PanelRight,
    Dices,
    Check,
    Loader2,
    UserRound,
} from 'lucide-react'

interface ThreeColumnLayoutProps {
    children: ReactNode
}

type AccountSummary = { anlas: number; v5Usage: number | null } | null

import { usePresetStore } from '@/stores/preset-store'
import { useLayoutStore } from '@/stores/layout-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGenerationStore } from '@/stores/generation-store'

// Check if running on Mac (works in browser and Tauri WebView)
const isMac = navigator.platform.toUpperCase().includes('MAC') ||
    navigator.userAgent.toUpperCase().includes('MAC')

const SceneRandomCharacterDialog = lazy(() => import('@/components/scene/SceneRandomCharacterDialog').then(module => ({
    default: module.SceneRandomCharacterDialog,
})))

export function ThreeColumnLayout({ children }: ThreeColumnLayoutProps) {
    const { t } = useTranslation()
    const location = useLocation()
    const { token, tokens, anlas, imageGenerationUsage, isVerified, isLoading, verifyAndSave, refreshAnlas } = useAuthStore(useShallow(state => ({
        token: state.token,
        tokens: state.tokens,
        anlas: state.anlas,
        imageGenerationUsage: state.imageGenerationUsage,
        isVerified: state.isVerified,
        isLoading: state.isLoading,
        verifyAndSave: state.verifyAndSave,
        refreshAnlas: state.refreshAnlas,
    })))
    const model = useGenerationStore(state => state.model)
    const { leftSidebarVisible, rightSidebarVisible, toggleLeftSidebar, toggleRightSidebar, leftSidebarWidth, rightSidebarWidth, setLeftSidebarWidth, setRightSidebarWidth } = useLayoutStore(useShallow(state => ({
        leftSidebarVisible: state.leftSidebarVisible,
        rightSidebarVisible: state.rightSidebarVisible,
        toggleLeftSidebar: state.toggleLeftSidebar,
        toggleRightSidebar: state.toggleRightSidebar,
        leftSidebarWidth: state.leftSidebarWidth,
        rightSidebarWidth: state.rightSidebarWidth,
        setLeftSidebarWidth: state.setLeftSidebarWidth,
        setRightSidebarWidth: state.setRightSidebarWidth,
    })))
    const leftWidthRef = useRef(leftSidebarWidth)
    const rightWidthRef = useRef(rightSidebarWidth)
    const leftPanelRef = useRef<HTMLElement>(null)
    const rightPanelRef = useRef<HTMLElement>(null)
    const resizeCleanupRef = useRef<(() => void) | null>(null)
    const expertCloudR2Enabled = useSettingsStore(state => state.expertCloudR2Enabled)
    const expertExifManagerEnabled = useSettingsStore(state => state.expertExifManagerEnabled)
    const expertSceneRandomCharactersEnabled = useSettingsStore(state => state.expertSceneRandomCharactersEnabled)
    const sceneRandomCharactersActive = useSettingsStore(state => state.sceneRandomCharactersActive)
    const sceneRandomCharacterCount = useSettingsStore(state => state.sceneRandomCharacterCount)

    // Get active preset for header display
    const { presets, activePresetId } = usePresetStore(useShallow(state => ({
        presets: state.presets,
        activePresetId: state.activePresetId,
    })))
    const activePreset = presets.find(p => p.id === activePresetId)

    // Preset dialog state (for shortcut support)
    const [presetDialogOpen, setPresetDialogOpen] = useState(false)
    const [fragmentPanelOpen, setFragmentPanelOpen] = useState(false)
    const [randomCharacterDialogOpen, setRandomCharacterDialogOpen] = useState(false)
    const [accountMenuOpen, setAccountMenuOpen] = useState(false)
    const [accountSummaries, setAccountSummaries] = useState<Record<string, AccountSummary>>({})
    const fragmentPanelPathRef = useRef<string | null>(null)

    useEffect(() => {
        if (!fragmentPanelOpen || fragmentPanelPathRef.current === location.pathname) return
        fragmentPanelPathRef.current = null
        setFragmentPanelOpen(false)
    }, [fragmentPanelOpen, location.pathname])

    useEffect(() => {
        leftWidthRef.current = leftSidebarWidth
        rightWidthRef.current = rightSidebarWidth
    }, [leftSidebarWidth, rightSidebarWidth])

    useEffect(() => () => resizeCleanupRef.current?.(), [])

    const startPanelResize = (side: 'left' | 'right', event: React.MouseEvent) => {
        event.preventDefault()
        resizeCleanupRef.current?.()
        const panel = side === 'left' ? leftPanelRef.current : rightPanelRef.current
        if (!panel) return
        const startX = event.clientX
        const startWidth = panel.getBoundingClientRect().width
        let pendingWidth = startWidth
        let frameId: number | null = null
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        document.documentElement.classList.add('panel-resizing')

        const applyPendingWidth = () => {
            frameId = null
            panel.style.width = `${pendingWidth}px`
        }

        const onMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX
            if (side === 'left') {
                pendingWidth = Math.min(680, Math.max(340, startWidth + delta))
                leftWidthRef.current = pendingWidth
            } else {
                pendingWidth = Math.min(480, Math.max(220, startWidth - delta))
                rightWidthRef.current = pendingWidth
            }
            if (frameId === null) frameId = window.requestAnimationFrame(applyPendingWidth)
        }

        const cleanup = () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId)
                applyPendingWidth()
            }
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            document.documentElement.classList.remove('panel-resizing')
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            resizeCleanupRef.current = null
        }
        const onUp = () => {
            cleanup()
            if (side === 'left') setLeftSidebarWidth(pendingWidth)
            else setRightSidebarWidth(pendingWidth)
        }
        resizeCleanupRef.current = cleanup
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
    }

    // 프리셋 다이얼로그 단축키 이벤트 수신
    useEffect(() => {
        const handleOpenPreset = () => setPresetDialogOpen(prev => !prev)
        const handleOpenFragment = () => {
            setFragmentPanelOpen(prev => {
                const next = !prev
                fragmentPanelPathRef.current = next ? location.pathname : null
                return next
            })
        }

        window.addEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
        window.addEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
        return () => {
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_PRESET_DIALOG, handleOpenPreset)
            window.removeEventListener(SHORTCUT_EVENTS.OPEN_FRAGMENT_DIALOG, handleOpenFragment)
        }
    }, [location.pathname])

    // Refresh Anlas on mount if verified
    useEffect(() => {
        if (isVerified) {
            refreshAnlas()
        }
    }, [isVerified, refreshAnlas])

    useEffect(() => {
        if (!accountMenuOpen) return
        let cancelled = false
        const accountTokens = normalizeAuthTokenList(token, tokens)
        setAccountSummaries({})
        void Promise.all(accountTokens.map(async accountToken => {
            const info = await getUserInfo(accountToken)
            return [accountToken, info ? {
                anlas: info.anlas.total,
                v5Usage: info.imageGenerationUsage
                    ? Math.max(0, Math.min(100, info.imageGenerationUsage.percent))
                    : null,
            } : null] as const
        })).then(entries => {
            if (!cancelled) setAccountSummaries(Object.fromEntries(entries))
        })
        return () => { cancelled = true }
    }, [accountMenuOpen, token, tokens])

    const handleAccountSelect = async (accountToken: string) => {
        if (accountToken === token) return
        const success = await verifyAndSave(accountToken, normalizeAuthTokenList(token, tokens))
        if (!success) toast({ title: t('layout.accountSwitchFailed'), variant: 'destructive' })
    }

    const navItems = [
        { path: '/', icon: Home, labelKey: 'nav.main' },
        { path: '/scenes', icon: Film, labelKey: 'nav.scenes' },
        { path: '/tools', icon: Wand2, labelKey: 'smartTools.title' },
        ...(expertExifManagerEnabled ? [{ path: '/exif', icon: Eraser, labelKey: 'nav.exifManager' }] : []),
        { path: '/web', icon: Globe, labelKey: 'nav.web' },
        { path: '/library', icon: Images, labelKey: 'nav.library' },
        ...(expertCloudR2Enabled ? [{ path: '/cloud-r2', icon: Cloud, labelKey: 'nav.cloudR2' }] : []),
        { path: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ]

    // Format Anlas number
    const formatAnlas = (value: number) => {
        return value.toLocaleString()
    }
    const isV5Model = model === 'nai-diffusion-5-full' || model === 'nai-diffusion-5-curated'
    const v5UsagePercent = Math.max(0, Math.min(100, imageGenerationUsage?.percent ?? 0))
    const accountTokens = normalizeAuthTokenList(token, tokens)
    const accountMenu = (
        <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    aria-label={t('layout.account')}
                >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRound className="h-4 w-4" />}
                    <span>{t('layout.account')}</span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-60">
                {accountTokens.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">{t('layout.noAccounts')}</div>
                ) : accountTokens.map(accountToken => {
                    const summary = accountSummaries[accountToken]
                    return (
                        <DropdownMenuItem
                            key={accountToken}
                            disabled={isLoading}
                            onSelect={() => { void handleAccountSelect(accountToken) }}
                            className="gap-3 px-3 py-2.5"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{getAuthTokenLabel(accountToken)}</div>
                                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                                    <span>Anlas {summary === undefined ? '…' : summary ? summary.anlas.toLocaleString() : '-'}</span>
                                    <span>{t('layout.v5Quota')} {summary === undefined ? '…' : summary?.v5Usage == null ? '-' : `${Math.round(summary.v5Usage)}%`}</span>
                                </div>
                            </div>
                            {accountToken === token && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )

    return (
        <div className="flex flex-col h-screen bg-background overflow-hidden">
            {/* Custom Title Bar - Only show on Windows (Mac uses native decorations) */}
            {!isMac && <CustomTitleBar leading={accountMenu} navigation={<AnimatedNavBar items={navItems} />} />}

            {/* Main Layout */}
            <div className="flex flex-1 p-3 gap-3 overflow-hidden">
                {/* Left Panel - Prompt Input (Fixed, Rounded Box) */}
                <aside ref={leftPanelRef} className={cn(
                    "layout-surface relative min-w-0 flex-shrink-0 flex flex-col bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg",
                    !leftSidebarVisible && "hidden"
                )} style={{ width: leftSidebarWidth }}>
                    {/* Header - Preset Title & Anlas Display */}
                    <div className="h-14 min-w-0 flex items-center justify-between gap-2 px-4">
                        {/* Preset Title + Dialog Trigger */}
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                            <PresetDropdown open={presetDialogOpen} onOpenChange={setPresetDialogOpen} />
                            <h2 className="min-w-0 flex-1 truncate text-base font-semibold max-w-[180px]">
                                {activePreset?.name || t('preset.default', '기본')}
                            </h2>
                        </div>

                        {/* Anlas Display */}
                        {expertSceneRandomCharactersEnabled && (
                            <Tip content={t('sceneRandomCharacters.buttonTooltip')}>
                                <button
                                    type="button"
                                    onClick={() => setRandomCharacterDialogOpen(true)}
                                    className={cn(
                                        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                                        sceneRandomCharactersActive
                                            ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-500"
                                            : "border-border/50 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                                    )}
                                >
                                    <Dices className="h-4 w-4" />
                                    {sceneRandomCharactersActive && (
                                        <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-cyan-500 px-1 text-[10px] font-bold leading-4 text-black">
                                            {sceneRandomCharacterCount}
                                        </span>
                                    )}
                                </button>
                            </Tip>
                        )}
                        {isVerified && anlas ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                                {isV5Model && imageGenerationUsage && (
                                    <Tip content={t('layout.v5Usage', 'Limit {{percent}}%', { percent: v5UsagePercent })}>
                                        <div className="flex h-8 w-24 flex-col justify-center rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 text-cyan-400">
                                            <div className="text-[10px] font-semibold leading-3">{v5UsagePercent}%</div>
                                            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-cyan-950/60">
                                                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${v5UsagePercent}%` }} />
                                            </div>
                                        </div>
                                    </Tip>
                                )}
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-yellow-500/20 rounded-full border border-amber-500/30">
                                    <Coins className="h-4 w-4 text-amber-500" />
                                    <span className="text-sm font-semibold text-amber-500">
                                        {formatAnlas(anlas.total)}
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-w-0 shrink items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-full">
                                <Coins className="h-4 w-4 text-muted-foreground" />
                                <span className="min-w-0 truncate text-sm text-muted-foreground">
                                    {t('settingsPage.api.token')}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Prompt Panel */}
                    <PromptPanel />
                    <div className="absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize transition-colors hover:bg-primary/30" onMouseDown={(event) => startPanelResize('left', event)} />
                </aside>

                {/* Center Panel - Page Content (Rounded Box) */}
                <div className="layout-surface flex-1 flex flex-col min-w-0 bg-card/30 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg">
                    {/* Tab Navigation (Glass Surface) */}
                    {isMac && <div className="shrink-0 flex items-center justify-center py-2 z-10 gap-2">
                        {accountMenu}
                        {/* Mac: Left sidebar toggle */}
                        {isMac && (
                            <Tip content={t('layout.toggleLeftSidebar', 'Toggle Left Sidebar')}>
                                <button
                                    onClick={toggleLeftSidebar}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !leftSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelLeft className="h-4 w-4" />
                                </button>
                            </Tip>
                        )}
                        <GlassSurface
                            width="fit-content"
                            height={52}
                            borderRadius={30}
                            opacity={0.6}
                            blur={15}
                            borderWidth={0.5}
                            className="flex items-center px-2"
                        >
                            <AnimatedNavBar items={navItems} />
                        </GlassSurface>
                        {/* Mac: Right sidebar toggle */}
                        {isMac && (
                            <Tip content={t('layout.toggleRightSidebar', 'Toggle Right Sidebar')}>
                                <button
                                    onClick={toggleRightSidebar}
                                    className={cn(
                                        "p-1.5 rounded-full transition-colors",
                                        "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                                        !rightSidebarVisible && "opacity-50"
                                    )}
                                >
                                    <PanelRight className="h-4 w-4" />
                                </button>
                            </Tip>
                        )}
                    </div>}

                    {/* Page Content */}
                    <main data-character-position-host className={cn(
                        "flex-1 relative",
                        (location.pathname === '/' || location.pathname === '/library' || location.pathname === '/web') ? "p-0 overflow-hidden" : "p-4 overflow-y-auto"
                    )}>
                        {children}
                        {fragmentPanelOpen && (
                            <div data-native-webview-overlay="true" className="absolute inset-0 z-40 bg-card/95 backdrop-blur-sm">
                                <FragmentPromptDialog
                                    open={fragmentPanelOpen}
                                    onOpenChange={(open) => {
                                        fragmentPanelPathRef.current = open ? location.pathname : null
                                        setFragmentPanelOpen(open)
                                    }}
                                    embedded
                                />
                            </div>
                        )}
                    </main>
                </div>

                {/* Right Panel - History Only (Rounded Box) */}
                <aside ref={rightPanelRef} className={cn(
                    "layout-surface relative flex-shrink-0 bg-card/50 backdrop-blur-sm rounded-2xl border border-border/50 overflow-hidden shadow-lg",
                    !rightSidebarVisible && "hidden"
                )} style={{ width: rightSidebarWidth }}>
                    <div className="absolute inset-y-0 left-0 z-30 w-1.5 cursor-col-resize transition-colors hover:bg-primary/30" onMouseDown={(event) => startPanelResize('right', event)} />
                    <HistoryPanel />
                </aside>
            </div>
            {randomCharacterDialogOpen && (
                <Suspense fallback={null}>
                    <SceneRandomCharacterDialog
                        open
                        onOpenChange={setRandomCharacterDialogOpen}
                    />
                </Suspense>
            )}
        </div>
    )
}
