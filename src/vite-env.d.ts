/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    readonly VITE_REMOTE_WEB_URL?: string
    readonly VITE_REMOTE_RELAY_URL?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
