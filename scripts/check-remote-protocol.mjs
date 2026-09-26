import assert from 'node:assert/strict'
import {
  createInvitation, validateInvitation, invitationFromHash, invitationUrl,
  randomDeviceId, deriveKey, encryptFrame, decryptFrame, isFreshSequence, imageDataUrlByteLength, MAX_IMAGE_BYTES, MAX_IMAGE_FRAME_SIZE, toBase64Url, fromBase64Url,
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

const original = Buffer.alloc(MAX_IMAGE_BYTES, 137)
const image = `data:image/png;base64,${original.toString('base64')}`
assert.equal(imageDataUrlByteLength(image), MAX_IMAGE_BYTES)
assert.throws(() => imageDataUrlByteLength(`data:image/png;base64,${Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')}`))
assert.throws(() => imageDataUrlByteLength('data:image/png;base64,@@=='))
for (const size of [1, 2, 3, 32765, 32766, 32767, 100000]) {
  const value = Uint8Array.from({ length: size }, (_, i) => i % 256)
  assert.deepEqual(fromBase64Url(toBase64Url(value)), value)
}
const imageFrame = await encryptFrame(wrongDirection, invitation.room, 'app-to-phone', 3, { preview: image })
assert.ok(JSON.stringify({ kind: 'data', frame: imageFrame }).length < MAX_IMAGE_FRAME_SIZE)
assert.equal((await decryptFrame(wrongDirection, invitation.room, 'app-to-phone', imageFrame)).preview, image)
await assert.rejects(decryptFrame(wrongDirection, invitation.room, 'phone-to-app', imageFrame), /Invalid encrypted frame/)
console.log('Remote protocol checks passed, including exact 10 MB original image roundtrip and unchanged command size limits.')
