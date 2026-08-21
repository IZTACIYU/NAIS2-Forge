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

/** Matches NovelAI's built-in comma spacing without trimming user whitespace. */
export function normalizePromptCommas(prompt: string) {
    return prompt.replace(/ ,/g, ',').replace(/,(?! |$)/g, ', ')
}

export function appendTransparentBackgroundPrompt(prompt: string, enabled: boolean) {
    if (!enabled) return prompt
    return prompt ? `${prompt}, transparent background` : 'transparent background'
}

export function stripTransparentBackgroundPrompt(prompt: string, enabled: boolean) {
    if (!enabled) return prompt
    if (prompt === 'transparent background') return ''
    const suffix = ', transparent background'
    return prompt.endsWith(suffix) ? prompt.slice(0, -suffix.length) : prompt
}

export function appendQuotedTextPrompt(prompt: string, enabled: boolean) {
    if (!enabled) return prompt
    const texts = Array.from(prompt.matchAll(/(["'])(.*?)\1/gs), match => match[2])
        .filter(Boolean)
    return texts.length ? `${prompt}, teXt: ${texts.join('\n\n')}` : prompt
}

export function stripQuotedTextPrompt(prompt: string, enabled: boolean) {
    if (!enabled) return prompt
    const markerIndex = prompt.lastIndexOf(', teXt: ')
    if (markerIndex < 0) return prompt
    const basePrompt = prompt.slice(0, markerIndex)
    return appendQuotedTextPrompt(basePrompt, true) === prompt ? basePrompt : prompt
}
