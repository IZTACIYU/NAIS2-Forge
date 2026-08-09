export interface ConditionalPromptContext {
    basePrompt: string
}

type ConditionalPromptHandler = (prompt: string, context: ConditionalPromptContext) => boolean

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

const getBasePromptCandidates = (prompt: string) => {
    const candidates = new Set<string>()
    for (const line of prompt.split(/\r?\n/)) {
        const normalizedLine = normalize(line)
        if (normalizedLine) candidates.add(normalizedLine)
        for (const tag of line.split(',')) {
            const normalizedTag = normalize(tag)
            if (normalizedTag) candidates.add(normalizedTag)
        }
    }
    return candidates
}

const conditionalHandlers: Record<string, ConditionalPromptHandler> = {
    base: (prompt, context) => {
        const candidates = getBasePromptCandidates(context.basePrompt)
        const normalizedPrompt = normalize(prompt)
        const firstTag = normalize(prompt.split(',')[0] || '')
        return candidates.has(normalizedPrompt) || (firstTag !== '' && candidates.has(firstTag))
    },
}

/**
 * Resolves line-scoped #if directives in negative prompts. A handler returning
 * true removes the line; unknown conditions keep the prompt content for
 * forward-compatible data handling.
 */
export function resolveConditionalNegativePrompt(prompt: string, context: ConditionalPromptContext) {
    return prompt
        .split(/\r?\n/)
        .flatMap(line => {
            const match = line.match(/^\s*#if\s+([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i)
            if (!match) return [line]

            const [, condition, content] = match
            const handler = conditionalHandlers[condition.toLocaleLowerCase()]
            if (handler?.(content, context)) return []
            return [content]
        })
        .join('\n')
}