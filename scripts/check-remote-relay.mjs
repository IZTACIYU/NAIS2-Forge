import assert from 'node:assert/strict'
import worker, { RelayRoom } from '../remote-worker/src/index.js'

let forwarded = null
let allowed = true
const env = {
  WEB_ORIGIN: 'https://ciyu.us',
  RELAY_CONNECT_LIMIT: { async limit({ key }) { assert.equal(key, '198.51.100.1'); return { success: allowed } } },
  ROOMS: { getByName(room) { assert.equal(room, 'A'.repeat(22)); return { fetch(request) { forwarded = request; return new Response('ok') } } } },
}
const url = `https://relay.ciyu.us/relay/${'A'.repeat(22)}?role=phone`
const headers = { Upgrade: 'websocket', Origin: 'https://ciyu.us', 'CF-Connecting-IP': '198.51.100.1' }
assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 200)
assert.ok(forwarded)
forwarded = null
allowed = false
assert.equal((await worker.fetch(new Request(url, { headers }), env)).status, 429)
assert.equal(forwarded, null)
allowed = true
assert.equal((await worker.fetch(new Request(url, { headers: { ...headers, Origin: 'https://evil.example' } }), env)).status, 403)
assert.equal((await worker.fetch(new Request(url, { headers: { Upgrade: 'websocket', Origin: 'https://ciyu.us' } }), env)).status, 403)
assert.equal((await worker.fetch(new Request('https://relay.ciyu.us/relay/short?role=phone', { headers }), env)).status, 404)

const originalFetch = globalThis.fetch
let pageFetch = null
globalThis.fetch = async (target, options) => {
  pageFetch = { target: String(target), method: options.method }
  return new Response('<html>mobile</html>', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" } })
}
try {
  const page = await worker.fetch(new Request('https://ciyu.us/forge.web?ignored=1'), env)
  assert.deepEqual(pageFetch, { target: 'https://ciyu.us/index.html', method: 'GET' })
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('Location'), null)
  assert.equal(page.headers.get('Content-Security-Policy'), "default-src 'none'")
  await worker.fetch(new Request('https://ciyu.us/forge.web', { method: 'HEAD' }), env)
  assert.equal(pageFetch.method, 'HEAD')
  pageFetch = null
  assert.equal((await worker.fetch(new Request('https://ciyu.us/forge.web', { method: 'POST' }), env)).status, 405)
  assert.equal((await worker.fetch(new Request('https://relay.ciyu.us/forge.web'), env)).status, 404)
  assert.equal(pageFetch, null)
} finally { globalThis.fetch = originalFetch }

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
const unicode = { readyState: 1, closed: false, close() { this.closed = true } }
room.webSocketMessage(unicode, '가'.repeat(700_000))
assert.equal(unicode.closed, true)
const flood = { readyState: 1, closed: false, send() {}, close() { this.closed = true } }
const rateRoom = new RelayRoom({ getTags() { return ['phone'] }, getWebSockets() { return [app] } })
for (let index = 0; index < 16; index++) rateRoom.webSocketMessage(flood, opaque)
assert.equal(flood.closed, false)
rateRoom.webSocketMessage(flood, opaque)
assert.equal(flood.closed, true)
assert.equal(app.sent.length, 17)
const bulk = { readyState: 1, closed: false, close() { this.closed = true } }
const bulkRoom = new RelayRoom({ getTags() { return ['phone'] }, getWebSockets() { return [app] } })
for (let index = 0; index < 4; index++) bulkRoom.webSocketMessage(bulk, 'x'.repeat(1_900_000))
assert.equal(bulk.closed, false)
bulkRoom.webSocketMessage(bulk, 'x'.repeat(1_900_000))
assert.equal(bulk.closed, true)
console.log('Remote relay origin, route isolation and opaque bidirectional forwarding checks passed.')
