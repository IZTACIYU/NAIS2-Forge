import { getVersion } from '@tauri-apps/api/app'
import { join } from '@tauri-apps/api/path'
import { exists, mkdir, readDir, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { exportAllData, flushAllPendingWrites } from '@/lib/indexed-db'
import { useSettingsStore } from '@/stores/settings-store'
import { resolveConfiguredFolder } from '@/lib/storage-migration'

const BACKUP_DIRECTORY_NAME = 'NAIS_Backups'
const BACKUP_FILE_PREFIX = 'nais2-forge-update-backup-'
const MAX_UPDATE_BACKUPS = 3

function createBackupFileName(version: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    return `${BACKUP_FILE_PREFIX}v${version}-${timestamp}.json`
}

async function pruneOldBackups(directory: string): Promise<void> {
    const entries = await readDir(directory)
    const backups = entries
        .filter(entry => entry.isFile && entry.name?.startsWith(BACKUP_FILE_PREFIX) && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))

    while (backups.length > MAX_UPDATE_BACKUPS) {
        const oldest = backups.shift()
        if (!oldest?.name) break
        try {
            await remove(await join(directory, oldest.name))
        } catch (error) {
            // Keep the valid new backup if pruning an older file is unavailable.
            console.warn('[UpdateBackup] Failed to remove old backup:', error)
            break
        }
    }
}

export async function createUpdateBackup(): Promise<string> {
    const { savePath, useAbsolutePath } = useSettingsStore.getState()
    const outputDirectory = await resolveConfiguredFolder(savePath, useAbsolutePath, 'NAIS_Output')
    const backupDirectory = await join(outputDirectory, BACKUP_DIRECTORY_NAME)

    if (!(await exists(backupDirectory))) {
        await mkdir(backupDirectory, { recursive: true })
    }

    await flushAllPendingWrites()
    const backup = await exportAllData()
    const version = await getVersion()
    const backupPath = await join(backupDirectory, createBackupFileName(version))

    await writeTextFile(backupPath, JSON.stringify(backup, null, 2))
    await pruneOldBackups(backupDirectory)

    console.log(`[UpdateBackup] Created ${backupPath}`)
    return backupPath
}