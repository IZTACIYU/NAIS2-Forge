import { getVersion } from '@tauri-apps/api/app'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { fetch } from '@tauri-apps/plugin-http'

const UPDATE_MANIFEST_URL = 'https://github.com/IZTACIYU/NAIS2-Forge/releases/latest/download/latest.json'

interface UpdateManifest {
    version?: string
    platforms?: Record<string, { url?: string; signature?: string }>
}

function compareVersions(a: string, b: string): number {
    const left = a.replace(/^v/, '').split('.').map(Number)
    const right = b.replace(/^v/, '').split('.').map(Number)
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] || 0) - (right[index] || 0)
        if (difference !== 0) return difference > 0 ? 1 : -1
    }
    return 0
}

async function readLatestManifest(): Promise<UpdateManifest | null> {
    try {
        const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' })
        if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
        const manifest = await response.json() as UpdateManifest
        const windows = manifest.platforms?.['windows-x86_64']
        if (!manifest.version || !windows?.url || !windows.signature) {
            throw new Error('The update manifest is incomplete')
        }
        return manifest
    } catch (error) {
        console.warn('[Update] Manifest preflight failed; falling back to Tauri updater:', error)
        return null
    }
}

export async function checkForAppUpdate(): Promise<Update | null> {
    const [currentVersion, manifest] = await Promise.all([getVersion(), readLatestManifest()])
    if (manifest?.version && compareVersions(manifest.version, currentVersion) <= 0) return null
    return check({ timeout: 20_000 })
}
