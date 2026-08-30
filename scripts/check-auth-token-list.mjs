import assert from 'node:assert/strict'
import { getAuthTokenLabel, getAuthTokenRows, normalizeAuthTokenList } from '../src/lib/auth-token-list.ts'

assert.deepEqual(getAuthTokenRows('existing-token', []), ['existing-token'])
assert.deepEqual(getAuthTokenRows('existing-token', undefined), ['existing-token'])
assert.deepEqual(getAuthTokenRows('', []), [''])
assert.deepEqual(
    normalizeAuthTokenList('active-token', ['saved-token', 'active-token', '', 'saved-token']),
    ['active-token', 'saved-token']
)
assert.equal(getAuthTokenLabel('pst-1234567890abcdef'), 'pst-12345678…')
assert.equal(getAuthTokenLabel('short-token'), 'short-token')

console.log('Auth token list checks passed.')
