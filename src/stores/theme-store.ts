import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
    theme: ThemeMode
    setTheme: (theme: ThemeMode) => void
}

export const useThemeStore = create<ThemeState>()(
    persist(
        (set) => ({
            theme: 'dark',
            setTheme: (theme) => {
                set({ theme })
                applyTheme(theme)
            },
        }),
        {
            name: 'nais2-forge-theme',
            storage: createJSONStorage(() => indexedDBStorage),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    applyTheme(state.theme)
                }
            },
        }
    )
)

function applyTheme(theme: ThemeMode) {
    const root = document.documentElement
    const systemDark = systemThemeQuery.matches

    if (theme === 'system') {
        root.classList.toggle('dark', systemDark)
    } else {
        root.classList.toggle('dark', theme === 'dark')
    }
}

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    if (useThemeStore.getState().theme === 'system') {
        document.documentElement.classList.toggle('dark', event.matches)
    }
}

systemThemeQuery.addEventListener('change', handleSystemThemeChange)
import.meta.hot?.dispose(() => {
    systemThemeQuery.removeEventListener('change', handleSystemThemeChange)
})
