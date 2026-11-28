// Online rooms for the 2-player modes. The game runs in both browsers (lockstep, see netSteps in js/game.js);
// this only pairs a host and a guest under a 4-letter code and passes each one's messages to the other.
// GET /net/ABCD?host=1 opens a room, GET /net/ABCD joins it (WebSocket upgrades). Everything else is the game's files.
export class Room {
  constructor(ctx) { this.ctx = ctx; }

  fetch(req) {
    const role = new URL(req.url).searchParams.has('host') ? 'host' : 'guest';
    const n = (r) => this.ctx.getWebSockets(r).length;
    const err = role === 'host' ? n('host') && 'that room code is taken. try again.'
      : !n('host') ? 'no room with that code.' : n('guest') && 'that room is full.';
    const [client, server] = Object.values(new WebSocketPair());
    if (err) { server.accept(); server.send(JSON.stringify({ t: 'err', m: err })); server.close(4000, 'refused'); }
    else {
      this.ctx.acceptWebSocket(server, [role]);
      if (role === 'guest') for (const ws of this.ctx.getWebSockets()) ws.send('{"t":"peer"}');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    for (const o of this.ctx.getWebSockets()) if (o !== ws) o.send(msg);
  }

  // either player leaving ends the room for both
  webSocketClose(ws) {
    for (const o of this.ctx.getWebSockets()) {
      try { if (o !== ws) o.send('{"t":"left"}'); o.close(1000, 'room closed'); } catch (e) { /* already closing */ }
    }
  }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/net\/([A-Z]{4})$/);
    if (!m) return env.ASSETS.fetch(req);
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};
