import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ImageOutputFormat } from '@/components/ui/image-output-options'

export async function exportSceneZip(outputPath: string, entries: Array<{ source: string; fileName: string }>, format: ImageOutputFormat, quality: number, onProgress: (percent: number) => void) {
    const exportId = `scene-zip-${crypto.randomUUID()}`
    const unlisten = await listen<{ exportId: string; completed: number; total: number }>('scene-zip-progress', ({ payload }) => {
        if (payload.exportId === exportId && payload.total > 0) onProgress(Math.round(payload.completed / payload.total * 100))
    })
    try {
        return await invoke<{ exportedCount: number; skippedCount: number }>('export_scene_images_zip', {
            outputPath, entries, format, quality: format === 'webp' ? quality : 90, exportId,
        })
    } finally { unlisten() }
}
