import tokenizerDefinition from '@/assets/t5_tokenizer.json'

interface TokenizerDefinition {
    model: { vocab: [string, number][]; unk_id: number }
}

interface Vocab {
    pieces: Map<string, number>
    maxPieceLength: number
    unknownScore: number
}

let cachedVocab: Vocab | null = null

function getVocab(): Vocab {
    if (cachedVocab) return cachedVocab
    const definition = tokenizerDefinition as unknown as TokenizerDefinition
    const pieces = new Map<string, number>()
    let maxPieceLength = 0
    let minScore = Infinity
    for (const [piece, score] of definition.model.vocab) {
        pieces.set(piece, score)
        maxPieceLength = Math.max(maxPieceLength, piece.length)
        minScore = Math.min(minScore, score)
    }
    cachedVocab = { pieces, maxPieceLength, unknownScore: minScore - 10 }
    return cachedVocab
}

function countPiece(piece: string, vocab: Vocab): number {
    const bestScores = new Float64Array(piece.length + 1).fill(-Infinity)
    const bestCounts = new Int32Array(piece.length + 1)
    bestScores[0] = 0
    for (let index = 0; index < piece.length; index++) {
        if (bestScores[index] === -Infinity) continue
        let matched = false
        const maxLength = Math.min(vocab.maxPieceLength, piece.length - index)
        for (let length = 1; length <= maxLength; length++) {
            const score = vocab.pieces.get(piece.slice(index, index + length))
            if (score === undefined) continue
            matched = true
            if (bestScores[index] + score > bestScores[index + length]) {
                bestScores[index + length] = bestScores[index] + score
                bestCounts[index + length] = bestCounts[index] + 1
            }
        }
        if (!matched && bestScores[index] + vocab.unknownScore > bestScores[index + 1]) {
            bestScores[index + 1] = bestScores[index] + vocab.unknownScore
            bestCounts[index + 1] = bestCounts[index] + 1
        }
    }
    return bestCounts[piece.length]
}

export function countTokens(text: string): number {
    if (!text.trim()) return 0
    const vocab = getVocab()
    const cleaned = text.replace(/[[\]{}]/g, '').replace(/-?\d*\.?\d*::/g, '')
    return cleaned.split(/\s+/).filter(Boolean).reduce(
        (total, part) => total + countPiece(`\u2581${part}`, vocab),
        1,
    )
}
