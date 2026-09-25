export const QR_LIFETIME_MS = 5 * 60 * 1000
export const MAX_ACCESS_HOURS = 72
export const MAX_CLOCK_SKEW_MS = 60 * 1000

export interface PairingInvitation {
    v: 1
    room: string
    secret: string
    createdAt: number
    qrExpiresAt: number
    accessExpiresAt: number
    validHours: number
}

export interface EncryptedFrame {
    v: 1
    seq: number
    iv: string
    ciphertext: string
}

export type Direction = 'pair' | 'phone-to-app' | 'app-to-phone'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bytes(buffer: Uint8Array): ArrayBuffer {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

export function toBase64Url(value: Uint8Array): string {
    let binary = ''
    for (const byte of value) binary += String.fromCharCode(byte)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createInvitation(validHours: number, now = Date.now()): PairingInvitation {
    if (!Number.isInteger(validHours) || validHours < 1 || validHours > MAX_ACCESS_HOURS) {
        throw new Error('Invalid access duration')
    }
    return {
        v: 1,
        room: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
        secret: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
        createdAt: now,
        qrExpiresAt: now + QR_LIFETIME_MS,
        accessExpiresAt: now + validHours * 60 * 60 * 1000,
        validHours,
    }
}

export function validateInvitation(value: unknown, now = Date.now()): PairingInvitation {
    if (!value || typeof value !== 'object') throw new Error('Invalid QR payload')
    const invitation = value as PairingInvitation
    if (invitation.v !== 1 || typeof invitation.room !== 'string' || typeof invitation.secret !== 'string' ||
        fromBase64Url(invitation.room).length !== 16 || fromBase64Url(invitation.secret).length !== 32 ||
        !Number.isInteger(invitation.createdAt) || !Number.isInteger(invitation.qrExpiresAt) ||
        !Number.isInteger(invitation.accessExpiresAt) || !Number.isInteger(invitation.validHours) ||
        invitation.validHours < 1 || invitation.validHours > MAX_ACCESS_HOURS ||
        invitation.qrExpiresAt - invitation.createdAt !== QR_LIFETIME_MS ||
        invitation.accessExpiresAt - invitation.createdAt !== invitation.validHours * 60 * 60 * 1000 ||
        invitation.createdAt > now + MAX_CLOCK_SKEW_MS || now >= invitation.qrExpiresAt ||
        now >= invitation.accessExpiresAt) {
        throw new Error('QR expired or modified')
    }
    return invitation
}

export function invitationUrl(webUrl: string, invitation: PairingInvitation): string {
    const url = new URL(webUrl)
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('HTTPS is required')
    url.hash = `pair=${toBase64Url(encoder.encode(JSON.stringify(invitation)))}`
    return url.toString()
}

export function invitationFromHash(hash: string, now = Date.now()): PairingInvitation {
    const encoded = new URLSearchParams(hash.replace(/^#/, '')).get('pair')
    if (!encoded || encoded.length > 2048) throw new Error('Invalid QR link')
    return validateInvitation(JSON.parse(decoder.decode(fromBase64Url(encoded))), now)
}

export function randomDeviceId(): string {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
}

export function isFreshSequence(lastSeen: number, incoming: number): boolean {
    return Number.isSafeInteger(lastSeen) && Number.isSafeInteger(incoming) && incoming > lastSeen
}

export function relaySocketUrl(baseUrl: string, room: string, role: 'app' | 'phone'): string {
    if (fromBase64Url(room).length !== 16) throw new Error('Invalid room')
    const url = new URL(baseUrl)
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && url.hostname === 'localhost')) {
        throw new Error('Secure relay is required')
    }
    url.pathname = `/relay/${room}`
    url.search = `?role=${role}`
    url.hash = ''
    return url.toString()
}

export async function deriveKey(secret: string, room: string, deviceId: string, direction: Direction): Promise<CryptoKey> {
    if (fromBase64Url(secret).length !== 32 || fromBase64Url(room).length !== 16 ||
        (direction !== 'pair' && fromBase64Url(deviceId).length !== 16)) throw new Error('Invalid pairing key material')
    const material = await crypto.subtle.importKey('raw', bytes(fromBase64Url(secret)), 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: bytes(encoder.encode(`${room}:${direction === 'pair' ? 'pairing' : deviceId}`)),
        info: bytes(encoder.encode(`NAIS2-Forge remote v1:${direction}`)),
    }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function pairingCode(secret: string, deviceId: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(encoder.encode(`${secret}:${deviceId}`))))
    const number = ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000
    return number.toString().padStart(6, '0')
}

function authenticatedData(room: string, direction: Direction, seq: number): ArrayBuffer {
    return bytes(encoder.encode(`NAIS2-Forge remote v1:${room}:${direction}:${seq}`))
}

export async function encryptFrame(key: CryptoKey, room: string, direction: Direction, seq: number, message: unknown): Promise<EncryptedFrame> {
    if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('Invalid sequence')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = bytes(encoder.encode(JSON.stringify(message)))
    const ciphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM', iv: bytes(iv), additionalData: authenticatedData(room, direction, seq),
    }, key, plaintext)
    return { v: 1, seq, iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) }
}

export async function decryptFrame<T>(key: CryptoKey, room: string, direction: Direction, frame: EncryptedFrame): Promise<T> {
    if (frame?.v !== 1 || !Number.isSafeInteger(frame.seq) || frame.seq < 1 ||
        typeof frame.iv !== 'string' || fromBase64Url(frame.iv).length !== 12 ||
        typeof frame.ciphertext !== 'string' || frame.ciphertext.length > 3_000_000) {
        throw new Error('Invalid encrypted frame')
    }
    const plaintext = await crypto.subtle.decrypt({
        name: 'AES-GCM', iv: bytes(fromBase64Url(frame.iv)),
        additionalData: authenticatedData(room, direction, frame.seq),
    }, key, bytes(fromBase64Url(frame.ciphertext)))
    return JSON.parse(decoder.decode(plaintext)) as T
}
