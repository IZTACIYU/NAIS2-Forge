import { useCallback, useRef, useState } from 'react'

const DEFAULT_ROOT_MARGIN = '800px 0px'

export function useNearViewport<T extends Element>(rootMargin = DEFAULT_ROOT_MARGIN, enabled = true) {
    const [isNearViewport, setIsNearViewport] = useState(false)
    const observedElementRef = useRef<T | null>(null)
    const observerRef = useRef<IntersectionObserver | null>(null)

    const elementRef = useCallback((element: T | null) => {
        observerRef.current?.disconnect()
        observerRef.current = null
        observedElementRef.current = element

        if (!element) return

        if (!enabled) {
            setIsNearViewport(true)
            return
        }

        if (!('IntersectionObserver' in window)) {
            setIsNearViewport(true)
            return
        }

        const scrollRoot = element.closest('.custom-scrollbar')
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (observedElementRef.current === element) {
                    setIsNearViewport(entry.isIntersecting)
                }
            },
            {
                root: scrollRoot,
                rootMargin,
                threshold: 0,
            }
        )

        observer.observe(element)
        observerRef.current = observer
    }, [enabled, rootMargin])

    return [elementRef, isNearViewport] as const
}
