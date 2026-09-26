// Separate from existing user stores. CryptoKeys remain non-extractable and are
// structured-cloned by IndexedDB; no QR secret or NovelAI token is persisted.
const DB_NAME = 'nais2-forge-remote-pairing'
const STORE_NAME = 'sessions'

export interface RemoteSession {
    room: string
    deviceId: string
    createdAt: number
    expiresAt: number
    inboundKey: CryptoKey
    outboundKey: CryptoKey
    lastInboundSeq: number
    nextOutboundSeq: number
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb()
    try {
        return await new Promise<T>((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, mode)
            const request = action(transaction.objectStore(STORE_NAME))
            let result: T
            request.onsuccess = () => { result = request.result }
            transaction.oncomplete = () => resolve(result)
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error)
        })
    } finally {
        db.close()
    }
}

export async function loadRemoteSession(): Promise<RemoteSession | null> {
    return (await transact('readonly', store => store.get('active') as IDBRequest<RemoteSession | undefined>)) ?? null
}

async function changeRemoteSession(
    change: (current: RemoteSession | null) => RemoteSession | null | undefined,
    isCurrent: () => boolean,
): Promise<RemoteSession | null> {
    const db = await openDb()
    try {
        return await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get('active')
            let result: RemoteSession | null = null
            request.onsuccess = () => {
                // Check inside the transaction, not before the asynchronous DB open.
                if (!isCurrent()) return
                try {
                    const next = change(request.result ?? null)
                    if (next === undefined) return
                    if (next === null) store.delete('active')
                    else store.put(next, 'active')
                    result = next
                } catch { transaction.abort() }
            }
            transaction.oncomplete = () => resolve(result)
            transaction.onerror = () => reject(transaction.error)
            transaction.onabort = () => reject(transaction.error ?? new Error('Session update aborted'))
        })
    } finally { db.close() }
}

export async function saveRemoteSession(session: RemoteSession, isCurrent: () => boolean = () => true): Promise<RemoteSession | null> {
    return changeRemoteSession(() => session, isCurrent)
}

export async function updateRemoteSession(
    expected: RemoteSession,
    update: (current: RemoteSession) => RemoteSession | undefined,
    isCurrent: () => boolean = () => true,
): Promise<RemoteSession | null> {
    return changeRemoteSession(current => {
        if (!current || current.room !== expected.room || current.deviceId !== expected.deviceId ||
            current.createdAt !== expected.createdAt || current.expiresAt !== expected.expiresAt) return undefined
        return update(current)
    }, isCurrent)
}

export async function clearRemoteSession(isCurrent: () => boolean = () => true, expected?: RemoteSession): Promise<void> {
    await changeRemoteSession(current => expected && (!current || current.room !== expected.room ||
        current.deviceId !== expected.deviceId || current.createdAt !== expected.createdAt) ? undefined : null, isCurrent)
}
