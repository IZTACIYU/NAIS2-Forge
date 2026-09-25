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

export async function saveRemoteSession(session: RemoteSession): Promise<void> {
    await transact('readwrite', store => store.put(session, 'active'))
}

export async function clearRemoteSession(): Promise<void> {
    await transact('readwrite', store => store.delete('active'))
}
