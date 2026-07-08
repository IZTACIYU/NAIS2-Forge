import { invoke } from '@tauri-apps/api/core'

export interface R2Config {
    accountId: string
    accessKeyId: string
    secretAccessKey: string
    bucket: string
}

export interface R2ObjectInfo {
    key: string
    name: string
    size: number
    last_modified?: string | null
    is_folder: boolean
}

export interface R2ListResult {
    folders: R2ObjectInfo[]
    files: R2ObjectInfo[]
}

const toBackendConfig = (config: R2Config) => ({
    account_id: config.accountId.trim(),
    access_key_id: config.accessKeyId.trim(),
    secret_access_key: config.secretAccessKey,
    bucket: config.bucket.trim(),
})

export const hasR2Config = (config: R2Config) =>
    !!config.accountId.trim() && !!config.accessKeyId.trim() && !!config.secretAccessKey && !!config.bucket.trim()

export async function listR2Objects(config: R2Config, prefix = ''): Promise<R2ListResult> {
    return invoke<R2ListResult>('r2_list_objects', { config: toBackendConfig(config), prefix })
}

export async function uploadR2Object(config: R2Config, key: string, contentBase64: string, contentType?: string): Promise<void> {
    return invoke('r2_put_object', { config: toBackendConfig(config), key, contentBase64, contentType })
}

export async function deleteR2Object(config: R2Config, key: string): Promise<void> {
    return invoke('r2_delete_object', { config: toBackendConfig(config), key })
}

export async function deleteR2Prefix(config: R2Config, prefix: string): Promise<void> {
    return invoke('r2_delete_prefix', { config: toBackendConfig(config), prefix })
}

export async function createR2Folder(config: R2Config, key: string): Promise<void> {
    return invoke('r2_create_folder', { config: toBackendConfig(config), key })
}
