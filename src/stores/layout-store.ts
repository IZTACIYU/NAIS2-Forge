import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

interface LayoutState {
    leftSidebarVisible: boolean
    rightSidebarVisible: boolean
    leftSidebarWidth: number
    rightSidebarWidth: number
    toggleLeftSidebar: () => void
    toggleRightSidebar: () => void
    setLeftSidebarVisible: (visible: boolean) => void
    setRightSidebarVisible: (visible: boolean) => void
    setLeftSidebarWidth: (width: number) => void
    setRightSidebarWidth: (width: number) => void
}

export const useLayoutStore = create<LayoutState>()(
    persist(
        (set) => ({
            leftSidebarVisible: true,
            rightSidebarVisible: true,
            leftSidebarWidth: 460,
            rightSidebarWidth: 280,
            toggleLeftSidebar: () => set((state) => ({ leftSidebarVisible: !state.leftSidebarVisible })),
            toggleRightSidebar: () => set((state) => ({ rightSidebarVisible: !state.rightSidebarVisible })),
            setLeftSidebarVisible: (visible) => set({ leftSidebarVisible: visible }),
            setRightSidebarVisible: (visible) => set({ rightSidebarVisible: visible }),
            setLeftSidebarWidth: (width) => set({ leftSidebarWidth: Math.min(680, Math.max(340, Math.round(width))) }),
            setRightSidebarWidth: (width) => set({ rightSidebarWidth: Math.min(480, Math.max(220, Math.round(width))) }),
        }),
        {
            name: 'nais2-forge-layout',
            storage: createJSONStorage(() => indexedDBStorage),
        }
    )
)
