export interface WikiCharacter {
    tag: string
    postId?: string
}

export function readWikiCharacters(document: Document, url: string): WikiCharacter[] {
    const page = new URL(url)
    const body = document.querySelector('#wiki-page-body')
    if (!body || !page.pathname.startsWith('/wiki_pages/') || document.querySelector('body.a-new, body[data-wiki-page-is-deleted="true"]')) {
        throw new Error('Open an existing character wiki page')
    }
    const tag = decodeURIComponent(page.pathname.slice('/wiki_pages/'.length))
    const sections = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .filter(heading => ['appearance', 'skins'].includes(heading.textContent?.trim().toLowerCase() || ''))
    const result = new Map<string, WikiCharacter>([[tag, { tag }]])
    if (sections.length === 0) {
        const postId = body.querySelector('article[data-type="post"][data-id]')?.getAttribute('data-id')
        if (postId && /^\d+$/.test(postId)) result.get(tag)!.postId = postId
        return [...result.values()]
    }
    for (const section of sections) {
        const level = Number(section.tagName.slice(1))
        for (let node = section.nextElementSibling; node; node = node.nextElementSibling) {
            if (/^H[1-6]$/.test(node.tagName) && Number(node.tagName.slice(1)) <= level) break
            const firstPost = (node.matches('article[data-type="post"][data-id]') ? node : node.querySelector('article[data-type="post"][data-id]'))?.getAttribute('data-id')
            if (!result.get(tag)!.postId && firstPost && /^\d+$/.test(firstPost)) result.get(tag)!.postId = firstPost
            for (const link of node.querySelectorAll('a.dtext-wiki-link.tag-type-4:not(.dtext-wiki-does-not-exist)')) {
                const href = new URL(link.getAttribute('href') || '', page)
                if (href.origin !== page.origin || !href.pathname.startsWith('/wiki_pages/')) continue
                const name = decodeURIComponent(href.pathname.slice('/wiki_pages/'.length))
                const postId = link.closest('article[data-type="post"]')?.getAttribute('data-id')
                if (!result.has(name)) result.set(name, { tag: name, postId: postId && /^\d+$/.test(postId) ? postId : undefined })
            }
        }
    }
    return [...result.values()]
}

export function characterPreset(tag: string, tags: string = ''): { name: string; prompt: string; negative: string } {
    const name = tag.replace(/_/g, ' ')
    const values = new Set(tags.split(/\s+/))
    const girl = values.has('1girl'), boy = values.has('1boy')
    const ambiguous = [...values].some(value => /^(?:[2-9]\d*girls?|[2-9]\d*boys?|multiple_girls|multiple_boys|gender_swap|genderswap|genderswap_.*)$/.test(value))
    const gender = !ambiguous && girl !== boy ? (girl ? 'girl' : 'boy') : ''
    return { name, prompt: gender ? `${gender}, ${name}` : name, negative: '' }
}

export function eligibleCharacters(candidates: WikiCharacter[], tags: { value: string; type: string; count: number }[], minimum: number): WikiCharacter[] {
    if (!Number.isSafeInteger(minimum) || minimum < 0) throw new Error('Invalid minimum count')
    const eligible = new Set(tags.filter(tag => tag.type === 'character' && tag.count >= minimum).map(tag => tag.value))
    return candidates.filter(candidate => eligible.has(candidate.tag.replace(/_/g, ' ')))
}
