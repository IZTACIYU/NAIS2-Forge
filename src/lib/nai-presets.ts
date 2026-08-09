export type UcPreset = 0 | 1 | 2 | 3 | 4

type PresetTexts = Partial<Record<UcPreset, string>>

export const QUALITY_TAGS: Record<string, string> = {
    'nai-diffusion-4-5-full': ', very aesthetic, masterpiece, no text',
    'nai-diffusion-4-5-curated': ', very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
    'nai-diffusion-4-full': ', no text, best quality, very aesthetic, absurdres',
    'nai-diffusion-4-curated-preview': ', rating:general, best quality, very aesthetic, absurdres',
    'nai-diffusion-3': ', best quality, amazing quality, very aesthetic, absurdres',
    'nai-diffusion-furry-3': ', {best quality}, {amazing quality}',
}

export const UC_PRESETS: Record<string, PresetTexts> = {
    'nai-diffusion-4-5-full': {
        0: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        1: 'nsfw, lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
        2: 'nsfw, {worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
        3: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
    },
    'nai-diffusion-4-5-curated': {
        0: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        1: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
        3: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
    },
    'nai-diffusion-4-full': {
        0: 'nsfw, blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
        1: 'nsfw, blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    },
    'nai-diffusion-4-curated-preview': {
        0: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
        1: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    },
    'nai-diffusion-3': {
        0: 'nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
        1: 'nsfw, lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
        3: 'nsfw, lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes',
    },
    'nai-diffusion-furry-3': {
        0: 'nsfw, {{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast',
        1: 'nsfw, {worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text',
    },
}

export const mergeQualityTags = (prompt: string, model: string, enabled: boolean) => {
    if (!enabled) return prompt
    const suffix = QUALITY_TAGS[model]
    return suffix ? prompt + suffix : prompt
}

export const mergeUcPreset = (negativePrompt: string, model: string, preset: number) => {
    const prefix = UC_PRESETS[model]?.[preset as UcPreset]
    if (!prefix) return negativePrompt
    return negativePrompt ? prefix + ', ' + negativePrompt : prefix
}
