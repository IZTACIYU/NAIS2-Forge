import type { CharacterGender } from '@/lib/character-gender'

export interface ConditionalPromptContext {
    basePrompt: string
    positivePrompt: string
    negativePrompt: string
    characterGenders: CharacterGender[]
    mainCharacterGenders: CharacterGender[]
}

type ConditionalPromptHandler = (prompt: string, context: ConditionalPromptContext) => boolean

const normalize = (value: string) => {
    const compact = value.trim().replace(/\s+/g, ' ')
    const weighted = compact.match(/^(?:-?(?:\d+(?:\.\d+)?|\.\d+))?::(.*?)::$/)
    return (weighted?.[1] ?? compact).trim().toLocaleLowerCase()
}

const isConditionalLine = (line: string) => /^\s*#if(?:\s+[a-z][a-z0-9_-]*\s*:|[+-][^:\r\n]+\s*:)/i.test(line)

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

const onlyWhenAnyCharacterMatches = (
    gender: CharacterGender,
    source: keyof Pick<ConditionalPromptContext, 'characterGenders' | 'mainCharacterGenders'>,
): ConditionalPromptHandler => (_prompt, context) => !context[source].includes(gender)

const conditionalHandlers: Record<string, ConditionalPromptHandler> = {
    base: (prompt, context) => {
        const candidates = getPromptCandidates(context.basePrompt)
        const normalizedPrompt = normalize(prompt)
        const firstTag = normalize(prompt.split(',')[0] || '')
        return candidates.has(normalizedPrompt) || (firstTag !== '' && candidates.has(firstTag))
    },
    b: onlyWhenAnyCharacterMatches('male', 'characterGenders'),
    g: onlyWhenAnyCharacterMatches('female', 'characterGenders'),
    o: onlyWhenAnyCharacterMatches('unknown', 'characterGenders'),
    mb: onlyWhenAnyCharacterMatches('male', 'mainCharacterGenders'),
    mg: onlyWhenAnyCharacterMatches('female', 'mainCharacterGenders'),
    mo: onlyWhenAnyCharacterMatches('unknown', 'mainCharacterGenders'),
}

const matchesConditionTag = (condition: string, candidates: Set<string>) => {
    const normalizedCondition = normalize(condition)
    if (!normalizedCondition.includes('*')) return candidates.has(normalizedCondition)

    const pattern = normalizedCondition
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')
        .replace(/_/g, '[\\s_]')
    const wildcard = new RegExp('^' + pattern + '$')
    return [...candidates].some(candidate => wildcard.test(candidate))
}

const matchesSameCategoryCondition = (condition: string, sameCategoryPrompt: string) => {
    const candidates = getPromptCandidates(sameCategoryPrompt)
    return condition
        .split('/')
        .map(group => group.split('&').map(normalize).filter(Boolean))
        .some(group => group.length > 0 && group.every(prompt => matchesConditionTag(prompt, candidates)))
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

            const categoryMatch = line.match(/^\s*#if([+-])([^:\r\n]+)\s*:\s*(.*)$/i)
            if (!categoryMatch) return [line]

            const [, mode, condition, content] = categoryMatch
            const matches = matchesSameCategoryCondition(condition, sameCategoryPrompt)
            return mode === '+' ? (matches ? [content] : []) : (matches ? [] : [content])
        })
        .join('\n')
}

export function resolveConditionalPositivePrompt(prompt: string, context: ConditionalPromptContext) {
    return resolveConditionalPrompt(prompt, context.positivePrompt, context)
}

export function resolveConditionalNegativePrompt(prompt: string, context: ConditionalPromptContext) {
    return resolveConditionalPrompt(prompt, context.negativePrompt, context)
}
