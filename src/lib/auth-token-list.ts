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

export const getAuthTokenLabel = (token: string) => token.length > 12 ? `${token.slice(0, 12)}…` : token

export const updateAuthRotationOrder = (order: string[], activeToken: string, tokens: string[]) => {
    const available = normalizeAuthTokenList(activeToken, tokens)
    return [
        ...order.filter(token => available.includes(token)),
        ...available.filter(token => !order.includes(token)),
    ]
}

export const getAuthRotationCandidates = (activeToken: string, order: string[]) => {
    const activeIndex = order.indexOf(activeToken)
    if (activeIndex < 0) return order
    return [...order.slice(activeIndex + 1), ...order.slice(0, activeIndex)]
}

export const shouldRotateAuthAccount = (
    enabled: boolean,
    successfulImages: number,
    imagesPerAccount: number,
    accountCount: number,
) => enabled && accountCount > 1 && successfulImages >= Math.max(1, imagesPerAccount)

export const shouldRetryWithNextAuthAccount = (
    enabled: boolean,
    skipUnavailable: boolean,
    httpStatus: number | undefined,
    accountCount: number,
) => enabled && skipUnavailable && httpStatus === 402 && accountCount > 1
