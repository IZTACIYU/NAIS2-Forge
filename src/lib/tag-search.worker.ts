/// <reference lib="webworker" />

import tagsData from '@/assets/tags.json'
import Fuse from 'fuse.js'

interface Tag {
    label: string
    value: string
    count: number
    type: string
}

interface SearchRequest {
    kind: 'search'
    id: number
    query: string
    limit: number
}

interface MatchRequest {
    kind: 'match'
    id: number
    tags: string[]
}

interface TagMatchResult {
    original: string
    matched: Tag | null
    alternatives: Tag[]
    status: 'matched' | 'fuzzy' | 'unmatched'
}

const tags = tagsData as Tag[]
const lowerLabels = tags.map(tag => tag.label.toLowerCase())
const prefixIndex: Record<string, number[]> = {}
const exactTags = new Map<string, Tag>()
let fuse: Fuse<Tag> | null = null
const synonyms: Record<string, string> = {
    naked: 'nude',
    blonde: 'blonde_hair',
    brunette: 'brown_hair',
    redhead: 'red_hair',
    duo: '1boy, 1girl',
    couple: '1boy, 1girl',
    'big breasts': 'large_breasts',
    'small breasts': 'flat_chest',
    short: 'short_hair',
    long: 'long_hair',
}

for (let index = 0; index < lowerLabels.length; index++) {
    const first = lowerLabels[index][0] || '_'
    ;(prefixIndex[first] ||= []).push(index)
    if (!exactTags.has(lowerLabels[index])) exactTags.set(lowerLabels[index], tags[index])
}

const scope = self as unknown as DedicatedWorkerGlobalScope

function matchSingleTag(tag: string): TagMatchResult {
    const normalized = tag.trim().toLowerCase().replace(/_/g, ' ')
    if (!normalized) return { original: tag, matched: null, alternatives: [], status: 'unmatched' }

    const exact = exactTags.get(normalized)
    if (exact) return { original: tag, matched: exact, alternatives: [], status: 'matched' }

    const synonym = synonyms[normalized]
    if (synonym && !synonym.includes(',')) {
        const synonymMatch = exactTags.get(synonym.toLowerCase())
        if (synonymMatch) return { original: tag, matched: synonymMatch, alternatives: [], status: 'matched' }
    }

    const alternatives = (prefixIndex[normalized[0] || '_'] || [])
        .filter(index => lowerLabels[index].startsWith(normalized))
        .map(index => tags[index])
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    if (alternatives.length) return { original: tag, matched: null, alternatives, status: 'fuzzy' }

    fuse ||= new Fuse(tags, {
        keys: ['label'],
        threshold: 0.3,
        distance: 50,
        includeScore: true,
        minMatchCharLength: 2,
    })
    const fuzzy = fuse.search(normalized, { limit: 5 }).map(result => result.item).sort((a, b) => b.count - a.count)
    return fuzzy.length
        ? { original: tag, matched: null, alternatives: fuzzy, status: 'fuzzy' }
        : { original: tag, matched: null, alternatives: [], status: 'unmatched' }
}

scope.onmessage = (event: MessageEvent<SearchRequest | MatchRequest>) => {
    if (event.data.kind === 'match') {
        const results: TagMatchResult[] = []
        for (const original of event.data.tags) {
            const normalized = original.trim().toLowerCase()
            const synonym = synonyms[normalized]
            const expanded = synonym
                ? (synonym.includes(',') ? synonym.split(',').map(tag => tag.trim()) : [synonym])
                : [normalized]
            for (const tag of expanded) results.push(matchSingleTag(tag))
        }
        scope.postMessage({ id: event.data.id, kind: 'match', results })
        return
    }

    const { id, query, limit } = event.data
    const matches: Tag[] = []
    const matchedIndexes = new Set<number>()

    for (const index of prefixIndex[query[0] || '_'] || []) {
        if (matches.length >= limit) break
        if (lowerLabels[index].startsWith(query)) {
            matches.push(tags[index])
            matchedIndexes.add(index)
        }
    }

    if (matches.length < limit) {
        for (let index = 0; index < lowerLabels.length && matches.length < limit; index++) {
            if (!matchedIndexes.has(index) && lowerLabels[index].includes(query)) matches.push(tags[index])
        }
    }

    scope.postMessage({ id, kind: 'search', matches })
}

export {}
