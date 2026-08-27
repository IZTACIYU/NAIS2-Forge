import { useState, useRef, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { SHORTCUT_EVENTS } from '@/hooks/useShortcuts'
import {
    Globe,
    Home,
    ExternalLink,
    X,
    RefreshCw,
    Plus,
    Edit,
    ZoomIn,
    ZoomOut,
    Settings2,
    Copy,
} from 'lucide-react'

interface QuickLink {
    name: string
    url: string
}

// Default quick links (safebooru removed)
const DEFAULT_QUICK_LINKS: QuickLink[] = [
    { name: 'Danbooru', url: 'https://hijiribe.donmai.us' },
    { name: 'novelai.app', url: 'https://novelai.app/' },
    { name: 'Google Translate', url: 'https://translate.google.co.kr/?sl=ko&tl=en&op=translate' },
]

const STORE_KEY = 'webview_quick_links'
const DANBOORU_TAG_CATEGORIES_KEY = 'danbooru_tag_categories'

type DanbooruTagCategory = 'artist' | 'copyright' | 'characters' | 'general' | 'meta'
type DanbooruTagCategories = Record<DanbooruTagCategory, boolean>

const DEFAULT_DANBOORU_TAG_CATEGORIES: DanbooruTagCategories = {
    artist: true,
    copyright: true,
    characters: true,
    general: true,
    meta: true,
}

const DANBOORU_TAG_CATEGORY_OPTIONS: { key: DanbooruTagCategory; label: string }[] = [
    { key: 'artist', label: 'web.artist' },
    { key: 'copyright', label: 'web.copyright' },
    { key: 'characters', label: 'web.characters' },
    { key: 'general', label: 'web.general' },
    { key: 'meta', label: 'web.meta' },
]

function readDanbooruTagCategories(value: unknown): DanbooruTagCategories {
    if (!value || typeof value !== 'object') return DEFAULT_DANBOORU_TAG_CATEGORIES
    const saved = value as Partial<DanbooruTagCategories>
    return Object.fromEntries(
        Object.entries(DEFAULT_DANBOORU_TAG_CATEGORIES).map(([key, defaultValue]) => [
            key,
            typeof saved[key as DanbooruTagCategory] === 'boolean'
                ? saved[key as DanbooruTagCategory]
                : defaultValue,
        ])
    ) as DanbooruTagCategories
}

export default function WebView() {
    const { t } = useTranslation()
    const [url, setUrl] = useState('https://hijiribe.donmai.us')
    const [inputUrl, setInputUrl] = useState(url)
    const [isLoading, setIsLoading] = useState(false)
    const [isBrowserOpen, setIsBrowserOpen] = useState(false)
    const [quickLinks, setQuickLinks] = useState<QuickLink[]>(DEFAULT_QUICK_LINKS)
    const [isEditMode, setIsEditMode] = useState(false)
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [isDanbooruSettingsOpen, setIsDanbooruSettingsOpen] = useState(false)
    const [newLinkName, setNewLinkName] = useState('')
    const [newLinkUrl, setNewLinkUrl] = useState('')
    const [danbooruTagCategories, setDanbooruTagCategories] = useState<DanbooruTagCategories>(DEFAULT_DANBOORU_TAG_CATEGORIES)
    const [draftDanbooruTagCategories, setDraftDanbooruTagCategories] = useState<DanbooruTagCategories>(DEFAULT_DANBOORU_TAG_CATEGORIES)
    const [isDanbooruPage, setIsDanbooruPage] = useState(false)
    const browserAreaRef = useRef<HTMLDivElement>(null)
    const resizeFrameRef = useRef<number | null>(null)
    const resizeInFlightRef = useRef(false)
    const resizePendingRef = useRef(false)
    const lastResizeKeyRef = useRef('')
    const storeRef = useRef<Store | null>(null)
    const hiddenForOverlayRef = useRef(false)
    const [zoomLevel, setZoomLevel] = useState(1.0)

    // Zoom function for buttons
    const handleZoom = useCallback(async (delta: number) => {
        if (!isBrowserOpen) return
        const newZoom = Math.max(0.25, Math.min(3.0, zoomLevel + delta))
        setZoomLevel(newZoom)
        try {
            await invoke('zoom_embedded_browser', { zoomLevel: newZoom })
        } catch (error) {
            console.error('Zoom failed:', error)
        }
    }, [isBrowserOpen, zoomLevel])

    const handleZoomReset = useCallback(async () => {
        setZoomLevel(1.0)
        try {
            await invoke('zoom_embedded_browser', { zoomLevel: 1.0 })
        } catch (error) {
            console.error('Zoom reset failed:', error)
        }
    }, [])

    // Initialize store and load quick links
    useEffect(() => {
        const initStore = async () => {
            try {
                storeRef.current = await Store.load('webview-settings.json')
                const savedLinks = await storeRef.current.get<QuickLink[]>(STORE_KEY)
                if (savedLinks && savedLinks.length > 0) {
                    setQuickLinks(savedLinks)
                }
                setDanbooruTagCategories(readDanbooruTagCategories(
                    await storeRef.current.get(DANBOORU_TAG_CATEGORIES_KEY)
                ))
            } catch (error) {
                console.error('Failed to load quick links:', error)
            }
        }
        initStore()
    }, [])

    // Save quick links when changed
    const saveQuickLinks = useCallback(async (links: QuickLink[]) => {
        try {
            if (storeRef.current) {
                await storeRef.current.set(STORE_KEY, links)
                await storeRef.current.save()
            }
        } catch (error) {
            console.error('Failed to save quick links:', error)
        }
    }, [])

    const saveDanbooruTagCategories = useCallback(async () => {
        try {
            if (!storeRef.current) return
            await storeRef.current.set(DANBOORU_TAG_CATEGORIES_KEY, draftDanbooruTagCategories)
            await storeRef.current.save()
            setDanbooruTagCategories(draftDanbooruTagCategories)
            setIsDanbooruSettingsOpen(false)
        } catch (error) {
            console.error('Failed to save Danbooru tag settings:', error)
        }
    }, [draftDanbooruTagCategories])

    const addQuickLink = () => {
        if (!newLinkName.trim() || !newLinkUrl.trim()) return

        let urlToAdd = newLinkUrl.trim()
        if (!urlToAdd.startsWith('http://') && !urlToAdd.startsWith('https://')) {
            urlToAdd = 'https://' + urlToAdd
        }

        const newLinks = [...quickLinks, { name: newLinkName.trim(), url: urlToAdd }]
        setQuickLinks(newLinks)
        saveQuickLinks(newLinks)

        setNewLinkName('')
        setNewLinkUrl('')
        setIsAddDialogOpen(false)
    }

    const removeQuickLink = (index: number) => {
        const newLinks = quickLinks.filter((_, i) => i !== index)
        setQuickLinks(newLinks)
        saveQuickLinks(newLinks)
    }

    // Serialize native resize IPC so continuous layout changes cannot build a backlog.
    const updateWebViewSize = useCallback(() => {
        if (!isBrowserOpen || !browserAreaRef.current) return
        resizePendingRef.current = true
        if (resizeFrameRef.current !== null || resizeInFlightRef.current) return

        resizeFrameRef.current = requestAnimationFrame(async () => {
            resizeFrameRef.current = null
            if (!resizePendingRef.current) return
            resizePendingRef.current = false
            const rect = browserAreaRef.current?.getBoundingClientRect()
            if (!rect) return
            const resizeKey = [rect.left, rect.top, rect.width, rect.height]
                .map(value => Math.round(value))
                .join(':')
            if (resizeKey === lastResizeKeyRef.current) return
            lastResizeKeyRef.current = resizeKey
            resizeInFlightRef.current = true

            try {
                await invoke('resize_embedded_browser', {
                    x: rect.left,
                    y: rect.top,
                    width: rect.width,
                    height: rect.height
                })
            } catch (error) {
                // Ignore resize errors
            } finally {
                resizeInFlightRef.current = false
                if (resizePendingRef.current) updateWebViewSize()
            }
        })
    }, [isBrowserOpen])

    const syncBrowserOverlayVisibility = useCallback(() => {
        if (!isBrowserOpen) return
        const hasOverlay = Boolean(document.querySelector(
            '[data-native-webview-overlay="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
        ))
        if (hasOverlay === hiddenForOverlayRef.current) return
        hiddenForOverlayRef.current = hasOverlay
        if (hasOverlay) {
            invoke('hide_embedded_browser').catch(() => { })
        } else {
            invoke('show_embedded_browser').then(updateWebViewSize).catch(() => { })
        }
    }, [isBrowserOpen, updateWebViewSize])

    // Native webviews render above DOM content, so hide them while app dialogs
    // or explicitly marked in-app overlays are open.
    useEffect(() => {
        if (!isBrowserOpen) {
            hiddenForOverlayRef.current = false
            return
        }
        let frameId: number | null = null
        const scheduleSync = () => {
            if (frameId !== null) return
            frameId = requestAnimationFrame(() => {
                frameId = null
                syncBrowserOverlayVisibility()
            })
        }
        const observer = new MutationObserver(scheduleSync)
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-state', 'data-native-webview-overlay'],
        })
        scheduleSync()
        return () => {
            observer.disconnect()
            if (frameId !== null) cancelAnimationFrame(frameId)
        }
    }, [isBrowserOpen, syncBrowserOverlayVisibility])

    // Check if browser exists and restore on mount
    useEffect(() => {
        const checkAndRestoreBrowser = async () => {
            try {
                const isOpen = await invoke<boolean>('is_browser_open')
                if (isOpen) {
                    await invoke('show_embedded_browser')
                    setIsBrowserOpen(true)
                    setTimeout(() => {
                        if (browserAreaRef.current) {
                            const rect = browserAreaRef.current.getBoundingClientRect()
                            invoke('resize_embedded_browser', {
                                x: rect.left,
                                y: rect.top,
                                width: rect.width,
                                height: rect.height
                            })
                        }
                    }, 50)
                }
            } catch (error) {
                console.error('Failed to check browser state:', error)
            }
        }
        checkAndRestoreBrowser()
    }, [])

    // Listen to resize events
    useEffect(() => {
        if (!isBrowserOpen) return

        window.addEventListener('resize', updateWebViewSize)

        const resizeObserver = new ResizeObserver(updateWebViewSize)
        if (browserAreaRef.current) {
            resizeObserver.observe(browserAreaRef.current)
        }

        return () => {
            window.removeEventListener('resize', updateWebViewSize)
            resizeObserver.disconnect()
            resizePendingRef.current = false
            if (resizeFrameRef.current !== null) {
                cancelAnimationFrame(resizeFrameRef.current)
                resizeFrameRef.current = null
            }
        }
    }, [isBrowserOpen, updateWebViewSize])

    // Hide browser when visibility changes
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden && isBrowserOpen) {
                invoke('hide_embedded_browser').catch(() => { })
            } else if (!document.hidden && isBrowserOpen) {
                invoke('show_embedded_browser').catch(() => { })
                updateWebViewSize()
            }
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [isBrowserOpen, updateWebViewSize])

    // Hide browser when leaving the page
    useEffect(() => {
        return () => {
            invoke('hide_embedded_browser').catch(() => { })
        }
    }, [])

    const openBrowserWindow = useCallback(async (targetUrl: string) => {
        setIsLoading(true)
        try {
            const browserArea = browserAreaRef.current
            if (!browserArea) return

            const rect = browserArea.getBoundingClientRect()

            lastResizeKeyRef.current = [rect.left, rect.top, rect.width, rect.height]
                .map(value => Math.round(value))
                .join(':')

            await invoke('open_embedded_browser', {
                url: targetUrl,
                x: rect.left,
                y: rect.top,
                width: rect.width,
                height: rect.height
            })
            setIsBrowserOpen(true)
        } catch (error) {
            console.error('Failed to open browser:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    const closeBrowser = async () => {
        try {
            await invoke('close_embedded_browser')
            setIsBrowserOpen(false)
            setIsDanbooruPage(false)
        } catch (error) {
            console.error('Failed to close browser:', error)
        }
    }

    const refreshDanbooruPage = useCallback(async () => {
        if (!isBrowserOpen) {
            setIsDanbooruPage(false)
            return
        }
        try {
            setIsDanbooruPage(await invoke<boolean>('is_danbooru_browser_page'))
        } catch {
            setIsDanbooruPage(false)
        }
    }, [isBrowserOpen])

    useEffect(() => {
        if (!isBrowserOpen) {
            setIsDanbooruPage(false)
            return
        }
        void refreshDanbooruPage()
        const intervalId = window.setInterval(() => void refreshDanbooruPage(), 1000)
        return () => window.clearInterval(intervalId)
    }, [isBrowserOpen, refreshDanbooruPage])

    const copyDanbooruTags = useCallback(async () => {
        if (!isDanbooruPage) return
        try {
            await invoke('copy_danbooru_tags', { categories: danbooruTagCategories })
        } catch (error) {
            console.error('Failed to copy Danbooru tags:', error)
            void refreshDanbooruPage()
        }
    }, [danbooruTagCategories, isDanbooruPage, refreshDanbooruPage])

    useEffect(() => {
        const handleCopyDanbooruTags = () => void copyDanbooruTags()
        window.addEventListener(SHORTCUT_EVENTS.COPY_DANBOORU_TAGS, handleCopyDanbooruTags)
        return () => window.removeEventListener(SHORTCUT_EVENTS.COPY_DANBOORU_TAGS, handleCopyDanbooruTags)
    }, [copyDanbooruTags])

    const handleNavigate = async (e: React.FormEvent) => {
        e.preventDefault()
        let newUrl = inputUrl
        if (!newUrl.startsWith('http://') && !newUrl.startsWith('https://')) {
            newUrl = 'https://' + newUrl
        }
        setUrl(newUrl)

        if (isBrowserOpen) {
            try {
                await invoke('navigate_embedded_browser', { url: newUrl })
            } catch (error) {
                await openBrowserWindow(newUrl)
            }
        } else {
            await openBrowserWindow(newUrl)
        }
    }

    const handleQuickLink = async (linkUrl: string) => {
        if (isEditMode) return

        setUrl(linkUrl)
        setInputUrl(linkUrl)

        if (isBrowserOpen) {
            try {
                await invoke('navigate_embedded_browser', { url: linkUrl })
            } catch (error) {
                await openBrowserWindow(linkUrl)
            }
        } else {
            await openBrowserWindow(linkUrl)
        }
    }

    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            {/* Browser Controls */}
            <div className="shrink-0 border-b border-border px-2 py-1.5">
                    <form onSubmit={handleNavigate} className="flex items-center gap-1">
                        <div className="flex gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-md"
                                onClick={() => {
                                    setUrl('https://hijiribe.donmai.us')
                                    setInputUrl('https://hijiribe.donmai.us')
                                }}
                            >
                                <Home className="h-4 w-4" />
                            </Button>
                            {isBrowserOpen && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-md text-destructive"
                                    onClick={closeBrowser}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            )}
                        </div>

                        <div className="flex-1 relative">
                            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={inputUrl}
                                onChange={(e) => setInputUrl(e.target.value)}
                                placeholder={t('web.urlPlaceholder')}
                                className="pl-9 h-8 font-mono text-xs rounded-md"
                            />
                        </div>

                        <Button
                            type="submit"
                            size="sm"
                            className="h-8 rounded-md px-3"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <ExternalLink className="h-4 w-4 mr-1" />
                                    {t('web.open')}
                                </>
                            )}
                        </Button>
                    </form>
            </div>

            {/* Quick Links */}
            <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
                {quickLinks.map((link, index) => (
                    <div key={`${link.name}-${index}`} className="relative group">
                        <Button
                            variant="outline"
                            size="sm"
                            className={`h-7 rounded-full px-2.5 text-xs ${isEditMode ? 'pr-8' : ''}`}
                            onClick={() => handleQuickLink(link.url)}
                            disabled={isLoading}
                        >
                            <Globe className="h-3 w-3 mr-1.5" />
                            {link.name}
                        </Button>
                        {isEditMode && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0 hover:bg-destructive/80"
                                onClick={() => removeQuickLink(index)}
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                ))}

                {/* Add button */}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md px-2 text-xs"
                    onClick={() => setIsAddDialogOpen(true)}
                >
                    <Plus className="h-3 w-3 mr-1" />
                    {t('web.add')}
                </Button>

                {/* Edit mode toggle */}
                <Button
                    variant={isEditMode ? "destructive" : "ghost"}
                    size="sm"
                    className="h-7 rounded-md px-2 text-xs"
                    onClick={() => setIsEditMode(!isEditMode)}
                >
                    <Edit className="h-3 w-3 mr-1" />
                    {isEditMode ? t('web.done') : t('web.edit')}
                </Button>

                {isBrowserOpen && (
                    <>
                        {/* Zoom controls */}
                        <div className="flex items-center gap-1 ml-auto">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => handleZoom(-0.1)}
                                title="Zoom Out (Ctrl+-)"
                            >
                                <ZoomOut className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="text-xs rounded-lg px-2 h-7 min-w-[50px]"
                                onClick={handleZoomReset}
                                title="Reset Zoom (Ctrl+0)"
                            >
                                {Math.round(zoomLevel * 100)}%
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-lg"
                                onClick={() => handleZoom(0.1)}
                                title="Zoom In (Ctrl++)"
                            >
                                <ZoomIn className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            onClick={() => {
                                setDraftDanbooruTagCategories(danbooruTagCategories)
                                setIsDanbooruSettingsOpen(true)
                            }}
                            title={t('web.danbooruSettings')}
                        >
                            <Settings2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 rounded-md px-2 text-xs"
                            disabled={!isDanbooruPage}
                            onClick={() => void copyDanbooruTags()}
                        >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            {t('common.copy')}
                        </Button>
                    </>
                )}
            </div>

            {/* Browser Area */}
            <div
                className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
            >
                <div ref={browserAreaRef} className="min-h-0 flex-1" />
                {!isBrowserOpen && (
                    <Card glass className="absolute inset-0 rounded-none border-0">
                        <CardContent className="p-6 h-full flex flex-col items-center justify-center text-center">
                            <Globe className="h-16 w-16 text-muted-foreground/50 mb-4" />
                            <h2 className="text-xl font-semibold mb-2">
                                {t('web.title')}
                            </h2>
                            <p className="text-muted-foreground max-w-md">
                                {t('web.description')}
                            </p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Add Quick Link Dialog */}
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('web.addLink')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('web.linkName')}</label>
                            <Input
                                value={newLinkName}
                                onChange={(e) => setNewLinkName(e.target.value)}
                                placeholder={t('web.linkNamePlaceholder')}
                                className="rounded-xl"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">{t('web.linkUrl')}</label>
                            <Input
                                value={newLinkUrl}
                                onChange={(e) => setNewLinkUrl(e.target.value)}
                                placeholder={t('web.linkUrlPlaceholder')}
                                className="rounded-xl"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} className="rounded-xl">
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={addQuickLink} className="rounded-xl" disabled={!newLinkName.trim() || !newLinkUrl.trim()}>
                            {t('web.add')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isDanbooruSettingsOpen} onOpenChange={setIsDanbooruSettingsOpen}>
                <DialogContent className="w-72 gap-3 p-4 [&>button]:hidden">
                    <DialogHeader className="sr-only">
                        <DialogTitle>{t('web.danbooruSettings')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2">
                        {DANBOORU_TAG_CATEGORY_OPTIONS.map(({ key, label }) => (
                            <div key={key} className="flex items-center justify-between">
                                <label className="text-sm font-medium" htmlFor={`danbooru-tag-category-${key}`}>
                                    {t(label)}
                                </label>
                                <Switch
                                    id={`danbooru-tag-category-${key}`}
                                    checked={draftDanbooruTagCategories[key]}
                                    onChange={(event) => setDraftDanbooruTagCategories((categories) => ({
                                        ...categories,
                                        [key]: event.target.checked,
                                    }))}
                                />
                            </div>
                        ))}
                    </div>
                    <DialogFooter className="mt-1 gap-2 sm:justify-end sm:space-x-0">
                        <Button variant="outline" onClick={() => setIsDanbooruSettingsOpen(false)}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={() => void saveDanbooruTagCategories()}>
                            {t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
