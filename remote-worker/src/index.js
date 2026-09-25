// Blind, ephemeral relay: no KV, R2, database, message parsing, or payload logs.
const ROOM_PATH = /^\/relay\/([A-Za-z0-9_-]{22})$/
const MAX_MESSAGE_SIZE = 2_000_000

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const match = ROOM_PATH.exec(url.pathname)
    const role = url.searchParams.get('role')
    if (!match || !['app', 'phone'].includes(role) || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Not found', { status: 404 })
    }
    const origin = request.headers.get('Origin')
    if (role === 'phone' && origin !== env.WEB_ORIGIN) return new Response('Forbidden', { status: 403 })
    const room = env.ROOMS.getByName(match[1])
    return room.fetch(request)
  },
}

export class RelayRoom {
  constructor(state) { this.state = state }

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
    const role = this.state.getTags(socket)[0]
    const destination = role === 'app' ? 'phone' : 'app'
    if (role !== 'app' && role !== 'phone') return
    for (const peer of this.state.getWebSockets(destination)) {
      if (peer.readyState === 1) peer.send(message)
    }
  }
}
