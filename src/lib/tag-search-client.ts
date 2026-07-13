export interface TagSearchResult {
    label: string
    value: string
    count: number
    type: string
}

export interface TagMatchResult {
    original: string
    matched: TagSearchResult | null
    alternatives: TagSearchResult[]
    status: 'matched' | 'fuzzy' | 'unmatched'
}

interface SearchResponse {
    id: number
    kind: 'search' | 'match'
    matches?: TagSearchResult[]
    results?: TagMatchResult[]
    error?: string
}

let worker: Worker | null = null
let nextRequestId = 0
const pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
}>()

function getWorker(): Worker {
    if (worker) return worker
    worker = new Worker(new URL('./tag-search.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
        const request = pending.get(event.data.id)
        if (!request) return
        pending.delete(event.data.id)
        if (event.data.error) {
            request.reject(new Error(event.data.error))
            return
        }
        request.resolve(event.data.kind === 'match' ? (event.data.results || []) : (event.data.matches || []))
    }
    worker.onerror = () => {
        const error = new Error('Tag search worker failed')
        for (const request of pending.values()) request.reject(error)
        pending.clear()
        worker?.terminate()
        worker = null
    }
    return worker
}

export function searchTags(query: string, limit: number): Promise<TagSearchResult[]> {
    const id = ++nextRequestId
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as TagSearchResult[]), reject })
        getWorker().postMessage({ kind: 'search', id, query, limit })
    })
}

export function matchTags(tags: string[]): Promise<TagMatchResult[]> {
    const id = ++nextRequestId
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve: value => resolve(value as TagMatchResult[]), reject })
        getWorker().postMessage({ kind: 'match', id, tags })
    })
}
