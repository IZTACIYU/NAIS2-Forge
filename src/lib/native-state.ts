import { invoke } from '@tauri-apps/api/core'

export interface NativeStateReadResult {
    available: boolean
    value: string | null
}

let unavailableWarningShown = false

function reportUnavailable(error: unknown) {
    if (unavailableWarningShown) return
    unavailableWarningShown = true
    console.warn('[NativeState] SQLite storage unavailable, using IndexedDB fallback:', error)
}

export async function readNativeState(key: string): Promise<NativeStateReadResult> {
    try {
        const value = await invoke<string | null>('state_db_get', { key })
        return { available: true, value }
    } catch (error) {
        reportUnavailable(error)
        return { available: false, value: null }
    }
}

export async function writeNativeState(key: string, value: string): Promise<boolean> {
    try {
        await invoke('state_db_set', { key, value })
        return true
    } catch (error) {
        reportUnavailable(error)
        return false
    }
}

export async function removeNativeState(key: string): Promise<boolean> {
    try {
        await invoke('state_db_remove', { key })
        return true
    } catch (error) {
        reportUnavailable(error)
        return false
    }
}
