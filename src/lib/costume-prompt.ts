export const COSTUME_PROMPT_MARKER = '#\uC758\uC0C1\uD504\uB86C'
export const LEGACY_COSTUME_PROMPT_MARKER = '#!-\uC758\uC0C1\uD504\uB86C'

export function splitCostumePrompt(prompt: string) {
    const normalized = prompt.replace(/\r\n/g, '\n')
    const match = [COSTUME_PROMPT_MARKER, LEGACY_COSTUME_PROMPT_MARKER]
        .map(marker => ({ marker, index: normalized.indexOf(marker) }))
        .filter((candidate): candidate is { marker: string; index: number } => candidate.index >= 0)
        .sort((left, right) => left.index - right.index)[0]

    if (!match) return { characterPrompt: prompt, costumePrompt: '' }
    return {
        characterPrompt: normalized.slice(0, match.index).replace(/\n+$/g, ''),
        costumePrompt: normalized.slice(match.index + match.marker.length).replace(/^\n+/g, ''),
    }
}

export function normalizeCostumePromptMarkersForExport<T>(value: T): T {
    const normalize = (candidate: unknown): unknown => {
        if (Array.isArray(candidate)) return candidate.map(normalize)
        if (!candidate || typeof candidate !== 'object') return candidate

        return Object.fromEntries(Object.entries(candidate).map(([key, child]) => [
            key,
            key === 'prompt' && typeof child === 'string'
                ? child.replace(new RegExp(LEGACY_COSTUME_PROMPT_MARKER, 'g'), COSTUME_PROMPT_MARKER)
                : normalize(child),
        ]))
    }

    return normalize(value) as T
}