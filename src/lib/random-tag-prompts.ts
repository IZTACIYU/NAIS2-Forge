export interface RandomTagQuery {
    category: 'character' | 'artist' | 'copyright'
    operator?: '>' | '<' | '>=' | '<=' | '='
    count?: number
    preview?: boolean
}

// NAITAG01 codes are a binary contract, not alphabetical category order.
const categories = { character: 2, artist: 3, copyright: 1 } as const

export function pickRandomTagIndex(
    index: { counts: Uint32Array; types: Uint8Array },
    query: RandomTagQuery,
): number {
    const type = categories[query.category]
    if (type === undefined || (query.operator && !['>', '<', '>=', '<=', '='].includes(query.operator))
        || (query.operator && (!Number.isSafeInteger(query.count) || query.count! < 0))) {
        throw new Error('Invalid random tag filter')
    }
    let selected = -1, candidates = 0
    for (let i = 0; i < index.counts.length; i++) {
        if (index.types[i] !== type) continue
        const count = index.counts[i], limit = query.count ?? 0
        if (query.operator === '>' && count <= limit || query.operator === '<' && count >= limit
            || query.operator === '>=' && count < limit || query.operator === '<=' && count > limit
            || query.operator === '=' && count !== limit) continue
        if (query.preview) return i
        // Reservoir sampling: uniform selection without allocating a candidate list.
        if (Math.random() < 1 / ++candidates) selected = i
    }
    return selected
}

export async function resolveRandomTagPrompts(
    prompt: string,
    pick: (query: RandomTagQuery) => Promise<string | null>,
    preview = false,
): Promise<string> {
    const matches = [...prompt.matchAll(/(?<![\p{L}\p{N}_])#r(Chara|Artist|Copy)\b(?:[ \t]*([<>]=?|=[<>]?)[ \t]*([\d.]+))?/giu)]
    let result = prompt
    for (const match of matches.reverse()) {
        const tail = prompt.slice(match.index! + match[0].length)
        const count = match[3] === undefined ? undefined : Number(match[3])
        const invalid = /^[ \t]*[<>=]/.test(tail) || (match[2] &&
            (!/^\d+$/.test(match[3]) || !Number.isSafeInteger(count) || /^[\p{L}\p{N}_.]/u.test(tail)))
        if (invalid && !preview) throw new Error(`Invalid random tag filter: ${match[0]}${tail.split(/[,\r\n]/)[0]}`)
        const category = ({ chara: 'character', artist: 'artist', copy: 'copyright' } as const)[match[1].toLowerCase() as 'chara' | 'artist' | 'copy']
        const operator = match[2]?.replace('=>', '>=').replace('=<', '<=') as RandomTagQuery['operator']
        const value = invalid ? null : await pick({ category, operator, count, preview })
        if (value === null && !preview) throw new Error(`No matching tags: ${match[0]}`)
        result = result.slice(0, match.index!) + (value ?? '') + result.slice(match.index! + match[0].length)
    }
    return result
}
