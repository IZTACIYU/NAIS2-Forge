import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface InpaintComparisonControlProps {
    sourceImage: string
    mask: string
}

export function InpaintComparisonControl({ sourceImage, mask }: InpaintComparisonControlProps) {
    const [isComparing, setIsComparing] = useState(false)

    const startComparing = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setIsComparing(true)
    }

    const stopComparing = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
        setIsComparing(false)
    }

    return (
        <>
            {isComparing && (
                <div className="pointer-events-none absolute inset-0 z-10">
                    <img
                        src={sourceImage}
                        alt="Inpaint source"
                        className="h-full w-full object-contain"
                    />
                    <div
                        className="absolute inset-0 bg-white opacity-[0.43]"
                        style={{
                            maskImage: `url(\"${mask}\")`,
                            maskSize: 'contain',
                            maskPosition: 'center',
                            maskRepeat: 'no-repeat',
                            WebkitMaskImage: `url(\"${mask}\")`,
                            WebkitMaskSize: 'contain',
                            WebkitMaskPosition: 'center',
                            WebkitMaskRepeat: 'no-repeat',
                        }}
                    />
                </div>
            )}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="absolute bottom-4 right-4 z-20 h-9 gap-1.5 rounded-md border border-white/10 bg-black/45 px-3 text-xs font-semibold text-white opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-300 hover:bg-black/65 group-hover:opacity-100"
                onPointerDown={startComparing}
                onPointerUp={stopComparing}
                onPointerCancel={stopComparing}
                onLostPointerCapture={() => setIsComparing(false)}
                onContextMenu={(event) => event.preventDefault()}
            >
                <Star className={`h-3.5 w-3.5 ${isComparing ? '' : 'fill-current'}`} />
                OLD
            </Button>
        </>
    )
}
