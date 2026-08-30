import assert from 'node:assert/strict'
import { getAuthTokenRows, normalizeAuthTokenList } from '../src/lib/auth-token-list.ts'

assert.deepEqual(getAuthTokenRows('existing-token', []), ['existing-token'])
assert.deepEqual(getAuthTokenRows('existing-token', undefined), ['existing-token'])
assert.deepEqual(getAuthTokenRows('', []), [''])
assert.deepEqual(
    normalizeAuthTokenList('active-token', ['saved-token', 'active-token', '', 'saved-token']),
    ['active-token', 'saved-token']
)

console.log('Auth token list checks passed.')
