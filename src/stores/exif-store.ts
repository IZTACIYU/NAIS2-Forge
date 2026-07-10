import { create } from 'zustand'

interface ExifState {
    activeImage: string | null
    sourceName: string
    setSource: (image: string, name?: string) => void
    clearSource: () => void
}

export const useExifStore = create<ExifState>((set) => ({
    activeImage: null,
    sourceName: '',
    setSource: (activeImage, sourceName = '') => set({ activeImage, sourceName }),
    clearSource: () => set({ activeImage: null, sourceName: '' }),
}))
