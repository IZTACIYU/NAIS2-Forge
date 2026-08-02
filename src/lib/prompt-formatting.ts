export type PromptWhitespaceMode = 'preserve' | 'compact'

export function formatPromptWhitespace(prompt: string, mode: PromptWhitespaceMode) {
    if (mode === 'preserve') return prompt
    return prompt.split(',').map(part => part.trim()).join(', ')
}

export function removeExactEmptyPromptSeparators(prompt: string) {
    let result = prompt
    while (result.includes(', ,')) result = result.split(', ,').join(',')
    return result
}
