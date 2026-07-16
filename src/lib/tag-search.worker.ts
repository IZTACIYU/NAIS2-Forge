/// <reference lib="webworker" />

import tagsBinaryUrl from '@/assets/tags.bin?url'

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

interface TagIndex {
    labels: string[]
    counts: Uint32Array
    types: Uint8Array
    prefixIndex: Record<string, Uint32Array>
    exactTags: Map<string, number>
}

const BINARY_MAGIC = 'NAITAG01'
const TYPE_NAMES = ['general', 'copyright', 'character', 'artist'] as const
const EMPTY_INDEXES = new Uint32Array(0)
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

let tagIndexPromise: Promise<TagIndex> | null = null

async function loadTagIndex(): Promise<TagIndex> {
    const response = await fetch(tagsBinaryUrl)
    if (!response.ok) throw new Error(`Tag index load failed: ${response.status}`)

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength < 16) throw new Error('Tag index is truncated')

    const decoder = new TextDecoder()
    const magic = decoder.decode(new Uint8Array(buffer, 0, 8))
    if (magic !== BINARY_MAGIC) throw new Error('Unsupported tag index format')

    const view = new DataView(buffer)
    const count = view.getUint32(8, true)
    const labelBytesLength = view.getUint32(12, true)
    const countsOffset = 16
    const typesOffset = countsOffset + count * 4
    const labelsOffset = typesOffset + count
    if (labelsOffset + labelBytesLength !== buffer.byteLength) throw new Error('Invalid tag index size')

    const counts = new Uint32Array(count)
    for (let index = 0; index < count; index++) {
        counts[index] = view.getUint32(countsOffset + index * 4, true)
    }

    const types = new Uint8Array(count)
    types.set(new Uint8Array(buffer, typesOffset, count))

    const labelsText = decoder.decode(new Uint8Array(buffer, labelsOffset, labelBytesLength))
    const labels = labelsText.split('\n')
    if (labels.length !== count) throw new Error('Invalid tag label count')

    const buckets: Record<string, number[]> = {}
    const exactTags = new Map<string, number>()
    for (let index = 0; index < labels.length; index++) {
        const normalized = labels[index].toLowerCase()
        const first = normalized[0] || '_'
        ;(buckets[first] ||= []).push(index)
        if (!exactTags.has(normalized)) exactTags.set(normalized, index)
    }

    const prefixIndex: Record<string, Uint32Array> = {}
    for (const [key, indexes] of Object.entries(buckets)) {
        prefixIndex[key] = Uint32Array.from(indexes)
    }

    return { labels, counts, types, prefixIndex, exactTags }
}

function getTagIndex(): Promise<TagIndex> {
    tagIndexPromise ||= loadTagIndex()
    return tagIndexPromise
}

function toTag(index: TagIndex, tagIndex: number): Tag {
    const label = index.labels[tagIndex]
    return {
        label,
        value: label,
        count: index.counts[tagIndex],
        type: TYPE_NAMES[index.types[tagIndex]] || 'general',
    }
}

function editDistanceWithin(
    source: string,
    target: string,
    maxDistance: number,
    firstRow: Uint16Array,
    secondRow: Uint16Array,
): number | null {
    if (Math.abs(source.length - target.length) > maxDistance) return null

    let previous = firstRow
    let current = secondRow
    for (let column = 0; column <= source.length; column++) previous[column] = column

    for (let row = 1; row <= target.length; row++) {
        current[0] = row
        for (let column = 1; column <= source.length; column++) {
            const substitution = previous[column - 1] + (source[column - 1] === target[row - 1] ? 0 : 1)
            current[column] = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                substitution,
            )
        }
        ;[previous, current] = [current, previous]
    }

    const distance = previous[source.length]
    return distance <= maxDistance ? distance : null
}

function findFuzzyAlternatives(index: TagIndex, normalized: string): Tag[] {
    if (normalized.length < 2) return []

    const maxDistance = Math.max(1, Math.floor(normalized.length * 0.3))
    const firstRow = new Uint16Array(normalized.length + 1)
    const secondRow = new Uint16Array(normalized.length + 1)
    const best: Array<{ tagIndex: number; distance: number }> = []

    for (const tagIndex of index.prefixIndex[normalized[0] || '_'] || EMPTY_INDEXES) {
        const label = index.labels[tagIndex].toLowerCase()
        const distance = editDistanceWithin(normalized, label, maxDistance, firstRow, secondRow)
        if (distance === null) continue

        best.push({ tagIndex, distance })
        best.sort((a, b) => a.distance - b.distance || index.counts[b.tagIndex] - index.counts[a.tagIndex])
        if (best.length > 5) best.length = 5
    }

    return best.map(candidate => toTag(index, candidate.tagIndex))
}

function matchSingleTag(index: TagIndex, tag: string): TagMatchResult {
    const normalized = tag.trim().toLowerCase().replace(/_/g, ' ')
    if (!normalized) return { original: tag, matched: null, alternatives: [], status: 'unmatched' }

    const exactIndex = index.exactTags.get(normalized)
    if (exactIndex !== undefined) {
        return { original: tag, matched: toTag(index, exactIndex), alternatives: [], status: 'matched' }
    }

    const synonym = synonyms[normalized]
    if (synonym && !synonym.includes(',')) {
        const synonymIndex = index.exactTags.get(synonym.toLowerCase())
        if (synonymIndex !== undefined) {
            return { original: tag, matched: toTag(index, synonymIndex), alternatives: [], status: 'matched' }
        }
    }

    const alternatives: Tag[] = []
    for (const tagIndex of index.prefixIndex[normalized[0] || '_'] || EMPTY_INDEXES) {
        if (index.labels[tagIndex].toLowerCase().startsWith(normalized)) alternatives.push(toTag(index, tagIndex))
    }
    alternatives.sort((a, b) => b.count - a.count)
    if (alternatives.length) {
        return { original: tag, matched: null, alternatives: alternatives.slice(0, 5), status: 'fuzzy' }
    }

    const fuzzy = findFuzzyAlternatives(index, normalized)
    return fuzzy.length
        ? { original: tag, matched: null, alternatives: fuzzy, status: 'fuzzy' }
        : { original: tag, matched: null, alternatives: [], status: 'unmatched' }
}

const scope = self as unknown as DedicatedWorkerGlobalScope

async function handleMessage(data: SearchRequest | MatchRequest): Promise<void> {
    const index = await getTagIndex()

    if (data.kind === 'match') {
        const results: TagMatchResult[] = []
        for (const original of data.tags) {
            const normalized = original.trim().toLowerCase()
            const synonym = synonyms[normalized]
            const expanded = synonym
                ? (synonym.includes(',') ? synonym.split(',').map(tag => tag.trim()) : [synonym])
                : [normalized]
            for (const tag of expanded) results.push(matchSingleTag(index, tag))
        }
        scope.postMessage({ id: data.id, kind: 'match', results })
        return
    }

    const query = data.query.toLowerCase()
    const matches: Tag[] = []
    const matchedIndexes = new Set<number>()

    for (const tagIndex of index.prefixIndex[query[0] || '_'] || EMPTY_INDEXES) {
        if (matches.length >= data.limit) break
        if (index.labels[tagIndex].toLowerCase().startsWith(query)) {
            matches.push(toTag(index, tagIndex))
            matchedIndexes.add(tagIndex)
        }
    }

    if (matches.length < data.limit) {
        for (let tagIndex = 0; tagIndex < index.labels.length && matches.length < data.limit; tagIndex++) {
            if (!matchedIndexes.has(tagIndex) && index.labels[tagIndex].toLowerCase().includes(query)) {
                matches.push(toTag(index, tagIndex))
            }
        }
    }

    scope.postMessage({ id: data.id, kind: 'search', matches })
}

scope.onmessage = (event: MessageEvent<SearchRequest | MatchRequest>) => {
    handleMessage(event.data).catch(error => {
        scope.postMessage({
            id: event.data.id,
            kind: event.data.kind,
            error: error instanceof Error ? error.message : String(error),
        })
    })
}

export {}
