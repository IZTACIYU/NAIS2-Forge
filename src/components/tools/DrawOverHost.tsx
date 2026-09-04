import { useState } from 'react'
import { DrawOverDialog } from '@/components/tools/DrawOverDialog'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { findSceneImageOwner, getSceneFolderFromImages } from '@/lib/scene-path'
import { SCENE_IMAGE_GENERATED_EVENT } from '@/lib/scene-review-generation'
import { useGenerationStore } from '@/stores/generation-store'
import { useSceneStore } from '@/stores/scene-store'
import { useToolsStore } from '@/stores/tools-store'

export function DrawOverHost() {
    const request = useToolsStore(state => state.drawOverRequest)
    const closeDrawOver = useToolsStore(state => state.closeDrawOver)
    const [inpaintImage, setInpaintImage] = useState<string | null>(null)
    const outputDirectory = request?.sourcePath
        ? getSceneFolderFromImages([{ url: request.sourcePath }])
        : undefined
    const sceneOwner = findSceneImageOwner(useSceneStore.getState().presets, request?.sourcePath)

    return (
        <>
            <DrawOverDialog
                open={!!request}
                sourceImage={request?.image || null}
                outputDirectory={outputDirectory}
                fileNamePrefix={sceneOwner ? 'NAIS_SCENE' : 'NAIS_DRAW'}
                onOpenChange={open => { if (!open) closeDrawOver() }}
                onSaved={path => {
                    const owner = findSceneImageOwner(useSceneStore.getState().presets, request?.sourcePath)
                    if (owner) useSceneStore.getState().addImageToScene(owner.presetId, owner.sceneId, path, outputDirectory)
                    window.dispatchEvent(new CustomEvent(SCENE_IMAGE_GENERATED_EVENT, {
                        detail: { path, presetId: owner?.presetId, sceneId: owner?.sceneId },
                    }))
                }}
                onTransfer={(image, target) => {
                    closeDrawOver()
                    const generation = useGenerationStore.getState()
                    generation.setMask(null)
                    generation.setSourceImage(image)
                    generation.setI2IMode(target === 'i2i' ? 'i2i' : null)
                    if (target === 'inpaint') setInpaintImage(image)
                }}
            />
            <InpaintingDialog
                open={!!inpaintImage}
                onOpenChange={open => { if (!open) setInpaintImage(null) }}
                sourceImage={inpaintImage}
            />
        </>
    )
}
