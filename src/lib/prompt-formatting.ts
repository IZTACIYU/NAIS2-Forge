export const PROMPT_WHITESPACE_FIELDS = [
    'mainBase',
    'mainAdditional',
    'mainDetail',
    'mainNegative',
    'inpainting',
    'scene',
    'sceneNegative',
    'multiCharacter',
    'character',
    'costume',
    'characterNegative',
] as const

export type PromptWhitespaceField = typeof PROMPT_WHITESPACE_FIELDS[number]
export type PromptWhitespaceMode = 'preserve' | 'compact'

export const DEFAULT_PROMPT_WHITESPACE_MODES: Record<PromptWhitespaceField, PromptWhitespaceMode> = {
    mainBase: 'preserve',
    mainAdditional: 'preserve',
    mainDetail: 'preserve',
    mainNegative: 'preserve',
    inpainting: 'preserve',
    scene: 'preserve',
    sceneNegative: 'preserve',
    multiCharacter: 'preserve',
    character: 'preserve',
    costume: 'preserve',
    characterNegative: 'preserve',
}

export function formatPromptWhitespace(prompt: string, mode: PromptWhitespaceMode) {
    if (mode === 'preserve') return prompt
    return prompt.split(',').map(part => part.trim()).join(', ')
}

export function removeExactEmptyPromptSeparators(prompt: string) {
    let result = prompt
    while (result.includes(', ,')) result = result.split(', ,').join(',')
    return result
}
