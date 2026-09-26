import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as QRCode from 'qrcode'
import { QrCode } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RESOLUTION_PRESETS } from '@/components/ui/ResolutionSelector'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { convertFileSrc } from '@tauri-apps/api/core'
import { pickSceneRepresentativeImage } from '@/lib/scene-image-selection'
import { runRemoteSceneQueue, resolveRemoteScene, remoteSceneCostContext } from '@/services/remote-scene-queue'
import { useAuthStore } from '@/stores/auth-store'
import { useCharacterStore } from '@/stores/character-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
    pickRemoteSettings, validateRemoteSettings, validateRemoteBatch, remoteGenerationCost, remoteModelOptions,
    REMOTE_SAMPLERS, REMOTE_SCHEDULERS, REMOTE_MAX_BATCH, validateRemoteSceneQueue, type RemoteScenePage, type RemoteCostContext,
} from '@/lib/remote-generation'
import {
    createInvitation, decryptFrame, deriveKey, encryptFrame, invitationUrl,
    pairingCode, relaySocketUrl, validateInvitation, isFreshSequence, imageDataUrlByteLength,
    type EncryptedFrame, type PairingInvitation,
} from '@/lib/remote-protocol'
import { clearRemoteSession, loadRemoteSession, saveRemoteSession, updateRemoteSession, type RemoteSession } from '@/lib/remote-pairing-storage'

const WEB_URL = import.meta.env.VITE_REMOTE_WEB_URL || 'https://ciyu.us/forge.web'
const RELAY_URL = import.meta.env.VITE_REMOTE_RELAY_URL || 'wss://relay.ciyu.us'

interface PairRequest {
    deviceId: string
    code: string
    key: CryptoKey
}

async function makePreview(dataUrl: string, maxSize = 512): Promise<string> {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height))
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
    const outboundRef = useRef<Promise<void>>(Promise.resolve())
    const epochRef = useRef(0)
    const remoteBusyRef = useRef(false)
    const outboundUsageRef = useRef<{ socket: WebSocket | null; startedAt: number; count: number; bytes: number }>({ socket: null, startedAt: 0, count: 0, bytes: 0 })

    useEffect(() => {
        let cancelled = false
        const epoch = epochRef.current
        const isCurrent = () => !cancelled && epochRef.current === epoch
        loadRemoteSession().then(async saved => {
            if (!isCurrent()) return
            if (saved && Date.now() >= saved.expiresAt) await clearRemoteSession(isCurrent, saved)
            else if (saved) { sessionRef.current = saved; setSession(saved) }
            if (!isCurrent()) return
            setLoaded(true)
        }).catch(() => { if (isCurrent()) setStatus(t('remote.storageError')) })
        return () => { cancelled = true }
    }, [t])

    useEffect(() => () => { epochRef.current++; socketRef.current?.close() }, [])

    const contextIsCurrent = (active: RemoteSession, epoch: number, socket: WebSocket) =>
        epochRef.current === epoch && sessionRef.current?.room === active.room &&
        sessionRef.current?.deviceId === active.deviceId && socketRef.current === socket &&
        socket.readyState === WebSocket.OPEN && Date.now() < active.expiresAt

    const isBusy = () => remoteBusyRef.current || !!useGenerationStore.getState().generatingMode || useGenerationStore.getState().isGenerating || useSceneStore.getState().isGenerating

    const costContext = async (): Promise<RemoteCostContext> => {
        const state = useGenerationStore.getState()
        let sourceDimensions: RemoteCostContext['sourceDimensions'] = null
        if (state.sourceImage) {
            const image = new Image()
            image.src = state.sourceImage
            await image.decode()
            sourceDimensions = { width: Math.round(image.width / 64) * 64, height: Math.round(image.height / 64) * 64 }
        }
        const references = useCharacterStore.getState()
        return {
            sourceDimensions, entitlement: useAuthStore.getState().imageGenerationEntitlement,
            characterReferenceCount: references.characterImages.filter(image => image.enabled !== false).length,
            uncachedVibeCount: references.vibeImages.filter(image => image.enabled !== false && !image.encodedVibe && !image.encodedVibePath).length,
        }
    }

    const sendSession = (message: unknown, active: RemoteSession, epoch: number, socket: WebSocket): Promise<void> => {
        const send = outboundRef.current.then(async () => {
            const isCurrent = () => contextIsCurrent(active, epoch, socket)
            if (!isCurrent()) return
            const next = await updateRemoteSession(active, current => ({ ...current, nextOutboundSeq: current.nextOutboundSeq + 1 }), isCurrent)
            if (!next || !isCurrent()) return
            sessionRef.current = next
            setSession(next)
            const frame = await encryptFrame(active.outboundKey, active.room, 'app-to-phone', next.nextOutboundSeq - 1, message)
            const packet = JSON.stringify({ kind: 'data', frame })
            if (packet.length > 20_000_000) throw new Error('Response too large')
            const size = new TextEncoder().encode(packet).byteLength
            let usage = outboundUsageRef.current
            if (usage.socket !== socket || Date.now() - usage.startedAt >= 11_000) usage = { socket, startedAt: Date.now(), count: 0, bytes: 0 }
            // Match relay budgets so large originals in a batch do not close the connection.
            if (usage.count >= 16 || usage.bytes + size > 40_000_000) {
                await new Promise(resolve => setTimeout(resolve, Math.max(0, usage.startedAt + 11_000 - Date.now())))
                usage = { socket, startedAt: Date.now(), count: 0, bytes: 0 }
            }
            if (isCurrent()) {
                outboundUsageRef.current = { socket, startedAt: usage.startedAt, count: usage.count + 1, bytes: usage.bytes + size }
                socket.send(packet)
            }
        })
        outboundRef.current = send.catch(() => {})
        return send
    }

    const handleMessage = async (raw: string, socket: WebSocket, epoch: number, busyAtArrival: boolean) => {
        if (epochRef.current !== epoch || socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return
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
                if (epochRef.current !== epoch || invitationRef.current !== current || socketRef.current !== socket) return
                pendingRef.current = request
                setPending(request)
            } catch { /* malformed or expired requests cannot reach the approval UI */ }
            return
        }
        if (packet.kind !== 'data' || !packet.frame || !active) return
        if (Date.now() >= active.expiresAt || !isFreshSequence(active.lastInboundSeq, packet.frame.seq)) return
        let body: { type?: string; requestId?: string; settings?: unknown; batchCount?: unknown; expectedCost?: unknown; originalImages?: unknown; queue?: unknown; presetId?: unknown; page?: unknown }
        try {
            body = await decryptFrame(active.inboundKey, active.room, 'phone-to-app', packet.frame)
        } catch { return }
        if (!['generate', 'scene-generate', 'scene-list', 'ping', 'snapshot'].includes(body.type ?? '') || typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(body.requestId)) return
        const isCurrent = () => contextIsCurrent(active, epoch, socket)
        const next = await updateRemoteSession(active, current => isFreshSequence(current.lastInboundSeq, packet.frame!.seq)
            ? { ...current, lastInboundSeq: packet.frame!.seq } : undefined, isCurrent)
        if (!next || !isCurrent()) return
        sessionRef.current = next
        setSession(next)
        const respond = (message: unknown) => sendSession(message, active, epoch, socket)
        if (body.type === 'ping') {
            await respond({ type: 'pong', requestId: body.requestId, busy: isBusy(), ready: useAuthStore.getState().isVerified })
            return
        }
        if (body.type === 'snapshot') {
            try {
                const context = await costContext()
                const state = useGenerationStore.getState()
                await respond({ type: 'snapshot', requestId: body.requestId, snapshot: {
                    settings: pickRemoteSettings(state), costContext: context, models: remoteModelOptions(),
                    samplers: REMOTE_SAMPLERS, schedulers: REMOTE_SCHEDULERS,
                    resolutions: [...RESOLUTION_PRESETS.map(preset => ({ label: t(`resolutions.${preset.key}`), width: preset.width, height: preset.height })),
                        ...useSettingsStore.getState().customResolutions.map(({ label, width, height }) => ({ label, width, height }))],
                    batchCount: Math.min(REMOTE_MAX_BATCH, Math.max(1, state.batchCount)), maxBatch: REMOTE_MAX_BATCH,
                    i2iMode: state.sourceImage ? (state.i2iMode === 'inpaint' && state.mask ? 'inpaint' : 'i2i') : null,
                } })
            } catch { await respond({ type: 'error', requestId: body.requestId, reason: 'snapshot-failed' }) }
            return
        }
        if (body.type === 'scene-list') {
            try {
                const state = useSceneStore.getState()
                if (body.presetId !== undefined && (typeof body.presetId !== 'string' || body.presetId.length > 100)) throw new Error('Invalid preset')
                const preset = state.presets.find(preset => preset.id === (body.presetId ?? state.activePresetId))
                if (!preset) throw new Error('Missing preset')
                const page = body.page === undefined ? 0 : body.page
                const totalPages = Math.max(1, Math.ceil(preset.scenes.length / 12))
                if (typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page >= totalPages) throw new Error('Invalid page')
                const context = await costContext()
                const result: RemoteScenePage = {
                    presets: state.presets.map(({ id, name }) => ({ id, name })), presetId: preset.id, page, totalPages,
                    characters: useCharacterPromptStore.getState().characters.map(character => ({ id: character.id, name: character.name || character.id })),
                    scenes: [],
                }
                for (const scene of preset.scenes.slice(page * 12, page * 12 + 12)) {
                    const addition = state.sceneCharacterAdditions[preset.id]?.[scene.id]
                    let thumbnail: string | undefined
                    const image = pickSceneRepresentativeImage(scene.images)?.url
                    if (image) {
                        try { thumbnail = await makePreview(image.startsWith('data:') ? image : convertFileSrc(image), 192); if (thumbnail.length > 80_000) thumbnail = undefined }
                        catch { /* A missing thumbnail never removes the PC scene or image. */ }
                    }
                    const draft = { presetId: preset.id, sceneId: scene.id, scenePrompt: scene.scenePrompt, sceneNegativePrompt: scene.sceneNegativePrompt || '',
                        characterPromptIds: addition?.characterPromptIds || [], npcs: addition?.customCharacters || [], count: 0 }
                    result.scenes.push({ ...structuredClone(draft), name: scene.name, width: scene.width || 832, height: scene.height || 1216, thumbnail,
                        costContext: remoteSceneCostContext(draft, context) })
                }
                await respond({ type: 'scene-list', requestId: body.requestId, scenePage: result })
            } catch { await respond({ type: 'error', requestId: body.requestId, reason: 'scene-list-failed' }) }
            return
        }
        if (busyAtArrival || isBusy() || !useAuthStore.getState().isVerified) {
            await respond({ type: 'error', requestId: body.requestId, reason: 'busy-or-not-ready' })
            return
        }
        remoteBusyRef.current = true // Reserve before any awaited acknowledgement.
        void (async () => {
            try {
                const settings = body.settings === undefined ? undefined : validateRemoteSettings(body.settings)
                if (body.originalImages !== undefined && typeof body.originalImages !== 'boolean') throw new Error('Invalid original image option')
                const sceneQueue = body.type === 'scene-generate' ? validateRemoteSceneQueue(body.queue) : undefined
                if (sceneQueue && !settings) throw new Error('Missing settings')
                const batchCount = sceneQueue ? sceneQueue.reduce((sum, item) => sum + item.count, 0) : body.batchCount === undefined ? 1 : validateRemoteBatch(body.batchCount)
                const context = await costContext()
                const sceneCosts = sceneQueue?.map(item => {
                    const scene = resolveRemoteScene(item, settings!.model)
                    const itemContext = remoteSceneCostContext(item, context)
                    return { presetId: item.presetId, sceneId: item.sceneId, width: scene.width || 832, height: scene.height || 1216, costContext: itemContext }
                })
                const cost = sceneQueue ? sceneQueue.reduce<number | null>((sum, item, index) => {
                    const info = sceneCosts![index]
                    const value = remoteGenerationCost({ ...settings!, selectedResolution: { label: 'Scene', width: info.width, height: info.height } }, item.count, info.costContext)
                    return sum === null || value === null ? null : sum + value
                }, 0) : remoteGenerationCost(settings ?? pickRemoteSettings(useGenerationStore.getState()), batchCount, context)
                if (settings && (body.expectedCost !== null && (typeof body.expectedCost !== 'number' || !Number.isFinite(body.expectedCost) || body.expectedCost < 0) ||
                    cost !== body.expectedCost)) {
                    await respond({ type: 'error', requestId: body.requestId, reason: 'cost-changed', costContext: await costContext(), sceneCosts })
                    return
                }
                if (!isCurrent()) return
                const generation = useGenerationStore.getState()
                // Local generation may have started while the acknowledgement was saved.
                if (generation.isGenerating || generation.generatingMode || useSceneStore.getState().isGenerating || !useAuthStore.getState().isVerified) {
                    await respond({ type: 'error', requestId: body.requestId, reason: 'busy-or-not-ready' })
                    return
                }
                let completed = 0
                let legacyPreview: string | undefined
                let imageTooLarge = false
                const publishImage = async (image: string, index: number, item?: { presetId: string; sceneId: string }) => {
                    if (isCurrent()) {
                        if (body.originalImages) {
                            try { imageDataUrlByteLength(image) } catch {
                                imageTooLarge = true
                                throw new Error('Image too large')
                            }
                        }
                        const preview = body.originalImages ? image : await makePreview(image)
                        if (!settings) legacyPreview = preview // Already-open prototype tabs expect the old complete.preview field.
                        await respond({ type: 'image', requestId: body.requestId, index, total: batchCount, preview, presetId: item?.presetId, sceneId: item?.sceneId })
                        completed = index
                    }
                }
                const work = sceneQueue ? runRemoteSceneQueue({ settings: settings!, queue: sceneQueue, shouldContinue: isCurrent, onImage: publishImage })
                    : generation.generate({ batchCount, settings, shouldContinue: isCurrent, onImage: publishImage })
                // generate() claims the PC owner synchronously; this acknowledges validated request settings.
                await respond({ type: 'started', requestId: body.requestId, applied: true, batchCount, cost })
                await work
                if (!isCurrent()) return
                await respond({ type: completed === batchCount ? 'complete' : 'error', requestId: body.requestId,
                    completed, total: batchCount, preview: legacyPreview, reason: imageTooLarge ? 'image-too-large' : completed === batchCount ? undefined : 'generation-failed' })
            } catch (error) {
                await respond({ type: 'error', requestId: body.requestId, reason: error instanceof Error && error.message === 'Image too large' ? 'image-too-large' : 'generation-failed' }).catch(() => {})
            } finally { remoteBusyRef.current = false }
        })() // Do not block authenticated ping/busy handling until generation completes.
    }

    const room = session?.room ?? invitation?.room
    useEffect(() => {
        if (!room || !RELAY_URL) return
        let stopped = false
        const epoch = epochRef.current
        let retryTimer: ReturnType<typeof setTimeout> | undefined
        let ownedSocket: WebSocket | null = null
        const connect = () => {
            if (stopped) return
            setRelayConnected(false)
            let socket: WebSocket
            try { socket = new WebSocket(relaySocketUrl(RELAY_URL, room, 'app')) } catch { setStatus(t('remote.relayError')); return }
            socketRef.current = socket
            ownedSocket = socket
            socket.onopen = () => {
                if (stopped || epochRef.current !== epoch) { socket.close(); return }
                setRelayConnected(true)
                setStatus(t('remote.relayConnected'))
            }
            socket.onmessage = event => {
                if (typeof event.data !== 'string') return
                const busyAtArrival = isBusy()
                processingRef.current = processingRef.current.then(() => handleMessage(event.data as string, socket, epoch, busyAtArrival)).catch(() => {
                    if (!stopped && epochRef.current === epoch) setStatus(t('remote.relayError'))
                })
            }
            socket.onclose = () => {
                if (socketRef.current === socket) socketRef.current = null
                if (!stopped && epochRef.current === epoch) {
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
            ownedSocket?.close()
            if (socketRef.current === ownedSocket) socketRef.current = null
        }
    }, [room, t])

    const generateQr = async () => {
        let epoch = epochRef.current
        try {
            if (!WEB_URL || !RELAY_URL) throw new Error('Remote endpoint not configured')
            const created = createInvitation(Number(hours))
            epoch = invalidateSession()
            const isCurrent = () => epochRef.current === epoch
            await clearRemoteSession(isCurrent)
            if (!isCurrent()) return
            const url = invitationUrl(WEB_URL, created)
            const image = await QRCode.toDataURL(url, { width: 260, margin: 2, errorCorrectionLevel: 'M' })
            if (!isCurrent()) return
            invitationRef.current = created
            setInvitation(created)
            setQrImage(image)
            setStatus(t('remote.scanPrompt'))
        } catch {
            if (epochRef.current === epoch) setStatus(t('remote.configurationError'))
        }
    }

    const approve = async () => {
        const current = invitationRef.current
        const request = pendingRef.current
        const socket = socketRef.current
        const epoch = epochRef.current
        if (!current || !request || socket?.readyState !== WebSocket.OPEN) return
        const isCurrent = () => epochRef.current === epoch && invitationRef.current === current &&
            pendingRef.current === request && socketRef.current === socket && socket.readyState === WebSocket.OPEN && Date.now() < current.qrExpiresAt
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
            if (!await saveRemoteSession(active, isCurrent) || !isCurrent()) return
            socket.send(JSON.stringify({ kind: 'pair-accepted', frame }))
            sessionRef.current = active
            setSession(active)
            invitationRef.current = null
            setInvitation(null)
            pendingRef.current = null
            setPending(null)
            setQrImage('')
            setStatus(t('remote.paired'))
        } catch { if (epochRef.current === epoch) setStatus(t('remote.pairFailed')) }
    }

    const invalidateSession = () => {
        const epoch = ++epochRef.current
        sessionRef.current = null
        setSession(null)
        invitationRef.current = null
        setInvitation(null)
        pendingRef.current = null
        setPending(null)
        setQrImage('')
        socketRef.current?.close()
        socketRef.current = null
        setRelayConnected(false)
        return epoch
    }

    const revoke = async () => {
        const epoch = invalidateSession()
        try {
            await clearRemoteSession(() => epochRef.current === epoch)
            if (epochRef.current === epoch) setStatus(t('remote.revoked'))
        } catch { if (epochRef.current === epoch) setStatus(t('remote.storageError')) }
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
