// Online rooms for the 2-player modes. The game runs in both browsers (lockstep, see netSteps in js/game.js);
// this only pairs a host and a guest under a 4-letter code and passes each one's messages to the other.
// GET /net/ABCD?host=1 opens a room, GET /net/ABCD joins it (WebSocket upgrades). Everything else is the game's files.
// &lane=1 or &lane=2 adds a spare socket for a player already in: it carries copies of that player's inputs, so one
// stalled connection doesn't stall the game (netLanes in js/game.js). Lane k only talks to the other player's lane k.
export class Room {
  constructor(ctx) { this.ctx = ctx; }

  fetch(req) {
    const q = new URL(req.url).searchParams, role = q.has('host') ? 'host' : 'guest', lane = q.get('lane');
    const n = (r) => this.ctx.getWebSockets(r).length, tag = lane ? `${role}-${lane}` : role;
    const err = lane ? (!/^[12]$/.test(lane) || !n(role) || n(tag)) && 'no such player.'
      : role === 'host' ? n('host') && 'that room code is taken. try again.'
      : !n('host') ? 'no room with that code.' : n('guest') && 'that room is full.';
    const [client, server] = Object.values(new WebSocketPair());
    if (err) { server.accept(); server.send(JSON.stringify({ t: 'err', m: err })); server.close(4000, 'refused'); }
    else {
      this.ctx.acceptWebSocket(server, [tag]);
      if (tag === 'guest') for (const ws of this.ctx.getWebSockets()) ws.send('{"t":"peer"}');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    const [role, lane] = this.ctx.getTags(ws)[0].split('-');
    for (const o of this.ctx.getWebSockets((role === 'host' ? 'guest' : 'host') + (lane ? `-${lane}` : ''))) o.send(msg);
  }

  // either player leaving ends the room for both; a spare lane dropping changes nothing
  webSocketClose(ws) {
    if (this.ctx.getTags(ws)[0].includes('-')) { try { ws.close(1000, 'lane closed'); } catch (e) { /* already closing */ } return; }
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
