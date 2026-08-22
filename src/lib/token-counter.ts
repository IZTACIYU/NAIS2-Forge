import { getModelCapabilities } from '@/lib/model-capabilities'

export async function countTokens(text: string, model: string): Promise<number> {
    if (!text) return 0
    if (getModelCapabilities(model).promptTokenizer === 'qwen3.5') {
        const { countQwenTokens } = await import('@/lib/qwen-token-counter')
        return countQwenTokens(text)
    }
    if (!text.trim()) return 0
    const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
    const { countT5Tokens } = await import('@/lib/t5-token-counter')
    return countT5Tokens(cleaned)
}
