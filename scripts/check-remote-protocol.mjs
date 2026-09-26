import assert from 'node:assert/strict'
import {
  createInvitation, validateInvitation, invitationFromHash, invitationUrl,
  randomDeviceId, deriveKey, encryptFrame, decryptFrame, isFreshSequence,
} from '../src/lib/remote-protocol.ts'

const now = Date.now()
const invitation = createInvitation(24, now)
assert.equal(validateInvitation(invitation, now + 1000).accessExpiresAt, now + 24 * 60 * 60 * 1000)
assert.equal(invitationFromHash(new URL(invitationUrl('https://ciyu.us/', invitation)).hash).room, invitation.room)
const webUrl = new URL(invitationUrl('https://ciyu.us/forge.web', invitation))
assert.equal(webUrl.pathname, '/forge.web')
assert.equal(webUrl.search, '')
assert.equal(invitationFromHash(webUrl.hash).secret, invitation.secret)
assert.throws(() => validateInvitation(invitation, now + 5 * 60 * 1000), /expired/)
assert.throws(() => validateInvitation({ ...invitation, accessExpiresAt: invitation.accessExpiresAt + 1 }, now), /expired/)
assert.throws(() => validateInvitation({ ...invitation, createdAt: now + 120000 }, now), /expired/)
assert.throws(() => createInvitation(0), /Invalid/)
assert.throws(() => invitationUrl('http://example.com/', invitation), /HTTPS/)

const deviceId = randomDeviceId()
const appKey = await deriveKey(invitation.secret, invitation.room, deviceId, 'phone-to-app')
const phoneKey = await deriveKey(invitation.secret, invitation.room, deviceId, 'phone-to-app')
const wrongDirection = await deriveKey(invitation.secret, invitation.room, deviceId, 'app-to-phone')
const frame = await encryptFrame(phoneKey, invitation.room, 'phone-to-app', 1, { type: 'generate', requestId: 'x' })
assert.deepEqual(await decryptFrame(appKey, invitation.room, 'phone-to-app', frame), { type: 'generate', requestId: 'x' })
await assert.rejects(decryptFrame(wrongDirection, invitation.room, 'phone-to-app', frame))
await assert.rejects(decryptFrame(appKey, invitation.room, 'app-to-phone', frame))
await assert.rejects(decryptFrame(appKey, invitation.room, 'phone-to-app', { ...frame, seq: 2 }))
await assert.rejects(decryptFrame(appKey, invitation.room, 'phone-to-app', { ...frame, ciphertext: (frame.ciphertext[0] === 'A' ? 'B' : 'A') + frame.ciphertext.slice(1) }))
assert.equal(isFreshSequence(0, 1), true)
assert.equal(isFreshSequence(1, 1), false)
assert.equal(isFreshSequence(2, 1), false)

console.log('Remote QR expiry, field consistency, authenticated encryption, direction binding and replay sequence checks passed.')
