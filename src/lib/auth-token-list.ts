export const normalizeAuthTokenList = (activeToken: string, tokens: string[] = []) => {
    const result: string[] = []
    for (const token of [activeToken, ...tokens]) {
        if (typeof token === 'string' && token.trim() && !result.includes(token)) result.push(token)
    }
    return result
}

export const getAuthTokenRows = (activeToken: string, tokens: string[] = []) => {
    const rows = normalizeAuthTokenList(activeToken, tokens)
    return rows.length > 0 ? rows : ['']
}
