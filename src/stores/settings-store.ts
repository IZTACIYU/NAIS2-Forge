import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import type { SceneRandomCharacterMode } from '@/lib/random-character-selection'
import type { CharacterGender } from '@/lib/character-gender'

export interface CustomResolution {
    id: string
    label: string
    width: number
    height: number
}

interface SettingsState {
    // Save settings
    savePath: string
    useAbsolutePath: boolean  // If true, savePath is absolute path; if false, relative to Pictures folder
    autoSave: boolean

    // Custom resolution presets
    customResolutions: CustomResolution[]

    // UI settings
    promptFontSize: number
    basePromptCollapsed: boolean  // 기본 프롬프트 접기 상태
    additionalPromptCollapsed: boolean  // 추가 프롬프트 접기 상태
    detailPromptCollapsed: boolean  // 세부 프롬프트 접기 상태
    negativePromptCollapsed: boolean  // 네거티브 프롬프트 접기 상태

    // Generation settings
    useStreaming: boolean  // Use streaming API for image generation
    generationDelay: number  // Delay between batch generations in ms (0-5000)

    // Gemini API settings
    geminiApiKey: string

    // Library settings
    libraryPath: string
    useAbsoluteLibraryPath: boolean

    // Image format setting
    imageFormat: 'png' | 'webp'

    // Expert options
    expertOptionsEnabled: boolean
    expertCharacterPromptFolderBrowserEnabled: boolean
    expertLibraryFolderBrowserEnabled: boolean
    expertCharacterPromptLayoutEnabled: boolean
    expertCharacterPromptVariantsEnabled: boolean
    expertCharacterPromptGenderIndicatorEnabled: boolean
    characterPromptGenderIndicatorMode: 'icon' | 'header'
    expertSceneCharacterVariantOverrideEnabled: boolean
    expertSceneCharacterCostumeOverrideEnabled: boolean
    expertSceneCharacterRepeatEnabled: boolean
    expertSceneCharacterAdditionsEnabled: boolean
    expertSceneRandomCharactersEnabled: boolean
    sceneRandomCharactersActive: boolean
    sceneRandomCharacterMode: SceneRandomCharacterMode
    sceneRandomCharacterCount: number
    sceneRandomCharacterIds: string[]
    sceneRandomCharacterGroupIds: string[]
    sceneRandomCharacterGender: 'all' | CharacterGender
    expertExifDirectActionEnabled: boolean
    expertExifManagerEnabled: boolean
    expertExifQuickActionEnabled: boolean
    expertExifAutoSaveEnabled: boolean
    exifAutoSaveName: string
    exifAutoSavePath: string
    exifOutputFormat: 'jpeg' | 'png' | 'webp'
    expertR2DirectUploadEnabled: boolean
    expertR2ExifRemovalEnabled: boolean
    expertCloudR2Enabled: boolean
    r2ViewMode: 'folders' | 'list' | 'thumbnails'

    // R2 settings
    r2AccountId: string
    r2AccessKeyId: string
    r2SecretAccessKey: string
    r2Bucket: string
    r2PublicBaseUrl: string

    // Actions
    setSavePath: (path: string, useAbsolute?: boolean) => void
    setAutoSave: (autoSave: boolean) => void
    addCustomResolution: (resolution: Omit<CustomResolution, 'id'>) => void
    removeCustomResolution: (id: string) => void
    setPromptFontSize: (size: number) => void
    setBasePromptCollapsed: (collapsed: boolean) => void
    setAdditionalPromptCollapsed: (collapsed: boolean) => void
    setDetailPromptCollapsed: (collapsed: boolean) => void
    setNegativePromptCollapsed: (collapsed: boolean) => void
    setUseStreaming: (useStreaming: boolean) => void
    setGenerationDelay: (delay: number) => void
    setGeminiApiKey: (key: string) => void
    setLibraryPath: (path: string, useAbsolute?: boolean) => void
    setImageFormat: (format: 'png' | 'webp') => void
    setExpertOptionsEnabled: (enabled: boolean) => void
    setExpertCharacterPromptFolderBrowserEnabled: (enabled: boolean) => void
    setExpertLibraryFolderBrowserEnabled: (enabled: boolean) => void
    setExpertCharacterPromptLayoutEnabled: (enabled: boolean) => void
    setExpertCharacterPromptVariantsEnabled: (enabled: boolean) => void
    setExpertCharacterPromptGenderIndicatorEnabled: (enabled: boolean) => void
    setCharacterPromptGenderIndicatorMode: (mode: 'icon' | 'header') => void
    setExpertSceneCharacterVariantOverrideEnabled: (enabled: boolean) => void
    setExpertSceneCharacterCostumeOverrideEnabled: (enabled: boolean) => void
    setExpertSceneCharacterRepeatEnabled: (enabled: boolean) => void
    setExpertSceneCharacterAdditionsEnabled: (enabled: boolean) => void
    setExpertSceneRandomCharactersEnabled: (enabled: boolean) => void
    setSceneRandomCharacterConfig: (config: Partial<Pick<SettingsState, 'sceneRandomCharactersActive' | 'sceneRandomCharacterMode' | 'sceneRandomCharacterCount' | 'sceneRandomCharacterIds' | 'sceneRandomCharacterGroupIds' | 'sceneRandomCharacterGender'>>) => void
    setExpertExifDirectActionEnabled: (enabled: boolean) => void
    setExpertExifManagerEnabled: (enabled: boolean) => void
    setExpertExifQuickActionEnabled: (enabled: boolean) => void
    setExpertExifAutoSaveEnabled: (enabled: boolean) => void
    setExifAutoSaveName: (name: string) => void
    setExifAutoSavePath: (path: string) => void
    setExifOutputFormat: (format: 'jpeg' | 'png' | 'webp') => void
    setExpertR2DirectUploadEnabled: (enabled: boolean) => void
    setExpertR2ExifRemovalEnabled: (enabled: boolean) => void
    setExpertCloudR2Enabled: (enabled: boolean) => void
    setR2ViewMode: (mode: 'folders' | 'list' | 'thumbnails') => void
    setR2Config: (config: Partial<Pick<SettingsState, 'r2AccountId' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2Bucket' | 'r2PublicBaseUrl'>>) => void
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            savePath: 'NAIS_Output',
            useAbsolutePath: false,  // Default: relative to Pictures folder
            autoSave: true,
            customResolutions: [],
            promptFontSize: 16, // Default text-base equivalent approximately
            basePromptCollapsed: false, // Default: expanded
            additionalPromptCollapsed: false, // Default: expanded
            detailPromptCollapsed: false, // Default: expanded
            negativePromptCollapsed: false, // Default: expanded
            useStreaming: true, // Default: enabled
            generationDelay: 500, // Default: 500ms delay between batch generations
            geminiApiKey: '', // Default: empty
            libraryPath: 'NAIS_Library', // Default: relative to Pictures folder
            useAbsoluteLibraryPath: false, // Default: relative to Pictures folder
            imageFormat: 'png', // Default: PNG format
            expertOptionsEnabled: false,
            expertCharacterPromptFolderBrowserEnabled: true,
            expertLibraryFolderBrowserEnabled: false,
            expertCharacterPromptLayoutEnabled: false,
            expertCharacterPromptVariantsEnabled: false,
            expertCharacterPromptGenderIndicatorEnabled: false,
            characterPromptGenderIndicatorMode: 'icon',
            expertSceneCharacterVariantOverrideEnabled: false,
            expertSceneCharacterCostumeOverrideEnabled: false,
            expertSceneCharacterRepeatEnabled: false,
            expertSceneCharacterAdditionsEnabled: false,
            expertSceneRandomCharactersEnabled: false,
            sceneRandomCharactersActive: false,
            sceneRandomCharacterMode: 'all',
            sceneRandomCharacterCount: 1,
            sceneRandomCharacterIds: [],
            sceneRandomCharacterGroupIds: [],
            sceneRandomCharacterGender: 'all',
            expertExifDirectActionEnabled: false,
            expertExifManagerEnabled: false,
            expertExifQuickActionEnabled: false,
            expertExifAutoSaveEnabled: false,
            exifAutoSaveName: 'exif_cleaned',
            exifAutoSavePath: 'NAIS_EXIF',
            exifOutputFormat: 'jpeg',
            expertR2DirectUploadEnabled: false,
            expertR2ExifRemovalEnabled: false,
            expertCloudR2Enabled: false,
            r2ViewMode: 'list',
            r2AccountId: '',
            r2AccessKeyId: '',
            r2SecretAccessKey: '',
            r2Bucket: '',
            r2PublicBaseUrl: '',

            setSavePath: (savePath, useAbsolute) => set({
                savePath,
                useAbsolutePath: useAbsolute ?? false
            }),
            setAutoSave: (autoSave) => set({ autoSave }),

            addCustomResolution: (resolution) => set((state) => ({
                customResolutions: [
                    ...state.customResolutions,
                    { ...resolution, id: Date.now().toString() }
                ]
            })),

            removeCustomResolution: (id) => set((state) => ({
                customResolutions: state.customResolutions.filter(r => r.id !== id)
            })),
            setPromptFontSize: (size) => set({ promptFontSize: size }),
            setBasePromptCollapsed: (collapsed) => set({ basePromptCollapsed: collapsed }),
            setAdditionalPromptCollapsed: (collapsed) => set({ additionalPromptCollapsed: collapsed }),
            setDetailPromptCollapsed: (collapsed) => set({ detailPromptCollapsed: collapsed }),
            setNegativePromptCollapsed: (collapsed) => set({ negativePromptCollapsed: collapsed }),
            setUseStreaming: (useStreaming) => set({ useStreaming }),
            setGenerationDelay: (delay) => set({ generationDelay: Math.max(0, Math.min(5000, delay)) }),
            setGeminiApiKey: (key) => set({ geminiApiKey: key }),
            setLibraryPath: (libraryPath, useAbsolute) => set({
                libraryPath,
                useAbsoluteLibraryPath: useAbsolute ?? false
            }),
            setImageFormat: (format) => set({ imageFormat: format }),
            setExpertOptionsEnabled: (expertOptionsEnabled) => set({ expertOptionsEnabled }),
            setExpertCharacterPromptFolderBrowserEnabled: (expertCharacterPromptFolderBrowserEnabled) => set({ expertCharacterPromptFolderBrowserEnabled }),
            setExpertLibraryFolderBrowserEnabled: (expertLibraryFolderBrowserEnabled) => set({ expertLibraryFolderBrowserEnabled }),
            setExpertCharacterPromptLayoutEnabled: (expertCharacterPromptLayoutEnabled) => set({ expertCharacterPromptLayoutEnabled }),
            setExpertCharacterPromptVariantsEnabled: (expertCharacterPromptVariantsEnabled) => set({ expertCharacterPromptVariantsEnabled }),
            setExpertCharacterPromptGenderIndicatorEnabled: (expertCharacterPromptGenderIndicatorEnabled) => set({ expertCharacterPromptGenderIndicatorEnabled }),
            setCharacterPromptGenderIndicatorMode: (characterPromptGenderIndicatorMode) => set({ characterPromptGenderIndicatorMode }),
            setExpertSceneCharacterVariantOverrideEnabled: (expertSceneCharacterVariantOverrideEnabled) => set({ expertSceneCharacterVariantOverrideEnabled }),
            setExpertSceneCharacterCostumeOverrideEnabled: (expertSceneCharacterCostumeOverrideEnabled) => set({ expertSceneCharacterCostumeOverrideEnabled }),
            setExpertSceneCharacterRepeatEnabled: (expertSceneCharacterRepeatEnabled) => set({ expertSceneCharacterRepeatEnabled }),
            setExpertSceneCharacterAdditionsEnabled: (expertSceneCharacterAdditionsEnabled) => set({ expertSceneCharacterAdditionsEnabled }),
            setExpertSceneRandomCharactersEnabled: (expertSceneRandomCharactersEnabled) => set({ expertSceneRandomCharactersEnabled }),
            setSceneRandomCharacterConfig: (config) => set(config),
            setExpertExifDirectActionEnabled: (expertExifDirectActionEnabled) => set({ expertExifDirectActionEnabled }),
            setExpertExifManagerEnabled: (expertExifManagerEnabled) => set({ expertExifManagerEnabled }),
            setExpertExifQuickActionEnabled: (expertExifQuickActionEnabled) => set({ expertExifQuickActionEnabled }),
            setExpertExifAutoSaveEnabled: (expertExifAutoSaveEnabled) => set({ expertExifAutoSaveEnabled }),
            setExifAutoSaveName: (exifAutoSaveName) => set({ exifAutoSaveName }),
            setExifAutoSavePath: (exifAutoSavePath) => set({ exifAutoSavePath }),
            setExifOutputFormat: (exifOutputFormat) => set({ exifOutputFormat }),
            setExpertR2DirectUploadEnabled: (expertR2DirectUploadEnabled) => set({ expertR2DirectUploadEnabled }),
            setExpertR2ExifRemovalEnabled: (expertR2ExifRemovalEnabled) => set({ expertR2ExifRemovalEnabled }),
            setExpertCloudR2Enabled: (expertCloudR2Enabled) => set({ expertCloudR2Enabled }),
            setR2ViewMode: (r2ViewMode) => set({ r2ViewMode }),
            setR2Config: (config) => set(config),
        }),
        {
            name: 'nais2-forge-settings',
            storage: createJSONStorage(() => indexedDBStorage),
            onRehydrateStorage: () => (state, error) => {
                if (error) {
                    console.error('[SettingsStore] Hydration failed:', error)
                    return
                }
                if (state) {
                    console.log('[SettingsStore] Hydrated successfully')
                }
            },
        }
    )
)
