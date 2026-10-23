// Express + Socket.IO server and room manager.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Server } from 'socket.io';
import { Room, getTrack } from './room.js';
import { MAPS } from '../shared/maps.js';
import { validateTrack } from '../shared/track.js';
import { MAX_PLAYERS, RATE_LIMIT_PER_SEC, ROOM_CODE_LEN } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// Refuse to start with a broken map.
export function validateAllMaps() {
  for (const map of MAPS) {
    const errors = validateTrack(getTrack(map.id));
    if (errors.length) throw new Error(`Map "${map.name}" is invalid: ${errors.join('; ')}`);
  }
}

// CORS_ORIGIN="https://my-game.vercel.app,https://*.vercel.app" lets a front end hosted
// elsewhere (e.g. Vercel) connect. Unset = same origin only. "*" = anyone.
export function corsCheck(list) {
  const patterns = String(list || '').split(',').map((p) => p.trim().replace(/\/$/, '')).filter(Boolean);
  if (!patterns.length) return false;
  if (patterns.includes('*')) return true;
  const regexes = patterns.map((p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/.]*') + '$'));
  return (origin, cb) => cb(null, !origin || regexes.some((r) => r.test(origin)));
}

export function createGameServer({ corsOrigin = process.env.CORS_ORIGIN } = {}) {
  validateAllMaps();
  const app = express();
  app.disable('x-powered-by');
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public')));
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

  const httpServer = http.createServer(app);
  const origin = corsCheck(corsOrigin);
  const io = new Server(httpServer, {
    maxHttpBufferSize: 4096, pingInterval: 5000, pingTimeout: 10000,
    cors: origin ? { origin, methods: ['GET', 'POST'] } : undefined,
    // also refuse cross-site WebSocket upgrades that CORS alone would not stop
    allowRequest: (req, cb) => {
      const o = req.headers.origin;
      let sameHost = false;
      try { sameHost = !!o && new URL(o).host === req.headers.host; } catch { /* malformed Origin */ }
      if (!o || sameHost || origin === true) return cb(null, true);
      if (typeof origin === 'function') return origin(o, (err, ok) => cb(null, !!ok));
      cb(null, false);
    },
  });
  const rooms = new Map();

  const send = (player, event, data) => {
    const sock = io.sockets.sockets.get(player.socketId);
    if (sock) sock.emit(event, data);
  };

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function createRoom() {
    const room = new Room(newCode(), { send, onEmpty: (r) => rooms.delete(r.code) });
    rooms.set(room.code, room);
    return room;
  }

  const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(t);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  io.on('connection', (socket) => {
    // simple per-socket rate limit
    let budget = RATE_LIMIT_PER_SEC, strikes = 0;
    const refill = setInterval(() => {
      if (budget < 0) strikes++; else strikes = 0;
      if (strikes >= 5) socket.disconnect(true);
      budget = RATE_LIMIT_PER_SEC;
    }, 1000);

    const ctx = () => {
      const room = socket.data.roomCode && rooms.get(socket.data.roomCode);
      return room && room.players.has(socket.data.playerId) ? room : null;
    };

    function enter(room, msg, cb) {
      let id = validToken(msg.token) ? msg.token : Math.random().toString(36).slice(2, 12);
      if (room.players.has(id)) id = `${id.slice(0, 30)}-${Math.random().toString(36).slice(2, 7)}`;
      const res = room.addPlayer({ id, socketId: socket.id, name: str(msg.name, 40), color: str(msg.color, 10) });
      if (res.error) return cb({ error: res.error });
      socket.data.roomCode = room.code;
      socket.data.playerId = id;
      socket.join(room.code);
      cb({ ok: true, code: room.code, id });
    }

    function leaveCurrent() {
      const room = ctx();
      if (room) {
        socket.leave(room.code);
        room.removePlayer(socket.data.playerId);
      }
      socket.data.roomCode = null;
      socket.data.playerId = null;
    }

    const handlers = {
      create(msg, cb) {
        leaveCurrent();
        enter(createRoom(), msg, cb);
      },
      join(msg, cb) {
        const code = str(msg.code, 8).toUpperCase();
        const room = rooms.get(code);
        if (!room) return cb({ error: 'Room not found' });
        if (socket.data.roomCode === code && ctx()) return cb({ ok: true, code, id: socket.data.playerId });
        leaveCurrent();
        const back = room.findReconnect(msg.token, str(msg.name, 40));
        if (back) {
          socket.data.roomCode = code;
          socket.data.playerId = back.id;
          socket.join(code);
          room.reattach(back, socket.id);
          return cb({ ok: true, code, id: back.id, rejoined: true });
        }
        if (room.players.size >= MAX_PLAYERS) return cb({ error: 'Room is full' });
        enter(room, msg, cb);
      },
      quick(msg, cb) {
        leaveCurrent();
        const open = [...rooms.values()].find((r) => r.phase === 'lobby' && r.players.size < MAX_PLAYERS);
        enter(open || createRoom(), msg, cb);
      },
      leave(_msg, cb) { leaveCurrent(); cb({ ok: true }); },
      ready(msg) { ctx()?.setReady(socket.data.playerId, !!msg); },
      color(msg) { ctx()?.setColor(socket.data.playerId, str(msg, 10)); },
      map(msg) { ctx()?.setMap(socket.data.playerId, str(msg, 40)); },
      bots(msg) { ctx()?.setFillBots(socket.data.playerId, !!msg); },
      start(_msg, cb) {
        const room = ctx();
        const ok = !!room && room.startRace(socket.data.playerId);
        cb({ ok, error: ok ? undefined : 'Need at least one ready player (host only)' });
      },
      lobby() { ctx()?.backToLobby(socket.data.playerId); },
      input(msg) {
        if (Array.isArray(msg)) ctx()?.queueInputs(socket.data.playerId, msg[0], msg[1]);
      },
      respawn() { ctx()?.requestRespawn(socket.data.playerId); },
      latency(_msg, cb) { cb(Date.now()); },
    };

    for (const [event, fn] of Object.entries(handlers)) {
      socket.on(event, (msg, cb) => {
        if (--budget < 0) return;
        const reply = typeof cb === 'function' ? cb : () => {};
        try {
          fn(msg && typeof msg === 'object' ? msg : msg ?? {}, reply);
        } catch (err) {
          console.error(`handler ${event} failed:`, err);
          reply({ error: 'Server error' });
        }
      });
    }

    socket.on('disconnect', () => {
      clearInterval(refill);
      const room = ctx();
      if (room) room.disconnect(socket.data.playerId);
    });
  });

  return {
    app, io, httpServer, rooms,
    listen(port) {
      return new Promise((resolve) => httpServer.listen(port, () => resolve(httpServer.address().port)));
    },
    close() {
      for (const room of rooms.values()) room.destroy();
      io.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const server = createGameServer();
  const port = await server.listen(Number(process.env.PORT) || 3000);
  console.log(`Tiny Racers running on http://localhost:${port}`);
}
