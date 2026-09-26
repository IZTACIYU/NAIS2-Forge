// Blind, ephemeral relay: no KV, R2, database, message parsing, or payload logs.
const ROOM_PATH = /^\/relay\/([A-Za-z0-9_-]{22})$/
const MAX_MESSAGE_SIZE = 2_000_000
const MESSAGE_WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 16
const MAX_BYTES_PER_WINDOW = 8_000_000

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.origin === env.WEB_ORIGIN && url.pathname === '/forge.web') {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 })
      return fetch(new URL('/index.html', env.WEB_ORIGIN), { method: request.method })
    }
    const match = ROOM_PATH.exec(url.pathname)
    const role = url.searchParams.get('role')
    if (!match || !['app', 'phone'].includes(role) || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Not found', { status: 404 })
    }
    const origin = request.headers.get('Origin')
    if (role === 'phone' && origin !== env.WEB_ORIGIN) return new Response('Forbidden', { status: 403 })
    const ip = request.headers.get('CF-Connecting-IP')
    if (!ip) return new Response('Forbidden', { status: 403 })
    const { success } = await env.RELAY_CONNECT_LIMIT.limit({ key: ip })
    if (!success) return new Response('Too many connections', { status: 429 })
    const room = env.ROOMS.getByName(match[1])
    return room.fetch(request)
  },
}

export class RelayRoom {
  constructor(state) {
    this.state = state
    this.messageUsage = new WeakMap()
  }

  async fetch(request) {
    const role = new URL(request.url).searchParams.get('role')
    if (role !== 'app' && role !== 'phone') return new Response('Forbidden', { status: 403 })
    if (this.state.getWebSockets(role).some(socket => socket.readyState === 1)) {
      return new Response('Already connected', { status: 409 })
    }
    const [client, server] = Object.values(new WebSocketPair())
    this.state.acceptWebSocket(server, [role])
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_SIZE) {
      socket.close(1009, 'Message too large')
      return
    }
    const messageBytes = new TextEncoder().encode(message).byteLength
    if (messageBytes > MAX_MESSAGE_SIZE) {
      socket.close(1009, 'Message too large')
      return
    }
    const now = Date.now()
    const previous = this.messageUsage.get(socket)
    const usage = previous && now - previous.startedAt < MESSAGE_WINDOW_MS
      ? previous : { startedAt: now, count: 0, bytes: 0 }
    usage.count += 1
    usage.bytes += messageBytes
    if (usage.count > MAX_MESSAGES_PER_WINDOW || usage.bytes > MAX_BYTES_PER_WINDOW) {
      socket.close(1008, 'Message rate exceeded')
      return
    }
    this.messageUsage.set(socket, usage)
    const role = this.state.getTags(socket)[0]
    const destination = role === 'app' ? 'phone' : 'app'
    if (role !== 'app' && role !== 'phone') return
    for (const peer of this.state.getWebSockets(destination)) {
      if (peer.readyState === 1) peer.send(message)
    }
  }
}
