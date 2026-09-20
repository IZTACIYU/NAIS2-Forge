import type { GenerationParams } from '@/services/novelai-api'
import type { ReferenceImage } from '@/stores/character-store'
import type { CharacterPrompt } from '@/stores/character-prompt-store'
import type { Nais2GenerationSources } from '@/lib/nais2-png-meta'
import { processWildcards } from '@/lib/fragment-processor'
import {
    getModelCapabilities,
    type ModelMode,
    type QualityTagPresetId,
} from '@/lib/model-capabilities'
import { mergeQualityTags, mergeUcPreset } from '@/lib/nai-presets'
import { removePromptComments } from '@/lib/prompt-comments'
import { stripDeleteDirectives, deletePromptTags } from '@/lib/delete-prompts'
import { splitCostumePrompt } from '@/lib/costume-prompt'
import { resolveConditionalNegativePrompt, resolveConditionalPositivePrompt } from '@/lib/conditional-prompts'
import { getCharacterGender } from '@/lib/character-gender'
import {
    appendQuotedTextPrompt,
    appendTransparentBackgroundPrompt,
    formatPromptWhitespace,
    normalizePromptCommas,
    removeExactEmptyPromptSeparators,
    type PromptWhitespaceMode,
} from '@/lib/prompt-formatting'

export interface GenerationCharacterInput {
    character: CharacterPrompt
    appendedPrompts?: string[]
    appendedNegativePrompts?: string[]
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
    mainCharacterInputs?: GenerationCharacterInput[]
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
    modelMode: ModelMode
    seed: number
    sourceImage?: string
    strength: number
    noise: number
    mask?: string
    imageFormat: 'png' | 'webp'
    qualityToggle: boolean
    qualityTagPreset: QualityTagPresetId
    ucPreset: number
    transparentBackground: boolean
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
    targets: Set<string>,
) =>
    parts
        .map(({ value }) =>
            removePromptComments(formatPromptWhitespace(stripDeleteDirectives(value || '', targets), whitespaceMode))
        )
        .filter(part => part.trim())
        .join(insertBlankLines ? '\n\n' : ', ')

export const buildGenerationRequest = async (input: GenerationRequestInput): Promise<GenerationParams> => {
    const positiveDeletes = new Set<string>()
    const negativeDeletes = new Set<string>()
    const format = (prompt: string, targets: Set<string>) =>
        formatPromptWhitespace(stripDeleteDirectives(prompt, targets), input.promptWhitespaceMode)
    const cleanup = (prompt: string) => {
        const normalized = normalizePromptCommas(prompt)
        return input.removeEmptyPromptSeparators
            ? removeExactEmptyPromptSeparators(normalized)
            : normalized
    }
    const rawBasePrompt = joinPromptParts(
        input.positiveParts,
        input.promptWhitespaceMode,
        input.insertBlankLinesBetweenPromptParts,
        positiveDeletes,
    )
    const capabilities = getModelCapabilities(input.model)
    const modePromptPrefix = capabilities.modes.find(mode => mode.value === input.modelMode)?.promptPrefix
    const rawMainPrompt = modePromptPrefix
        ? [modePromptPrefix, rawBasePrompt].filter(Boolean).join(', ')
        : rawBasePrompt

    const maxCharacterPrompts = capabilities.maxCharacterPrompts
    const activeCharacterInputs = input.characterInputs.slice(0, maxCharacterPrompts)
    const activeMainCharacterInputs = (input.mainCharacterInputs ?? input.characterInputs).slice(0, maxCharacterPrompts)
    const characterPrompts = await Promise.all(activeCharacterInputs
        .map(async ({
        character,
        appendedPrompts = [],
        appendedNegativePrompts = [],
        costumeEnabled,
        position,
    }) => {
        const { characterPrompt, costumePrompt } = splitCostumePrompt(character.prompt)
        const characterParts = input.characterPromptLayoutEnabled
            ? [
                character.promptEnabled !== false
                    ? format(characterPrompt, positiveDeletes)
                    : '',
                (costumeEnabled ?? character.costumeEnabled) !== false
                    ? format(costumePrompt, positiveDeletes)
                    : '',
            ]
            : [
                format(characterPrompt, positiveDeletes),
                format(costumePrompt, positiveDeletes),
            ]
        const rawPrompt = [
            ...characterParts,
            ...appendedPrompts.map(prompt => format(prompt, positiveDeletes)),
        ].filter(part => part?.trim()).join(input.insertBlankLinesBetweenPromptParts ? '\n\n' : '\n')
        const rawNegative = [
            input.characterPromptLayoutEnabled && character.negativeEnabled === false
                ? ''
                : format(character.negative, negativeDeletes),
            ...appendedNegativePrompts.map(prompt => format(prompt, negativeDeletes)),
        ].filter(part => part?.trim()).join(input.insertBlankLinesBetweenPromptParts ? '\n\n' : '\n')

        return {
            rawPrompt: removePromptComments(rawPrompt),
            rawNegative: removePromptComments(rawNegative),
            enabled: true,
            position: position || character.position,
        }
    }))

    const rawMainNegative = joinPromptParts(
        input.negativeParts,
        input.promptWhitespaceMode,
        input.insertBlankLinesBetweenPromptParts,
        negativeDeletes,
    )
    const conditionalContext = {
        basePrompt: [rawMainPrompt, ...characterPrompts.map(character => character.rawPrompt)]
            .filter(part => part.trim())
            .join('\n'),
        positivePrompt: [rawMainPrompt, ...characterPrompts.map(character => character.rawPrompt)]
            .filter(part => part.trim())
            .join('\n'),
        negativePrompt: [
            mergeUcPreset(rawMainNegative, input.model, input.ucPreset),
            ...characterPrompts.map(character => character.rawNegative),
        ].filter(part => part.trim()).join('\n'),
        characterGenders: activeCharacterInputs.map(({ character }) => getCharacterGender(character.prompt)),
        mainCharacterGenders: activeMainCharacterInputs.map(({ character }) => getCharacterGender(character.prompt)),
    }
    const expandedMain = stripDeleteDirectives(
        await processWildcards(resolveConditionalPositivePrompt(rawMainPrompt, conditionalContext)), positiveDeletes)
    const expandedCharacters = await Promise.all(characterPrompts.map(async ({ rawPrompt, rawNegative, ...character }) => ({
        ...character,
        prompt: stripDeleteDirectives(await processWildcards(resolveConditionalPositivePrompt(rawPrompt, conditionalContext)), positiveDeletes),
        negative: stripDeleteDirectives(await processWildcards(resolveConditionalNegativePrompt(rawNegative, conditionalContext)), negativeDeletes),
    })))
    const expandedNegative = stripDeleteDirectives(
        await processWildcards(resolveConditionalNegativePrompt(rawMainNegative, conditionalContext)), negativeDeletes)
    const prompt = appendQuotedTextPrompt(
        deletePromptTags(mergeQualityTags(
            appendTransparentBackgroundPrompt(
                cleanup(expandedMain),
                capabilities.supportsTransparentBackground && input.transparentBackground,
            ),
            input.model,
            input.qualityToggle,
            input.qualityTagPreset,
        ), positiveDeletes),
        capabilities.supportsQuotedTextPrompt,
    )
    const resolvedCharacterPrompts = expandedCharacters.map(({ prompt, negative, ...character }) => ({
        ...character,
        prompt: deletePromptTags(cleanup(prompt), positiveDeletes),
        negative: deletePromptTags(cleanup(negative), negativeDeletes),
    }))
    const negativePrompt = deletePromptTags(mergeUcPreset(
        cleanup(expandedNegative),
        input.model,
        input.ucPreset,
    ), negativeDeletes)
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
        variety: capabilities.supportsVariety ? input.variety : false,
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
        characterPrompts: resolvedCharacterPrompts,
        characterPositionEnabled: input.characterPositionEnabled,
        imageFormat: input.imageFormat,
        qualityToggle: capabilities.qualityTagPresets.length > 2
            ? input.qualityTagPreset !== 'none'
            : input.qualityToggle,
        ucPreset: input.ucPreset,
        tag_hint_qt: capabilities.qualityTagPresets
            .find(preset => preset.value === input.qualityTagPreset)?.tagHint,
        tag_hint_uc_preset: capabilities.ucPresets
            .find(preset => preset.value === input.ucPreset)?.tagHint,
        tag_hint_transparent_background: capabilities.supportsTransparentBackground
            ? input.transparentBackground || null
            : undefined,
        straight_alpha: capabilities.supportsTransparentBackground ? true : undefined,
        promptParts: input.promptParts,
        generationSources,
    }
}
