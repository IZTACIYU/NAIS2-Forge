import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Tokenizer } from '@huggingface/tokenizers'

const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync('src/assets/qwen3_5_tokenizer.json', 'utf8')),
    JSON.parse(fs.readFileSync('src/assets/qwen3_5_tokenizer_config.json', 'utf8')),
)

assert.deepEqual(tokenizer.encode('Hello world', { add_special_tokens: false }).ids, [9419, 1814])
assert.deepEqual(tokenizer.encode('1girl, blue eyes', { add_special_tokens: false }).ids, [16, 27620, 11, 6105, 6213])
assert.deepEqual(tokenizer.encode('안녕하세요', { add_special_tokens: false }).ids, [148924, 154982, 88005])
