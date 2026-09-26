import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as QRCode from 'qrcode'
import { QrCode } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import {
    createInvitation, decryptFrame, deriveKey, encryptFrame, invitationUrl,
    pairingCode, relaySocketUrl, validateInvitation, isFreshSequence,
    type EncryptedFrame, type PairingInvitation,
} from '@/lib/remote-protocol'
import { clearRemoteSession, loadRemoteSession, saveRemoteSession, type RemoteSession } from '@/lib/remote-pairing-storage'

const WEB_URL = import.meta.env.VITE_REMOTE_WEB_URL || 'https://ciyu.us/forge.web'
const RELAY_URL = import.meta.env.VITE_REMOTE_RELAY_URL || 'wss://relay.ciyu.us'

interface PairRequest {
    deviceId: string
    code: string
    key: CryptoKey
}

async function makePreview(dataUrl: string): Promise<string> {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const scale = Math.min(1, 512 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const preview = canvas.toDataURL('image/webp', 0.7)
    if (preview.length > 1_000_000) throw new Error('Preview too large')
    return preview
}

export function RemoteControl() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const [hours, setHours] = useState('24')
    const [qrImage, setQrImage] = useState('')
    const [invitation, setInvitation] = useState<PairingInvitation | null>(null)
    const [session, setSession] = useState<RemoteSession | null>(null)
    const [pending, setPending] = useState<PairRequest | null>(null)
    const [status, setStatus] = useState('')
    const [loaded, setLoaded] = useState(false)
    const [relayConnected, setRelayConnected] = useState(false)
    const socketRef = useRef<WebSocket | null>(null)
    const sessionRef = useRef<RemoteSession | null>(null)
    const invitationRef = useRef<PairingInvitation | null>(null)
    const pendingRef = useRef<PairRequest | null>(null)
    const processingRef = useRef<Promise<void>>(Promise.resolve())

    sessionRef.current = session
    invitationRef.current = invitation
    pendingRef.current = pending

    useEffect(() => {
        let cancelled = false
        loadRemoteSession().then(async saved => {
            if (cancelled) return
            if (saved && Date.now() >= saved.expiresAt) await clearRemoteSession()
            else if (saved) setSession(saved)
            setLoaded(true)
        }).catch(() => { if (!cancelled) setStatus(t('remote.storageError')) })
        return () => { cancelled = true }
    }, [t])

    const sendSession = async (message: unknown) => {
        const active = sessionRef.current
        const socket = socketRef.current
        if (!active || socket?.readyState !== WebSocket.OPEN || Date.now() >= active.expiresAt) return
        const next = { ...active, nextOutboundSeq: active.nextOutboundSeq + 1 }
        await saveRemoteSession(next) // consume sequence before sending; a crash cannot reuse it
        sessionRef.current = next
        setSession(next)
        const frame = await encryptFrame(active.outboundKey, active.room, 'app-to-phone', active.nextOutboundSeq, message)
        socket.send(JSON.stringify({ kind: 'data', frame }))
    }

    const handleMessage = async (raw: string) => {
        if (raw.length > 3_000_000) return
        let packet: { kind?: string; frame?: EncryptedFrame }
        try { packet = JSON.parse(raw) } catch { return }
        const active = sessionRef.current
        if (packet.kind === 'pair' && packet.frame && !active && !pendingRef.current) {
            const current = invitationRef.current
            if (!current) return
            try {
                validateInvitation(current)
                const key = await deriveKey(current.secret, current.room, '', 'pair')
                const body = await decryptFrame<{ type: string; deviceId: string; createdAt: number; accessExpiresAt: number }>(
                    key, current.room, 'pair', packet.frame,
                )
                if (packet.frame.seq !== 1 || body.type !== 'pair' || !/^[A-Za-z0-9_-]{22}$/.test(body.deviceId) ||
                    body.createdAt !== current.createdAt || body.accessExpiresAt !== current.accessExpiresAt) return
                const request = { deviceId: body.deviceId, code: await pairingCode(current.secret, body.deviceId), key }
                pendingRef.current = request
                setPending(request)
            } catch { /* malformed or expired requests cannot reach the approval UI */ }
            return
        }
        if (packet.kind !== 'data' || !packet.frame || !active) return
        if (Date.now() >= active.expiresAt || !isFreshSequence(active.lastInboundSeq, packet.frame.seq)) return
        let body: { type?: string; requestId?: string }
        try {
            body = await decryptFrame(active.inboundKey, active.room, 'phone-to-app', packet.frame)
        } catch { return }
        if (body.type !== 'generate' || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.requestId)) return
        const next = { ...active, lastInboundSeq: packet.frame.seq }
        await saveRemoteSession(next) // reject replay even after app restart
        sessionRef.current = next
        setSession(next)
        const generation = useGenerationStore.getState()
        if (generation.isGenerating || generation.generatingMode || !useAuthStore.getState().isVerified) {
            await sendSession({ type: 'error', requestId: body.requestId, reason: 'busy-or-not-ready' })
            return
        }
        await sendSession({ type: 'started', requestId: body.requestId })
        try {
            await generation.generate({ batchCount: 1 })
            const result = useGenerationStore.getState().previewImage
            if (!result) throw new Error('Generation did not return an image')
            await sendSession({ type: 'complete', requestId: body.requestId, preview: await makePreview(result) })
        } catch {
            await sendSession({ type: 'error', requestId: body.requestId, reason: 'generation-failed' })
        }
    }

    const room = session?.room ?? invitation?.room
    useEffect(() => {
        if (!room || !RELAY_URL) return
        let stopped = false
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        const connect = () => {
            if (stopped) return
            setRelayConnected(false)
            let socket: WebSocket
            try { socket = new WebSocket(relaySocketUrl(RELAY_URL, room, 'app')) } catch { setStatus(t('remote.relayError')); return }
            socketRef.current = socket
            socket.onopen = () => {
                setRelayConnected(true)
                setStatus(t('remote.relayConnected'))
            }
            socket.onmessage = event => {
                if (typeof event.data !== 'string') return
                processingRef.current = processingRef.current.then(() => handleMessage(event.data as string)).catch(() => {
                    setStatus(t('remote.relayError'))
                })
            }
            socket.onclose = () => {
                if (socketRef.current === socket) socketRef.current = null
                if (!stopped) {
                    setRelayConnected(false)
                    setStatus(t('remote.relayDisconnected'))
                    retryTimer = setTimeout(connect, 5000)
                }
            }
        }
        connect()
        return () => {
            stopped = true
            if (retryTimer) clearTimeout(retryTimer)
            socketRef.current?.close()
            socketRef.current = null
        }
    }, [room, t])

    const generateQr = async () => {
        try {
            if (!WEB_URL || !RELAY_URL) throw new Error('Remote endpoint not configured')
            const created = createInvitation(Number(hours))
            const url = invitationUrl(WEB_URL, created)
            const image = await QRCode.toDataURL(url, { width: 260, margin: 2, errorCorrectionLevel: 'M' })
            await clearRemoteSession()
            sessionRef.current = null
            setSession(null)
            pendingRef.current = null
            setPending(null)
            invitationRef.current = created
            setInvitation(created)
            setQrImage(image)
            setStatus(t('remote.scanPrompt'))
        } catch {
            setStatus(t('remote.configurationError'))
        }
    }

    const approve = async () => {
        const current = invitationRef.current
        const request = pendingRef.current
        const socket = socketRef.current
        if (!current || !request || socket?.readyState !== WebSocket.OPEN) return
        try {
            validateInvitation(current)
            const active: RemoteSession = {
                room: current.room, deviceId: request.deviceId,
                createdAt: current.createdAt, expiresAt: current.accessExpiresAt,
                inboundKey: await deriveKey(current.secret, current.room, request.deviceId, 'phone-to-app'),
                outboundKey: await deriveKey(current.secret, current.room, request.deviceId, 'app-to-phone'),
                lastInboundSeq: 0, nextOutboundSeq: 1,
            }
            const frame = await encryptFrame(request.key, current.room, 'pair', 2, {
                type: 'approved', deviceId: request.deviceId, expiresAt: current.accessExpiresAt,
            })
            await saveRemoteSession(active)
            socket.send(JSON.stringify({ kind: 'pair-accepted', frame }))
            sessionRef.current = active
            setSession(active)
            invitationRef.current = null
            setInvitation(null)
            pendingRef.current = null
            setPending(null)
            setQrImage('')
            setStatus(t('remote.paired'))
        } catch { setStatus(t('remote.pairFailed')) }
    }

    const revoke = async () => {
        await clearRemoteSession()
        sessionRef.current = null
        setSession(null)
        invitationRef.current = null
        setInvitation(null)
        pendingRef.current = null
        setPending(null)
        setQrImage('')
        setStatus(t('remote.revoked'))
    }

    return (
        <>
            <button type="button" onClick={() => setOpen(true)} aria-label={t('remote.title')}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground">
                <QrCode className="h-4 w-4" />
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-sm">
                    <DialogTitle>{t('remote.title')}</DialogTitle>
                    <DialogDescription>{t('remote.description')}</DialogDescription>
                    <div className="space-y-3 text-sm">
                        <label className="flex items-center gap-3">
                            <span className="flex-1">{t('remote.validHours')}</span>
                            <Input className="w-20 text-right" inputMode="numeric" value={hours}
                                onChange={event => setHours(event.target.value.replace(/\D/g, ''))} />
                        </label>
                        <Button type="button" disabled={!loaded} onClick={() => { void generateQr() }}>{t('remote.createQr')}</Button>
                        {qrImage && invitation && relayConnected && <div className="rounded-lg bg-white p-3 text-center text-black">
                            <img src={qrImage} alt={t('remote.qrAlt')} className="mx-auto" />
                            <div>{t('remote.qrExpires', { time: new Date(invitation.qrExpiresAt).toLocaleString() })}</div>
                            <div>{t('remote.accessExpires', { time: new Date(invitation.accessExpiresAt).toLocaleString() })}</div>
                        </div>}
                        {pending && <div className="space-y-2 rounded-lg border border-amber-500/50 p-3">
                            <div>{t('remote.confirmCode', { code: pending.code })}</div>
                            <Button type="button" onClick={() => { void approve() }}>{t('remote.approve')}</Button>
                        </div>}
                        {session && <div>{t('remote.accessExpires', { time: new Date(session.expiresAt).toLocaleString() })}</div>}
                        <div role="status" className="text-muted-foreground">{status}</div>
                    </div>
                    <DialogFooter>
                        {(session || invitation) && <Button type="button" variant="destructive" onClick={() => { void revoke() }}>{t('remote.revoke')}</Button>}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
