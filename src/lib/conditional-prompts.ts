export interface ConditionalPromptContext {
    basePrompt: string
    positivePrompt: string
    negativePrompt: string
}

type ConditionalPromptHandler = (prompt: string, context: ConditionalPromptContext) => boolean

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()

const isConditionalLine = (line: string) => /^\s*#if(?:\s+[a-z][a-z0-9_-]*\s*:|-[^:\r\n]+\s*:)/i.test(line)

const getPromptCandidates = (prompt: string) => {
    const candidates = new Set<string>()
    for (const line of prompt.split(/\r?\n/)) {
        if (isConditionalLine(line)) continue

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
        const candidates = getPromptCandidates(context.basePrompt)
        const normalizedPrompt = normalize(prompt)
        const firstTag = normalize(prompt.split(',')[0] || '')
        return candidates.has(normalizedPrompt) || (firstTag !== '' && candidates.has(firstTag))
    },
}

const matchesSameCategoryCondition = (condition: string, sameCategoryPrompt: string) => {
    const candidates = getPromptCandidates(sameCategoryPrompt)
    return condition
        .split('/')
        .map(group => group.split('&').map(normalize).filter(Boolean))
        .some(group => group.length > 0 && group.every(prompt => candidates.has(prompt)))
}

// Resolves #if base and #if-condition line directives.
export function resolveConditionalPrompt(
    prompt: string,
    sameCategoryPrompt: string,
    context: ConditionalPromptContext,
) {
    return prompt
        .split(/\r?\n/)
        .flatMap(line => {
            const baseMatch = line.match(/^\s*#if\s+([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i)
            if (baseMatch) {
                const [, condition, content] = baseMatch
                const handler = conditionalHandlers[condition.toLocaleLowerCase()]
                return handler?.(content, context) ? [] : [content]
            }

            const categoryMatch = line.match(/^\s*#if-([^:\r\n]+)\s*:\s*(.*)$/i)
            if (!categoryMatch) return [line]

            const [, condition, content] = categoryMatch
            return matchesSameCategoryCondition(condition, sameCategoryPrompt) ? [] : [content]
        })
        .join('\n')
}

export function resolveConditionalPositivePrompt(prompt: string, context: ConditionalPromptContext) {
    return resolveConditionalPrompt(prompt, context.positivePrompt, context)
}

export function resolveConditionalNegativePrompt(prompt: string, context: ConditionalPromptContext) {
    return resolveConditionalPrompt(prompt, context.negativePrompt, context)
}