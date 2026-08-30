import assert from 'node:assert/strict'
import {
    getAuthRotationCandidates,
    getAuthTokenLabel,
    getAuthTokenRows,
    normalizeAuthTokenList,
    shouldRotateAuthAccount,
    updateAuthRotationOrder,
} from '../src/lib/auth-token-list.ts'

assert.deepEqual(getAuthTokenRows('existing-token', []), ['existing-token'])
assert.deepEqual(getAuthTokenRows('existing-token', undefined), ['existing-token'])
assert.deepEqual(getAuthTokenRows('', []), [''])
assert.deepEqual(
    normalizeAuthTokenList('active-token', ['saved-token', 'active-token', '', 'saved-token']),
    ['active-token', 'saved-token']
)
assert.equal(getAuthTokenLabel('pst-1234567890abcdef'), 'pst-12345678…')
assert.equal(getAuthTokenLabel('short-token'), 'short-token')
assert.deepEqual(updateAuthRotationOrder([], 'a', ['a', 'b', 'c']), ['a', 'b', 'c'])
assert.deepEqual(updateAuthRotationOrder(['a', 'b', 'c'], 'b', ['b', 'a', 'c']), ['a', 'b', 'c'])
assert.deepEqual(getAuthRotationCandidates('b', ['a', 'b', 'c']), ['c', 'a'])
assert.equal(shouldRotateAuthAccount(true, 3, 3, 2), true)
assert.equal(shouldRotateAuthAccount(true, 2, 3, 2), false)
assert.equal(shouldRotateAuthAccount(true, 3, 3, 1), false)

console.log('Auth token list checks passed.')
