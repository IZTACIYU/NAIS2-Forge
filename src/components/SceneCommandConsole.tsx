import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSettingsStore } from '@/stores/settings-store'
import { isEditableEventTarget } from '@/lib/utils'
import { isSceneConsoleShortcut, parseSceneFeatureCommand } from '@/lib/scene-feature-command'

export function SceneCommandConsole() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [command, setCommand] = useState('')
    const [message, setMessage] = useState('')
    useEffect(() => {
        const handle = (event: KeyboardEvent) => {
            if (!isSceneConsoleShortcut(event, isEditableEventTarget(event.target) || isEditableEventTarget(document.activeElement))) return
            if (document.querySelector('[role="dialog"][data-state="open"]')) return
            event.preventDefault(); event.stopImmediatePropagation()
            setCommand(''); setMessage(''); setOpen(true)
        }
        window.addEventListener('keydown', handle, true)
        return () => window.removeEventListener('keydown', handle, true)
    }, [])
    return <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onKeyDown={event => event.stopPropagation()}>
            <DialogHeader><DialogTitle>{t('scenePrivate.console')}</DialogTitle></DialogHeader>
            <p className="text-xs font-mono text-muted-foreground">scene.stack on / off<br />scene.czip on / off</p>
            <form onSubmit={async event => {
                event.preventDefault()
                const parsed = parseSceneFeatureCommand(command)
                if (!parsed) { setMessage(t('scenePrivate.invalidCommand')); return }
                if (!useSettingsStore.persist.hasHydrated()) { setMessage(t('scenePrivate.notReady')); return }
                try {
                    await useSettingsStore.getState().setConsoleFeature(parsed.feature, parsed.enabled)
                    setMessage(`scene.${parsed.feature}: ${parsed.enabled ? 'ON' : 'OFF'}`)
                    setCommand('')
                } catch (error) { setMessage(String(error)) }
            }}>
                <Input autoFocus value={command} maxLength={128} onChange={event => setCommand(event.target.value)} aria-label={t('scenePrivate.command')} autoComplete="off" spellCheck={false} className="font-mono" />
            </form>
            <p role="status" className="break-words text-sm">{message}</p>
        </DialogContent>
    </Dialog>
}
