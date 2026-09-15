import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settings-store'
import { flushAllPendingWrites } from '@/lib/indexed-db'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Replace the ID and translated body together when publishing a new notice.
const ANNOUNCEMENT_ID = import.meta.env.DEV ? '1.10.3-generation-delay-dev-capture-1' : '1.10.3-generation-delay'
function subscribeHydration(onChange: () => void) {
    const start = useSettingsStore.persist.onHydrate(onChange)
    const finish = useSettingsStore.persist.onFinishHydration(onChange)
    return () => { start(); finish() }
}

export function AnnouncementDialog() {
    const { t } = useTranslation()
    const hydrated = useSyncExternalStore(subscribeHydration, useSettingsStore.persist.hasHydrated)
    const acknowledged = useSettingsStore(state => state.acknowledgedAnnouncementId)
    const acknowledge = useSettingsStore(state => state.acknowledgeAnnouncement)

    return (
        <Dialog open={hydrated && acknowledged !== ANNOUNCEMENT_ID}>
            <DialogContent
                className="max-w-lg w-[calc(100%-2rem)] max-h-[85vh] overflow-y-auto [&>button]:hidden"
                aria-describedby="announcement-body"
                onEscapeKeyDown={event => event.preventDefault()}
                onPointerDownOutside={event => event.preventDefault()}
                onKeyDown={event => event.stopPropagation()}
            >
                <DialogTitle>{t('announcement.title')}</DialogTitle>
                <DialogDescription id="announcement-body" className="whitespace-pre-line leading-relaxed">
                    {t('announcement.body')}
                </DialogDescription>
                <DialogFooter>
                    <Button onClick={() => {
                        acknowledge(ANNOUNCEMENT_ID)
                        void flushAllPendingWrites().catch(error => console.error('[Announcement] Save failed:', error))
                    }}>{t('announcement.confirm')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
