import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { getUserInfo, verifyToken, type AnlasInfo } from '@/services/novelai-api'
import type { ImageGenerationEntitlement } from '@/lib/anlas-calculator'

interface AuthState {
    token: string
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    imageGenerationEntitlement: ImageGenerationEntitlement | null
    isLoading: boolean

    setToken: (token: string) => void
    verifyAndSave: (token: string) => Promise<boolean>
    refreshAnlas: () => Promise<void>
    clearToken: () => void
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: '',
            isVerified: false,
            tier: null,
            anlas: null,
            imageGenerationEntitlement: null,
            isLoading: false,

            setToken: (token) => set({ token }),

            verifyAndSave: async (token) => {
                set({ isLoading: true })

                const result = await verifyToken(token)

                if (result.valid) {
                    set({ token, isVerified: true, tier: result.tier || null, anlas: null, imageGenerationEntitlement: null })

                    // Fetch Anlas balance
                    const userInfo = await getUserInfo(token)
                    if (userInfo) {
                        set({ anlas: userInfo.anlas, imageGenerationEntitlement: userInfo.imageGenerationEntitlement })
                    }

                    set({ isLoading: false })
                    return true
                } else {
                    set({ isVerified: false, tier: null, anlas: null, imageGenerationEntitlement: null, isLoading: false })
                    return false
                }
            },

            refreshAnlas: async () => {
                const { token, isVerified } = get()
                if (!token || !isVerified) return

                const userInfo = await getUserInfo(token)
                if (userInfo) {
                    set({ anlas: userInfo.anlas, imageGenerationEntitlement: userInfo.imageGenerationEntitlement })
                }
            },

            clearToken: () => set({
                token: '',
                isVerified: false,
                tier: null,
                anlas: null,
                imageGenerationEntitlement: null,
            }),
        }),
        {
            name: 'nais2-forge-auth',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                token: state.token,
                isVerified: state.isVerified,
                tier: state.tier,
            }),
        }
    )
)
