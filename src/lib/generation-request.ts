import type { GenerationParams } from '@/services/novelai-api'
import type { ReferenceImage } from '@/stores/character-store'
import type { CharacterPrompt } from '@/stores/character-prompt-store'
import type { Nais2GenerationSources } from '@/lib/nais2-png-meta'
import { processWildcards } from '@/lib/fragment-processor'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { mergeQualityTags, mergeUcPreset } from '@/lib/nai-presets'
import { removePromptComments } from '@/lib/prompt-comments'
import { splitCostumePrompt } from '@/lib/costume-prompt'
import {
    formatPromptWhitespace,
    removeExactEmptyPromptSeparators,
    type PromptWhitespaceMode,
} from '@/lib/prompt-formatting'

export interface GenerationCharacterInput {
    character: CharacterPrompt
    appendedPrompts?: string[]
    costumeEnabled?: boolean
    position?: { x: number, y: number }
}

export interface GenerationPromptPart {
    value: string | null | undefined
}

export interface GenerationRequestInput {
    positiveParts: GenerationPromptPart[]
    negativeParts: GenerationPromptPart[]
    characterInputs: GenerationCharacterInput[]
    characterPromptLayoutEnabled: boolean
    characterPositionEnabled: boolean
    characterImages: ReferenceImage[]
    vibeImages: ReferenceImage[]
    model: string
    width: number
    height: number
    steps: number
    cfgScale: number
    cfgRescale: number
    sampler: string
    scheduler: string
    smea: boolean
    smeaDyn: boolean
    variety: boolean
    seed: number
    sourceImage?: string
    strength: number
    noise: number
    mask?: string
    imageFormat: 'png' | 'webp'
    qualityToggle: boolean
    ucPreset: number
    promptWhitespaceMode: PromptWhitespaceMode
    removeEmptyPromptSeparators: boolean
    insertBlankLinesBetweenPromptParts: boolean
    promptParts?: GenerationParams['promptParts']
    generationSources?: Nais2GenerationSources
}

const joinPromptParts = (
    parts: GenerationPromptPart[],
    whitespaceMode: PromptWhitespaceMode,
    insertBlankLines: boolean,
) =>
    parts
        .map(({ value }) =>
            removePromptComments(formatPromptWhitespace(value || '', whitespaceMode))
        )
        .filter(part => part.trim())
        .join(insertBlankLines ? '\n\n' : ', ')

export const buildGenerationRequest = async (input: GenerationRequestInput): Promise<GenerationParams> => {
    const cleanup = (prompt: string) => input.removeEmptyPromptSeparators
        ? removeExactEmptyPromptSeparators(prompt)
        : prompt
    const prompt = mergeQualityTags(
        cleanup(await processWildcards(joinPromptParts(
            input.positiveParts,
            input.promptWhitespaceMode,
            input.insertBlankLinesBetweenPromptParts,
        ))),
        input.model,
        input.qualityToggle,
    )
    const negativePrompt = mergeUcPreset(
        cleanup(await processWildcards(joinPromptParts(
            input.negativeParts,
            input.promptWhitespaceMode,
            input.insertBlankLinesBetweenPromptParts,
        ))),
        input.model,
        input.ucPreset,
    )

    const characterPrompts = await Promise.all(input.characterInputs
        .slice(0, getModelCapabilities(input.model).maxCharacterPrompts)
        .map(async ({
        character,
        appendedPrompts = [],
        costumeEnabled,
        position,
    }) => {
        const { characterPrompt, costumePrompt } = splitCostumePrompt(character.prompt)
        const characterParts = input.characterPromptLayoutEnabled
            ? [
                character.promptEnabled !== false
                    ? formatPromptWhitespace(characterPrompt, input.promptWhitespaceMode)
                    : '',
                (costumeEnabled ?? character.costumeEnabled) !== false
                    ? formatPromptWhitespace(costumePrompt, input.promptWhitespaceMode)
                    : '',
            ]
            : [
                formatPromptWhitespace(characterPrompt, input.promptWhitespaceMode),
                formatPromptWhitespace(costumePrompt, input.promptWhitespaceMode),
            ]
        const rawPrompt = [
            ...characterParts,
            ...appendedPrompts.map(prompt => formatPromptWhitespace(prompt, input.promptWhitespaceMode)),
        ].filter(part => part?.trim()).join(input.insertBlankLinesBetweenPromptParts ? '\n\n' : '\n')
        const rawNegative = input.characterPromptLayoutEnabled && character.negativeEnabled === false
            ? ''
            : formatPromptWhitespace(character.negative, input.promptWhitespaceMode)

        return {
            prompt: cleanup(await processWildcards(removePromptComments(rawPrompt))),
            negative: cleanup(await processWildcards(removePromptComments(rawNegative))),
            enabled: true,
            position: position || character.position,
        }
    }))

    const generationSources = input.generationSources ?? {
        characterPrompts: input.characterInputs
            .slice(0, getModelCapabilities(input.model).maxCharacterPrompts)
            .map(({ character, costumeEnabled, position }) => ({
                id: character.id,
                presetId: character.presetId,
                name: character.name,
                prompt: character.prompt,
                negative: character.negative,
                promptEnabled: character.promptEnabled,
                negativeEnabled: character.negativeEnabled,
                costumeEnabled: costumeEnabled ?? character.costumeEnabled,
                position: position || character.position,
            })),
        characterReferences: input.characterImages.map(image => ({
            id: image.id,
            name: image.name,
            informationExtracted: image.informationExtracted,
            strength: image.strength,
            fidelity: image.fidelity,
            referenceType: image.referenceType,
        })),
        vibeReferences: input.vibeImages.map(image => ({
            id: image.id,
            name: image.name,
            informationExtracted: image.informationExtracted,
            strength: image.strength,
            fidelity: image.fidelity,
            referenceType: image.referenceType,
        })),
        characterPositionEnabled: input.characterPositionEnabled,
    }

    return {
        prompt,
        negative_prompt: negativePrompt,
        model: input.model,
        width: input.width,
        height: input.height,
        steps: input.steps,
        cfg_scale: input.cfgScale,
        cfg_rescale: input.cfgRescale,
        sampler: input.sampler,
        scheduler: input.scheduler,
        smea: input.smea,
        smea_dyn: input.smeaDyn,
        variety: input.variety,
        seed: input.seed,
        sourceImage: input.sourceImage,
        strength: input.strength,
        noise: input.noise,
        mask: input.mask,
        charImages: input.characterImages.map(image => image.base64 || ''),
        charImagePaths: input.characterImages.map(image => image.filePath || null),
        charStrength: input.characterImages.map(image => image.strength),
        charFidelity: input.characterImages.map(image => image.fidelity ?? 0.6),
        charReferenceType: input.characterImages.map(image => image.referenceType ?? 'character&style'),
        charCacheKeys: input.characterImages.map(image => image.cacheKey || null),
        vibeImages: input.vibeImages.map(image => image.base64 || ''),
        vibeImagePaths: input.vibeImages.map(image => image.filePath || null),
        vibeEncodedPaths: input.vibeImages.map(image => image.encodedVibePath || null),
        vibeInfo: input.vibeImages.map(image => image.informationExtracted),
        vibeStrength: input.vibeImages.map(image => image.strength),
        preEncodedVibes: input.vibeImages.map(image => image.encodedVibe || null),
        characterPrompts,
        characterPositionEnabled: input.characterPositionEnabled,
        imageFormat: input.imageFormat,
        qualityToggle: input.qualityToggle,
        ucPreset: input.ucPreset,
        promptParts: input.promptParts,
        generationSources,
    }
}
