import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import { getUserInfo, verifyToken, type AnlasInfo, type ImageGenerationUsage } from '@/services/novelai-api'
import type { ImageGenerationEntitlement } from '@/lib/anlas-calculator'
import {
    getAuthRotationCandidates,
    normalizeAuthTokenList,
    shouldRotateAuthAccount,
    shouldRetryWithNextAuthAccount,
    updateAuthRotationOrder,
} from '@/lib/auth-token-list'

let successfulImagesWithActiveAccount = 0
let accountRotationOrder: string[] = []
let accountRotationPromise: Promise<string> | null = null

interface AccountGenerationResult {
    success: boolean
    imageData?: string
    httpStatus?: number
}

interface AuthState {
    token: string
    tokens: string[]
    isVerified: boolean
    tier: string | null
    anlas: AnlasInfo | null
    imageGenerationEntitlement: ImageGenerationEntitlement | null
    imageGenerationUsage: ImageGenerationUsage | null
    isLoading: boolean
    accountRotationEnabled: boolean
    accountRotationImages: number
    accountRotationSkipDepleted: boolean

    setToken: (token: string) => void
    verifyAndSave: (token: string, tokens?: string[]) => Promise<boolean>
    removeToken: (token: string) => void
    setAccountRotationConfig: (config: Partial<Pick<AuthState, 'accountRotationEnabled' | 'accountRotationImages' | 'accountRotationSkipDepleted'>>) => void
    prepareGenerationToken: () => Promise<string>
    recordGenerationSuccess: () => void
    runGenerationWithAccountFallback: <T extends AccountGenerationResult>(request: (token: string) => Promise<T>) => Promise<T>
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
            accountRotationEnabled: false,
            accountRotationImages: 1,
            accountRotationSkipDepleted: true,

            setToken: (token) => {
                successfulImagesWithActiveAccount = 0
                set(state => ({
                    token,
                    tokens: normalizeAuthTokenList(token, state.tokens),
                }))
            },

            verifyAndSave: async (token, tokens) => {
                const previous = get()
                set({ isLoading: true })

                const result = await verifyToken(token)

                if (result.valid) {
                    successfulImagesWithActiveAccount = 0
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

            setAccountRotationConfig: (config) => {
                successfulImagesWithActiveAccount = 0
                accountRotationOrder = []
                set({
                    ...config,
                    ...(config.accountRotationImages === undefined ? {} : {
                        accountRotationImages: Math.max(1, Math.min(999, Math.floor(config.accountRotationImages) || 1)),
                    }),
                })
            },

            prepareGenerationToken: async () => {
                if (accountRotationPromise) return accountRotationPromise
                accountRotationPromise = (async () => {
                    const state = get()
                    accountRotationOrder = updateAuthRotationOrder(accountRotationOrder, state.token, state.tokens)
                    if (!shouldRotateAuthAccount(
                        state.accountRotationEnabled,
                        successfulImagesWithActiveAccount,
                        state.accountRotationImages,
                        accountRotationOrder.length,
                    )) return state.token

                    for (const candidate of getAuthRotationCandidates(state.token, accountRotationOrder)) {
                        if (await get().verifyAndSave(candidate, accountRotationOrder)) return candidate
                    }

                    successfulImagesWithActiveAccount = 0
                    return get().token
                })()
                try {
                    return await accountRotationPromise
                } finally {
                    accountRotationPromise = null
                }
            },

            recordGenerationSuccess: () => {
                if (get().accountRotationEnabled) successfulImagesWithActiveAccount += 1
            },

            runGenerationWithAccountFallback: async (request) => {
                let generationToken = await get().prepareGenerationToken()
                let result = await request(generationToken)
                if (result.success && result.imageData) {
                    get().recordGenerationSuccess()
                    return result
                }

                accountRotationOrder = updateAuthRotationOrder(accountRotationOrder, generationToken, get().tokens)
                if (!shouldRetryWithNextAuthAccount(
                    get().accountRotationEnabled,
                    get().accountRotationSkipDepleted,
                    result.httpStatus,
                    accountRotationOrder.length,
                )) return result

                for (const candidate of getAuthRotationCandidates(generationToken, accountRotationOrder)) {
                    if (!get().accountRotationEnabled || !get().accountRotationSkipDepleted) return result
                    if (!await get().verifyAndSave(candidate, accountRotationOrder)) continue

                    generationToken = candidate
                    result = await request(generationToken)
                    if (result.success && result.imageData) {
                        get().recordGenerationSuccess()
                        return result
                    }
                    if (result.httpStatus !== 402) return result
                }

                return result
            },

            refreshAnlas: async () => {
                const { token, isVerified } = get()
                if (!token || !isVerified) return

                const userInfo = await getUserInfo(token)
                if (userInfo) {
                    set({ anlas: userInfo.anlas, imageGenerationEntitlement: userInfo.imageGenerationEntitlement, imageGenerationUsage: userInfo.imageGenerationUsage })
                }
            },

            clearToken: () => {
                successfulImagesWithActiveAccount = 0
                accountRotationOrder = []
                set({
                    token: '',
                    tokens: [],
                    isVerified: false,
                    tier: null,
                    anlas: null,
                    imageGenerationEntitlement: null,
                    imageGenerationUsage: null,
                })
            },
        }),
        {
            name: 'nais2-forge-auth',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                token: state.token,
                tokens: state.tokens,
                isVerified: state.isVerified,
                tier: state.tier,
                accountRotationEnabled: state.accountRotationEnabled,
                accountRotationImages: state.accountRotationImages,
                accountRotationSkipDepleted: state.accountRotationSkipDepleted,
            }),
        }
    )
)
