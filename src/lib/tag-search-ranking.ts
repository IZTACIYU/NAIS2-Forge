export interface SearchableTagIndex {
    labels: string[]
    prefixIndex: Record<string, Uint32Array>
    exactTags: ReadonlyMap<string, number>
}

export function searchTagIndexes(
    index: SearchableTagIndex,
    aliases: ReadonlyMap<string, number>,
    query: string,
    limit: number,
): number[] {
    if (!query || limit <= 0) return []

    const matches: number[] = []
    const matched = new Set<number>()
    const add = (tagIndex: number) => {
        if (matches.length < limit && !matched.has(tagIndex)) {
            matches.push(tagIndex)
            matched.add(tagIndex)
        }
    }

    const exactTag = index.exactTags.get(query)
    if (exactTag !== undefined) add(exactTag)

    const exactAlias = aliases.get(query)
    if (exactAlias !== undefined) add(exactAlias)

    for (const tagIndex of index.prefixIndex[query[0] || '_'] || []) {
        if (matches.length >= limit) break
        if (index.labels[tagIndex].toLowerCase().startsWith(query)) add(tagIndex)
    }

    // ponytail: 31K aliases are cheap to scan; add a prefix index only if profiling shows a regression.
    for (const [alias, tagIndex] of aliases) {
        if (matches.length >= limit) break
        if (alias !== query && alias.startsWith(query)) add(tagIndex)
    }

    for (let tagIndex = 0; tagIndex < index.labels.length && matches.length < limit; tagIndex++) {
        if (index.labels[tagIndex].toLowerCase().includes(query)) add(tagIndex)
    }

    for (const [alias, tagIndex] of aliases) {
        if (matches.length >= limit) break
        if (!alias.startsWith(query) && alias.includes(query)) add(tagIndex)
    }

    return matches
}
