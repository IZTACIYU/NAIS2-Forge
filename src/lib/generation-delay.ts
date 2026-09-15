export function calculateGenerationDelay(baseMs: number, jitterMs: number): number {
    const base = Number.isFinite(baseMs) ? Math.max(0, baseMs) : 0
    const upper = Number.isFinite(jitterMs) ? Math.max(0, Math.min(5000, jitterMs)) : 0
    return upper === 0 ? base : Math.max(0, base - 50 + Math.random() * (upper + 50))
}
