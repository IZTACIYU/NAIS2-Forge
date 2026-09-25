import assert from 'node:assert/strict'
import worker, { RelayRoom } from '../remote-worker/src/index.js'

let forwarded = null
const env = {
  WEB_ORIGIN: 'https://ciyu.us',
  ROOMS: { getByName(room) { assert.equal(room, 'A'.repeat(22)); return { fetch(request) { forwarded = request; return new Response('ok') } } } },
}
const url = `https://relay.ciyu.us/relay/${'A'.repeat(22)}?role=phone`
const headers = { Upgrade: 'websocket', Origin: 'https://ciyu.us' }
assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 200)
assert.ok(forwarded)
assert.equal((await worker.fetch(new Request(url, { headers: { ...headers, Origin: 'https://evil.example' } }), env)).status, 403)
assert.equal((await worker.fetch(new Request('https://relay.ciyu.us/relay/short?role=phone', { headers }), env)).status, 404)

const app = { readyState: 1, sent: [], closed: false, send(message) { this.sent.push(message) }, close() { this.closed = true } }
const phone = { readyState: 1, sent: [], send(message) { this.sent.push(message) } }
const state = {
  getTags(socket) { return socket === app ? ['app'] : ['phone'] },
  getWebSockets(role) { return role === 'app' ? [app] : [phone] },
}
const room = new RelayRoom(state)
const opaque = 'ciphertext only; no prompt or token'
room.webSocketMessage(phone, opaque)
room.webSocketMessage(app, opaque)
assert.deepEqual(app.sent, [opaque])
assert.deepEqual(phone.sent, [opaque])
room.webSocketMessage(app, 'x'.repeat(2_000_001))
assert.equal(app.closed, true)
assert.deepEqual(phone.sent, [opaque])
console.log('Remote relay origin, route isolation and opaque bidirectional forwarding checks passed.')
