export type PromptWhitespaceMode = 'preserve' | 'compact'

export function formatPromptWhitespace(prompt: string, mode: PromptWhitespaceMode) {
    if (mode === 'preserve') return prompt
    const compacted = prompt.split(',').map(part => part.trim()).join(', ')

    // Conditional directives are line-scoped. Keep their line boundary even
    // when a preceding comma is compacted into the same line.
    return compacted.replace(
        /,\s*(#if(?:\s+[a-z][a-z0-9_-]*|[+-][^:\r\n]+)\s*:)/gi,
        ',\n$1',
    )
}

export function removeExactEmptyPromptSeparators(prompt: string) {
    let result = prompt
    while (result.includes(', ,')) result = result.split(', ,').join(',')
    return result
}
