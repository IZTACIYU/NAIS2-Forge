import { useEffect, useRef, useState } from 'react'

const DEFAULT_ROOT_MARGIN = '800px 0px'

export function useNearViewport<T extends Element>(rootMargin = DEFAULT_ROOT_MARGIN, enabled = true) {
    const elementRef = useRef<T | null>(null)
    const [isNearViewport, setIsNearViewport] = useState(false)

    useEffect(() => {
        if (!enabled) {
            setIsNearViewport(true)
            return
        }

        const element = elementRef.current
        if (!element) return

        if (!('IntersectionObserver' in window)) {
            setIsNearViewport(true)
            return
        }

        const scrollRoot = element.closest('.custom-scrollbar')
        const observer = new IntersectionObserver(
            ([entry]) => setIsNearViewport(entry.isIntersecting),
            {
                root: scrollRoot,
                rootMargin,
                threshold: 0,
            }
        )

        observer.observe(element)
        return () => observer.disconnect()
    }, [enabled, rootMargin])

    return [elementRef, isNearViewport] as const
}
