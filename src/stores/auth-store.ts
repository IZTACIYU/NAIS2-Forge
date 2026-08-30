import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { getUserInfo, verifyToken, type AnlasInfo, type ImageGenerationUsage } from '@/services/novelai-api'
import type { ImageGenerationEntitlement } from '@/lib/anlas-calculator'
import { normalizeAuthTokenList } from '@/lib/auth-token-list'

interface AuthState {
    token: string
    tokens: string[]
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    imageGenerationEntitlement: ImageGenerationEntitlement | null
    imageGenerationUsage: ImageGenerationUsage | null
    isLoading: boolean

    setToken: (token: string) => void
    verifyAndSave: (token: string, tokens?: string[]) => Promise<boolean>
    removeToken: (token: string) => void
    refreshAnlas: () => Promise<void>
    clearToken: () => void
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: '',
            tokens: [],
            isVerified: false,
            tier: null,
            anlas: null,
            imageGenerationEntitlement: null,
            imageGenerationUsage: null,
            isLoading: false,

            setToken: (token) => set(state => ({
                token,
                tokens: normalizeAuthTokenList(token, state.tokens),
            })),

            verifyAndSave: async (token, tokens) => {
                const previous = get()
                set({ isLoading: true })

                const result = await verifyToken(token)

                if (result.valid) {
                    set({
                        token,
                        tokens: normalizeAuthTokenList(token, tokens ?? previous.tokens),
                        isVerified: true,
                        tier: result.tier || null,
                        anlas: null,
                        imageGenerationEntitlement: null,
                        imageGenerationUsage: null,
                    })

                    // Fetch Anlas balance
                    const userInfo = await getUserInfo(token)
                    if (userInfo) {
                        set({ anlas: userInfo.anlas, imageGenerationEntitlement: userInfo.imageGenerationEntitlement, imageGenerationUsage: userInfo.imageGenerationUsage })
                    }

                    set({ isLoading: false })
                    return true
                } else {
                    set(token === previous.token ? {
                        isVerified: false,
                        tier: null,
                        anlas: null,
                        imageGenerationEntitlement: null,
                        imageGenerationUsage: null,
                        isLoading: false,
                    } : { isLoading: false })
                    return false
                }
            },

            removeToken: (tokenToRemove) => set(state => state.token === tokenToRemove ? {} : ({
                tokens: state.tokens.filter(token => token !== tokenToRemove),
            })),

            refreshAnlas: async () => {
                const { token, isVerified } = get()
                if (!token || !isVerified) return

                const userInfo = await getUserInfo(token)
                if (userInfo) {
                    set({ anlas: userInfo.anlas, imageGenerationEntitlement: userInfo.imageGenerationEntitlement, imageGenerationUsage: userInfo.imageGenerationUsage })
                }
            },

            clearToken: () => set({
                token: '',
                tokens: [],
                isVerified: false,
                tier: null,
                anlas: null,
                imageGenerationEntitlement: null,
                imageGenerationUsage: null,
            }),
        }),
        {
            name: 'nais2-forge-auth',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                token: state.token,
                tokens: state.tokens,
                isVerified: state.isVerified,
                tier: state.tier,
            }),
        }
    )
)
