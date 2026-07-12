import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from '@tauri-apps/plugin-notification'

export async function sendSystemNotification(title: string, body: string) {
    try {
        let granted = await isPermissionGranted()
        if (!granted) granted = (await requestPermission()) === 'granted'
        if (granted) sendNotification({ title, body })
    } catch (error) {
        console.warn('[Notification] Unable to send system notification:', error)
    }
}
