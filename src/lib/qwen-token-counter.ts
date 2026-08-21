import { Tokenizer } from '@huggingface/tokenizers'
import tokenizerDefinitionUrl from '@/assets/qwen3_5_tokenizer.json?url'
import tokenizerConfigUrl from '@/assets/qwen3_5_tokenizer_config.json?url'

let tokenizerPromise: Promise<Tokenizer> | null = null

function loadTokenizer(): Promise<Tokenizer> {
    tokenizerPromise ??= Promise.all([
        fetch(tokenizerDefinitionUrl).then(response => response.json()),
        fetch(tokenizerConfigUrl).then(response => response.json()),
    ]).then(([definition, config]) => new Tokenizer(definition, config))
    return tokenizerPromise
}

export async function countQwenTokens(text: string): Promise<number> {
    const tokenizer = await loadTokenizer()
    return tokenizer.encode(text, { add_special_tokens: false }).ids.length
}
