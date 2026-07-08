import { StateStorage } from 'zustand/middleware'
// Since I cannot install packages, I will implement a minimal wrapper similar to idb-keyval logic
// or I can implement a raw IndexedDB wrapper.
// Given constraints, raw IndexedDB is safer as strict dependency rules apply.

const DB_NAME = 'nais2-forge-db'
const STORE_NAME = 'keyval'
const DB_TIMEOUT_MS = 10000 // 10초 타임아웃

// IndexedDB 초기화 실패 추적
let dbInitFailed = false
let dbInitError: Error | null = null

// 지연 초기화 - 모듈 로드 시점이 아닌 첫 사용 시점에 초기화
let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    
    // 이전에 초기화 실패했으면 즉시 reject
    if (dbInitFailed) {
        return Promise.reject(dbInitError || new Error('IndexedDB initialization previously failed'))
    }
    
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        // IndexedDB 지원 체크
        if (typeof indexedDB === 'undefined') {
            dbInitFailed = true
            dbInitError = new Error('IndexedDB is not supported in this environment')
            reject(dbInitError)
            return
        }
        
        // 타임아웃 설정 - DB 열기가 무한 대기되는 것 방지
        const timeoutId = setTimeout(() => {
            dbInitFailed = true
            dbInitError = new Error(`IndexedDB open timed out after ${DB_TIMEOUT_MS}ms`)
            console.error('[IndexedDB]', dbInitError.message)
            reject(dbInitError)
        }, DB_TIMEOUT_MS)
        
        try {
            const request = indexedDB.open(DB_NAME, 1)
            
            request.onupgradeneeded = (event) => {
                try {
                    const db = (event.target as IDBOpenDBRequest).result
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME)
                    }
                } catch (err) {
                    console.error('[IndexedDB] onupgradeneeded error:', err)
                }
            }
            
            request.onsuccess = () => {
                clearTimeout(timeoutId)
                const db = request.result
                
                // DB 연결 끊김 감지
                db.onclose = () => {
                    console.warn('[IndexedDB] Database connection closed unexpectedly')
                    dbPromise = null // 다음 요청 시 재연결 시도
                }
                
                db.onerror = (event) => {
                    console.error('[IndexedDB] Database error:', event)
                }
                
                console.log('[IndexedDB] Database opened successfully')
                resolve(db)
            }
            
            request.onerror = () => {
                clearTimeout(timeoutId)
                dbInitFailed = true
                dbInitError = request.error || new Error('Failed to open IndexedDB')
                console.error('[IndexedDB] Open error:', dbInitError)
                reject(dbInitError)
            }
            
            request.onblocked = () => {
                console.warn('[IndexedDB] Database blocked - another connection is open')
            }
        } catch (err) {
            clearTimeout(timeoutId)
            dbInitFailed = true
            dbInitError = err instanceof Error ? err : new Error(String(err))
            console.error('[IndexedDB] Unexpected error during open:', dbInitError)
            reject(dbInitError)
        }
    })
    
    return dbPromise
}

// DB 초기화 상태 확인용 (마이그레이션 전 체크용)
export async function ensureDbReady(): Promise<boolean> {
    try {
        await getDb()
        return true
    } catch (err) {
        console.error('[IndexedDB] ensureDbReady failed:', err)
        return false
    }
}

// DB 초기화 실패 여부 확인
export function isDbInitFailed(): boolean {
    return dbInitFailed
}

const OPERATION_TIMEOUT_MS = 5000 // 개별 작업 타임아웃

// ============================================
// Debounced Write System
// Zustand persist calls setItem on EVERY state change.
// Without debouncing, typing a single character triggers full JSON.stringify + IndexedDB write.
// With thousands of scene images, each write serializes megabytes of data.
// ============================================
const WRITE_DEBOUNCE_MS: Record<string, number> = {
    'nais2-forge-scenes': 3000,           // Largest store (scene images), debounce aggressively
    'nais2-forge-generation': 1000,       // Prompt typing triggers frequent updates
    'nais2-forge-character-store': 1500,
    'nais2-forge-character-prompts': 1500,
    'nais2-forge-presets': 1500,
    'nais2-forge-wildcards': 2000,
}
const DEFAULT_WRITE_DEBOUNCE = 500
const MAX_WRITE_INTERVAL = 10000   // Force write at least every 10 seconds even during rapid changes

const pendingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingWriteValues = new Map<string, string>()
const lastWriteTime = new Map<string, number>()

/** Write directly to IndexedDB (no debounce) */
async function rawSetItem(name: string, value: string): Promise<void> {
    if (dbInitFailed) return
    try {
        const db = await getDb()
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                console.error(`[IndexedDB] setItem(${name}): Operation timed out`)
                reject(new Error(`setItem timed out for key: ${name}`))
            }, OPERATION_TIMEOUT_MS)

            try {
                const transaction = db.transaction(STORE_NAME, 'readwrite')

                transaction.onerror = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Transaction error`, transaction.error)
                    reject(transaction.error)
                }

                transaction.onabort = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Transaction aborted`)
                    reject(new Error('Transaction aborted'))
                }

                transaction.oncomplete = () => {
                    clearTimeout(timeoutId)
                    resolve()
                }

                const store = transaction.objectStore(STORE_NAME)
                const request = store.put(value, name)

                request.onerror = () => {
                    clearTimeout(timeoutId)
                    console.error(`[IndexedDB] setItem(${name}): Request error`, request.error)
                    reject(request.error)
                }
            } catch (err) {
                clearTimeout(timeoutId)
                throw err
            }
        })
    } catch (err) {
        console.error(`[IndexedDB] setItem(${name}): Failed`, err)
    }
}

/** Flush a single pending write immediately */
async function flushKey(name: string): Promise<void> {
    const timer = pendingWriteTimers.get(name)
    if (timer) {
        clearTimeout(timer)
        pendingWriteTimers.delete(name)
    }
    const value = pendingWriteValues.get(name)
    if (value !== undefined) {
        pendingWriteValues.delete(name)
        lastWriteTime.set(name, Date.now())
        await rawSetItem(name, value)
    }
}

/** Flush ALL pending writes (called on app close) */
export async function flushAllPendingWrites(): Promise<void> {
    const keys = [...pendingWriteTimers.keys()]
    for (const key of keys) {
        await flushKey(key)
    }
}

// Flush pending writes on app close
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        for (const [name, timer] of pendingWriteTimers.entries()) {
            clearTimeout(timer)
            const val = pendingWriteValues.get(name)
            if (val !== undefined) {
                rawSetItem(name, val).catch(() => {})
            }
        }
        pendingWriteTimers.clear()
        pendingWriteValues.clear()
    })
}

export const indexedDBStorage: StateStorage = {
    getItem: async (name: string): Promise<string | null> => {
        // Return pending value if exists (debounced write hasn't flushed yet)
        const pendingVal = pendingWriteValues.get(name)
        if (pendingVal !== undefined) return pendingVal

        // DB 초기화 실패 시 null 반환 (데이터 손실 방지를 위해 에러 대신 null)
        if (dbInitFailed) {
            console.warn(`[IndexedDB] getItem(${name}): DB init failed, returning null`)
            return null
        }

        try {
            const db = await getDb()
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.error(`[IndexedDB] getItem(${name}): Operation timed out`)
                    reject(new Error(`getItem timed out for key: ${name}`))
                }, OPERATION_TIMEOUT_MS)

                try {
                    const transaction = db.transaction(STORE_NAME, 'readonly')

                    transaction.onerror = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Transaction error`, transaction.error)
                        reject(transaction.error)
                    }

                    transaction.onabort = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Transaction aborted`)
                        reject(new Error('Transaction aborted'))
                    }

                    const store = transaction.objectStore(STORE_NAME)
                    const request = store.get(name)

                    request.onsuccess = () => {
                        clearTimeout(timeoutId)
                        resolve(request.result as string || null)
                    }

                    request.onerror = () => {
                        clearTimeout(timeoutId)
                        console.error(`[IndexedDB] getItem(${name}): Request error`, request.error)
                        reject(request.error)
                    }
                } catch (err) {
                    clearTimeout(timeoutId)
                    throw err
                }
            })
        } catch (err) {
            console.error(`[IndexedDB] getItem(${name}): Failed`, err)
            return null
        }
    },

    setItem: async (name: string, value: string): Promise<void> => {
        if (dbInitFailed) {
            console.warn(`[IndexedDB] setItem(${name}): DB init failed, skipping persist`)
            return
        }

        // Store latest value (always keep the newest)
        pendingWriteValues.set(name, value)

        // Clear existing debounce timer
        const existingTimer = pendingWriteTimers.get(name)
        if (existingTimer) clearTimeout(existingTimer)

        // Check if we need to force-write (prevent starvation during rapid changes)
        const lastWrite = lastWriteTime.get(name) ?? 0
        const elapsed = Date.now() - lastWrite

        if (elapsed >= MAX_WRITE_INTERVAL) {
            // Too long since last write — flush immediately
            pendingWriteTimers.delete(name)
            const val = pendingWriteValues.get(name)!
            pendingWriteValues.delete(name)
            lastWriteTime.set(name, Date.now())
            await rawSetItem(name, val)
            return
        }

        // Schedule debounced write
        const debounceMs = WRITE_DEBOUNCE_MS[name] ?? DEFAULT_WRITE_DEBOUNCE
        const timer = setTimeout(async () => {
            pendingWriteTimers.delete(name)
            const val = pendingWriteValues.get(name)
            if (val !== undefined) {
                pendingWriteValues.delete(name)
                lastWriteTime.set(name, Date.now())
                try {
                    await rawSetItem(name, val)
                } catch (err) {
                    console.error(`[IndexedDB] Debounced write failed for ${name}:`, err)
                }
            }
        }, debounceMs)

        pendingWriteTimers.set(name, timer)
    },
    
    removeItem: async (name: string): Promise<void> => {
        if (dbInitFailed) {
            console.warn(`[IndexedDB] removeItem(${name}): DB init failed, skipping`)
            return
        }
        
        try {
            const db = await getDb()
            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    console.error(`[IndexedDB] removeItem(${name}): Operation timed out`)
                    reject(new Error(`removeItem timed out for key: ${name}`))
                }, OPERATION_TIMEOUT_MS)
                
                try {
                    const transaction = db.transaction(STORE_NAME, 'readwrite')
                    
                    transaction.onerror = () => {
                        clearTimeout(timeoutId)
                        reject(transaction.error)
                    }
                    
                    transaction.onabort = () => {
                        clearTimeout(timeoutId)
                        reject(new Error('Transaction aborted'))
                    }
                    
                    transaction.oncomplete = () => {
                        clearTimeout(timeoutId)
                        resolve()
                    }
                    
                    const store = transaction.objectStore(STORE_NAME)
                    const request = store.delete(name)
                    
                    request.onerror = () => {
                        clearTimeout(timeoutId)
                        reject(request.error)
                    }
                } catch (err) {
                    clearTimeout(timeoutId)
                    throw err
                }
            })
        } catch (err) {
            console.error(`[IndexedDB] removeItem(${name}): Failed`, err)
        }
    },
}

/**
 * 특정 키의 데이터 크기가 너무 크면 정리
 * (대용량 wildcard 데이터 마이그레이션 이슈 해결용)
 */
export async function cleanupLargeData(key: string, maxSizeKB: number = 100): Promise<boolean> {
    try {
        const data = await indexedDBStorage.getItem(key)
        if (data && data.length > maxSizeKB * 1024) {
            console.warn(`[IndexedDB] ${key} data is too large (${(data.length / 1024).toFixed(1)}KB), cleaning up...`)
            
            // JSON 파싱해서 content 필드 제거
            try {
                const parsed = JSON.parse(data)
                if (parsed.state?.files) {
                    parsed.state.files = parsed.state.files.map((f: any) => {
                        const { content, ...meta } = f
                        return {
                            ...meta,
                            lineCount: Array.isArray(content) ? content.length : (meta.lineCount || 0)
                        }
                    })
                    parsed.state._migrated = true
                    await indexedDBStorage.setItem(key, JSON.stringify(parsed))
                    console.log(`[IndexedDB] ${key} cleaned up successfully`)
                    return true
                }
            } catch {
                // JSON 파싱 실패하면 그냥 삭제
                await indexedDBStorage.removeItem(key)
                console.log(`[IndexedDB] ${key} removed due to parse error`)
                return true
            }
        }
        return false
    } catch (error) {
        console.error('[IndexedDB] cleanup error:', error)
        return false
    }
}

/**
 * IndexedDB 내부에서 스토어 이름 변경 마이그레이션
 * 기존 이름의 데이터가 있고 새 이름에 데이터가 없으면 이동
 * 
 * @param renames - [oldName, newName] 배열
 */
export async function migrateIndexedDBKeys(renames: [string, string][]): Promise<void> {
    for (const [oldKey, newKey] of renames) {
        try {
            // 새 키에 이미 데이터가 있으면 스킵
            const newData = await indexedDBStorage.getItem(newKey)
            if (newData) {
                console.log(`[IndexedDB Migration] ${newKey}: Already has data, skipping`)
                // 기존 키 정리
                const oldData = await indexedDBStorage.getItem(oldKey)
                if (oldData) {
                    await indexedDBStorage.removeItem(oldKey)
                    console.log(`[IndexedDB Migration] ${oldKey}: Cleaned up old key`)
                }
                continue
            }

            // 기존 키에 데이터가 있는지 확인
            const oldData = await indexedDBStorage.getItem(oldKey)
            if (!oldData) {
                console.log(`[IndexedDB Migration] ${oldKey}: No data to migrate`)
                continue
            }

            // 새 키로 복사
            console.log(`[IndexedDB Migration] ${oldKey} → ${newKey}: Migrating ${oldData.length} bytes`)
            await indexedDBStorage.setItem(newKey, oldData)

            // 검증
            const verifyData = await indexedDBStorage.getItem(newKey)
            if (verifyData && verifyData.length === oldData.length) {
                // 검증 성공 - 기존 키 삭제
                await indexedDBStorage.removeItem(oldKey)
                console.log(`[IndexedDB Migration] ${oldKey} → ${newKey}: Complete`)
            } else {
                console.error(`[IndexedDB Migration] ${oldKey} → ${newKey}: Verification failed!`)
            }
        } catch (error) {
            console.error(`[IndexedDB Migration] ${oldKey} → ${newKey}: Failed`, error)
        }
    }
}

/**
 * localStorage에서 IndexedDB로 데이터 마이그레이션
 * 기존 localStorage 데이터가 있고 IndexedDB에 없으면 이동
 * 
 * CRITICAL: This MUST complete before Zustand stores initialize!
 */
export async function migrateFromLocalStorage(keys: string[]): Promise<void> {
    for (const key of keys) {
        try {
            // localStorage에 데이터가 있는지 확인
            const localData = localStorage.getItem(key)
            if (!localData) {
                console.log(`[Migration] ${key}: No localStorage data`)
                continue
            }

            // IndexedDB에 이미 데이터가 있는지 확인
            const indexedData = await indexedDBStorage.getItem(key)
            if (indexedData) {
                // 이미 IndexedDB에 데이터 있으면 localStorage 정리만
                console.log(`[Migration] ${key}: IndexedDB already has data, cleaning localStorage`)
                localStorage.removeItem(key)
                continue
            }

            // localStorage → IndexedDB 마이그레이션
            console.log(`[Migration] ${key}: Migrating ${localData.length} bytes from localStorage to IndexedDB`)
            await indexedDBStorage.setItem(key, localData)
            
            // 검증: 제대로 저장되었는지 확인
            const verifyData = await indexedDBStorage.getItem(key)
            if (verifyData && verifyData.length === localData.length) {
                // 검증 성공 - localStorage 정리
                localStorage.removeItem(key)
                console.log(`[Migration] ${key}: Migration verified and complete`)
            } else {
                // 검증 실패 - localStorage 유지 (데이터 손실 방지)
                console.error(`[Migration] ${key}: Verification failed! Keeping localStorage data`)
            }
        } catch (error) {
            console.error(`[Migration] ${key}: Migration failed, keeping localStorage data`, error)
            // 실패해도 localStorage 데이터는 유지 - 다음 시작에 다시 시도
        }
    }
}

/**
 * 전체 데이터 백업 (JSON export)
 * 데이터 손실 방지를 위한 수동 백업 기능
 * 재생성 가능한 캐시(encodedVibe, thumbnails)는 자동으로 제외됩니다.
 */
export async function exportAllData(): Promise<{ [key: string]: unknown }> {
    const keys = [
        'nais2-forge-generation',
        'nais2-forge-character-store',
        'nais2-forge-character-prompts',
        'nais2-forge-presets',
        'nais2-forge-settings',
        'nais2-forge-scenes',
        'nais2-forge-shortcuts',
        'nais2-forge-theme',
        'nais2-forge-wildcards',
        'nais2-forge-layout',
        'nais2-forge-library',
        'nais2-forge-tools',
    ]
    
    const backup: { [key: string]: unknown } = {
        _exportedAt: new Date().toISOString(),
        _version: '2.3',  // Version bump: always exclude regenerable cache
    }
    
    for (const key of keys) {
        try {
            const data = await indexedDBStorage.getItem(key)
            if (data) {
                let parsed = JSON.parse(data)
                
                // Always filter out regenerable cache data
                parsed = filterLargeImageData(key, parsed)
                
                backup[key] = parsed
            }
        } catch (err) {
            console.error(`[Backup] Failed to export ${key}:`, err)
        }
    }
    
    // Export wildcard-content from separate IndexedDB database
    try {
        const wildcardContent = await exportWildcardContent()
        if (Object.keys(wildcardContent).length > 0) {
            backup['nais2-forge-wildcard-content'] = wildcardContent
            console.log('[Backup] Wildcard content exported:', Object.keys(wildcardContent).length, 'files')
        }
    } catch (err) {
        console.error('[Backup] Failed to export wildcard content:', err)
    }
    
    console.log('[Backup] Export complete:', Object.keys(backup).length - 2, 'stores (regenerable cache excluded)')
    return backup
}

/**
 * Filter out large regenerable data from store data
 * IMPORTANT: Character/Vibe base64 images are NOT excluded because they have no file backup
 * Only excludes: encodedVibe (can be regenerated via API), history thumbnails (files exist)
 */
function filterLargeImageData(key: string, data: unknown): unknown {
    if (!data || typeof data !== 'object') return data
    
    const obj = data as Record<string, unknown>
    
    // Handle Zustand persist wrapper structure: { state: {...}, version: number }
    if ('state' in obj && 'version' in obj) {
        return {
            ...obj,
            state: filterLargeImageData(key, obj.state)
        }
    }
    
    switch (key) {
        case 'nais2-forge-character-store':
            // Only remove encodedVibe (can be regenerated via API)
            // KEEP base64 images - they have no file backup!
            return {
                ...obj,
                characterImages: Array.isArray(obj.characterImages) 
                    ? obj.characterImages.map((img: Record<string, unknown>) => ({
                        ...img,
                        // base64 is KEPT - no file backup exists
                        encodedVibe: undefined  // Can be regenerated via API
                    }))
                    : obj.characterImages,
                vibeImages: Array.isArray(obj.vibeImages)
                    ? obj.vibeImages.map((img: Record<string, unknown>) => ({
                        ...img,
                        // base64 is KEPT - no file backup exists
                        encodedVibe: undefined  // Can be regenerated via API
                    }))
                    : obj.vibeImages,
            }
            
        case 'nais2-forge-generation':
            // Filter history thumbnails (files exist) and temp images
            return {
                ...obj,
                history: Array.isArray(obj.history)
                    ? obj.history.map((item: Record<string, unknown>) => ({
                        ...item,
                        thumbnail: item.thumbnail && typeof item.thumbnail === 'string' && item.thumbnail.startsWith('data:')
                            ? '[THUMBNAIL_EXCLUDED]'
                            : item.thumbnail,
                    }))
                    : obj.history,
                sourceImage: null,
                previewImage: null,
                mask: null,
            }
            
        default:
            return data
    }
}

/**
 * Export all wildcard content from separate IndexedDB
 * Fixed: Race condition where getAllRequest might complete before handler is attached
 */
async function exportWildcardContent(): Promise<{ [id: string]: string[] }> {
    return new Promise((resolve, reject) => {
        // Add timeout to prevent infinite waiting
        const timeout = setTimeout(() => {
            console.error('[Backup] Wildcard export timed out after 30s')
            resolve({}) // Return empty instead of rejecting to allow backup to continue
        }, 30000)
        
        const request = indexedDB.open('nais2-forge-wildcard-content', 1)
        
        request.onerror = () => {
            clearTimeout(timeout)
            reject(request.error)
        }
        
        request.onsuccess = () => {
            const db = request.result
            if (!db.objectStoreNames.contains('contents')) {
                clearTimeout(timeout)
                resolve({})
                return
            }
            
            const transaction = db.transaction('contents', 'readonly')
            const store = transaction.objectStore('contents')
            const getAllRequest = store.getAll()
            const getAllKeysRequest = store.getAllKeys()
            
            const result: { [id: string]: string[] } = {}
            let keys: string[] = []
            let values: string[][] = []
            let keysReady = false
            let valuesReady = false
            
            const tryResolve = () => {
                if (keysReady && valuesReady) {
                    clearTimeout(timeout)
                    for (let i = 0; i < keys.length; i++) {
                        result[keys[i]] = values[i]
                    }
                    resolve(result)
                }
            }
            
            getAllKeysRequest.onsuccess = () => {
                keys = getAllKeysRequest.result as string[]
                keysReady = true
                tryResolve()
            }
            
            getAllRequest.onsuccess = () => {
                values = getAllRequest.result as string[][]
                valuesReady = true
                tryResolve()
            }
            
            transaction.onerror = () => {
                clearTimeout(timeout)
                reject(transaction.error)
            }
        }
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains('contents')) {
                db.createObjectStore('contents')
            }
        }
    })
}

/**
 * Import wildcard content to separate IndexedDB
 */
async function importWildcardContent(content: { [id: string]: string[] }): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('nais2-forge-wildcard-content', 1)
        
        request.onerror = () => reject(request.error)
        
        request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('contents', 'readwrite')
            const store = transaction.objectStore('contents')
            
            for (const [id, lines] of Object.entries(content)) {
                store.put(lines, id)
            }
            
            transaction.oncomplete = () => {
                console.log('[Restore] Wildcard content restored:', Object.keys(content).length, 'files')
                resolve()
            }
            transaction.onerror = () => reject(transaction.error)
        }
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains('contents')) {
                db.createObjectStore('contents')
            }
        }
    })
}

/**
 * 백업 데이터 복원
 * @param backup - exportAllData()로 생성된 백업 데이터
 * @param overwrite - true면 기존 데이터 덮어쓰기, false면 빈 키만 복원
 */
export async function importAllData(backup: { [key: string]: unknown }, overwrite = false): Promise<{ success: string[], failed: string[] }> {
    const result = { success: [] as string[], failed: [] as string[] }
    
    for (const [key, value] of Object.entries(backup)) {
        if (key.startsWith('_')) continue // 메타데이터 스킵
        
        // Handle wildcard-content separately (stored in separate IndexedDB)
        if (key === 'nais2-forge-wildcard-content') {
            try {
                await importWildcardContent(value as { [id: string]: string[] })
                result.success.push(key)
            } catch (err) {
                console.error(`[Restore] ${key}: Failed`, err)
                result.failed.push(key)
            }
            continue
        }
        
        try {
            if (!overwrite) {
                const existing = await indexedDBStorage.getItem(key)
                if (existing) {
                    console.log(`[Restore] ${key}: Skipping (data exists)`)
                    continue
                }
            }
            
            await indexedDBStorage.setItem(key, JSON.stringify(value))
            result.success.push(key)
            console.log(`[Restore] ${key}: Restored`)
        } catch (err) {
            console.error(`[Restore] ${key}: Failed`, err)
            result.failed.push(key)
        }
    }
    
    console.log('[Restore] Complete:', result.success.length, 'success,', result.failed.length, 'failed')
    return result
}

/**
 * 특정 스토어 데이터 크기 확인 (디버깅용)
 */
export async function getStoreSizes(): Promise<{ [key: string]: number }> {
    const keys = [
        'nais2-forge-generation',
        'nais2-forge-character-store',
        'nais2-forge-character-prompts',
        'nais2-forge-presets',
        'nais2-forge-settings',
        'nais2-forge-scenes',
        'nais2-forge-wildcards',
        'nais2-forge-library',
    ]
    
    const sizes: { [key: string]: number } = {}
    
    for (const key of keys) {
        try {
            const data = await indexedDBStorage.getItem(key)
            sizes[key] = data ? data.length : 0
        } catch {
            sizes[key] = -1 // 에러 표시
        }
    }
    
    return sizes
}
