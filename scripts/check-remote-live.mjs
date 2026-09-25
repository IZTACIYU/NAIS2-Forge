import assert from 'node:assert/strict'
import { createInvitation, randomDeviceId, deriveKey, encryptFrame, decryptFrame } from '../src/lib/remote-protocol.ts'

const invitation = createInvitation(24)
const room = invitation.room
const base = `${process.env.REMOTE_RELAY_URL || 'ws://127.0.0.1:8787'}/relay/${room}`
const open = (role) => new Promise((resolve, reject) => {
  const socket = new WebSocket(`${base}?role=${role}`, { headers: { Origin: 'https://ciyu.us' } })
  socket.onopen = () => resolve(socket)
  socket.onerror = reject
})

const app = await open('app')
const phone = await open('phone')
const receive = socket => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('No relayed message')), 5000)
  socket.onmessage = event => { clearTimeout(timeout); resolve(JSON.parse(event.data)) }
})
try {
  const deviceId = randomDeviceId()
  const outbound = await deriveKey(invitation.secret, room, deviceId, 'phone-to-app')
  const inbound = await deriveKey(invitation.secret, room, deviceId, 'app-to-phone')
  const request = receive(app)
  phone.send(JSON.stringify({ kind: 'data', frame: await encryptFrame(outbound, room, 'phone-to-app', 1, { type: 'generate' }) }))
  assert.deepEqual(await decryptFrame(outbound, room, 'phone-to-app', (await request).frame), { type: 'generate' })
  const response = receive(phone)
  app.send(JSON.stringify({ kind: 'data', frame: await encryptFrame(inbound, room, 'app-to-phone', 1, { type: 'complete' }) }))
  assert.deepEqual(await decryptFrame(inbound, room, 'app-to-phone', (await response).frame), { type: 'complete' })
  console.log('Bidirectional encrypted WebSocket relay passed.')
} finally {
  app.close()
  phone.close()
}
