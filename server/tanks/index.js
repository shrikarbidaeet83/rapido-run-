// Shell Shock Arena on the shared Socket.IO server: the /tanks namespace and its room manager.

import {
  MAX_ROOMS, ROOM_CODE_LEN, ROOM_CODE_CHARS, RATE_LIMIT_PER_SEC, MAX_PLAYERS,
} from '../../shared/tanks/constants.js';
import { Room } from './room.js';

export function attachTanks(io, { fast = 1 } = {}) {
  const nsp = io.of('/tanks');
  const rooms = new Map();

  const send = (socketId, event, data) => {
    const sock = nsp.sockets.get(socketId);
    if (sock) sock.emit(event, data);
  };

  function newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LEN; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      if (!rooms.has(code)) return code;
    }
  }

  function createRoom(local = false) {
    if (rooms.size >= MAX_ROOMS) return null;
    const room = new Room(newCode(), { send, local, fast, onEmpty: (r) => rooms.delete(r.code) });
    rooms.set(room.code, room);
    return room;
  }

  const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(t);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const rid = () => Math.random().toString(36).slice(2, 12);

  nsp.on('connection', (socket) => {
    let budget = RATE_LIMIT_PER_SEC, strikes = 0;
    const refill = setInterval(() => {
      if (budget < 0) strikes++; else strikes = 0;
      if (strikes >= 5) socket.disconnect(true);
      budget = RATE_LIMIT_PER_SEC;
    }, 1000);

    const room = () => {
      const r = socket.data.code && rooms.get(socket.data.code);
      return r && !r.destroyed && r.members.has(socket.data.id) ? r : null;
    };
    const me = () => socket.data.id;

    function enter(r, msg, cb, extra = {}) {
      const token = validToken(msg.token) ? msg.token : rid() + rid();
      const id = `p-${rid()}`;
      const res = r.addMember({
        id, token, socketId: socket.id, name: str(msg.name, 40), color: str(msg.color, 10), style: str(msg.style, 12), ...extra,
      });
      if (res.error) return cb({ error: res.error });
      socket.data.code = r.code;
      socket.data.id = id;
      cb({ ok: true, code: r.code, id, spectator: res.member.spectator });
      return res.member;
    }

    function leaveCurrent() {
      const r = room();
      if (r) r.removeMember(socket.data.id);
      socket.data.code = null;
      socket.data.id = null;
    }

    const handlers = {
      create(msg, cb) {
        leaveCurrent();
        const r = createRoom();
        if (!r) return cb({ error: 'Server is full, try again later' });
        enter(r, msg, cb);
        if (msg.vsBot) { r.addBot(socket.data.id, ['easy', 'medium', 'hard'].includes(msg.vsBot) ? msg.vsBot : 'medium'); }
      },
      local(msg, cb) {
        leaveCurrent();
        const r = createRoom(true);
        if (!r) return cb({ error: 'Server is full, try again later' });
        const host = enter(r, msg, () => {});
        if (!host) return cb({ error: 'Could not create room' });
        r.addMember({ id: `p-${rid()}`, socketId: socket.id, name: str(msg.name2, 40) || 'Player 2', color: '', style: 'heavy', localOf: host.id });
        cb({ ok: true, code: r.code, id: host.id, local: true });
      },
      join(msg, cb) {
        const code = str(msg.code, 8).toUpperCase();
        const r = rooms.get(code);
        if (!r || r.destroyed) return cb({ error: 'Room not found' });
        if (r.local) return cb({ error: 'That is a local (same device) game' });
        if (socket.data.code === code && room()) return cb({ ok: true, code, id: socket.data.id });
        leaveCurrent();
        const back = r.findReconnect(msg.token);
        if (back) {
          socket.data.code = code;
          socket.data.id = back.id;
          r.reattach(back, socket.id);
          return cb({ ok: true, code, id: back.id, rejoined: true });
        }
        if ([...r.members.values()].length >= 16) return cb({ error: 'Room is full' });
        enter(r, msg, cb);
      },
      quick(msg, cb) {
        leaveCurrent();
        const open = [...rooms.values()].find((r) => !r.destroyed && r.settings.public && r.phase === 'lobby' && r.seats.length < MAX_PLAYERS);
        const r = open || createRoom();
        if (!r) return cb({ error: 'Server is full, try again later' });
        if (!open) r.settings.public = true;
        enter(r, msg, cb);
      },
      leave(_m, cb) { leaveCurrent(); cb({ ok: true }); },
      ready(msg) { const r = room(); if (r) r.setReady(me(), !!msg.ready); },
      look(msg) { room()?.setLook(me(), msg); },
      settings(msg) { room()?.setSettings(me(), msg); },
      team(msg) { room()?.setTeam(me(), str(msg.id, 40), msg.team); },
      addBot(msg) { room()?.addBot(me(), str(msg.level, 8)); },
      kick(msg) { room()?.kick(me(), str(msg.id, 40)); },
      start(_m, cb) { const r = room(); cb(r ? r.start(me()) : { error: 'No room' }); },
      pick(msg, cb) { const r = room(); cb(r ? r.pick(socket.id, msg.slot) : { error: 'No room' }); },
      aim(msg) { room()?.aim(socket.id, msg); },
      move(msg, cb) { const r = room(); cb(r ? r.move(socket.id, msg.dir) : { error: 'No room' }); },
      fire(msg, cb) { const r = room(); cb(r ? r.fire(socket.id, msg) : { error: 'No room' }); },
      chat(msg) { room()?.chat(me(), msg.text); },
      emoji(msg) {
        const r = room();
        if (!r) return;
        // in a local game, emojis come from whoever's turn it is
        const who = msg.as && r.controls(socket.id, msg.as) ? msg.as : me();
        r.emoji(who, msg.e);
      },
      rematch(_m, cb) { const r = room(); cb(r ? r.rematch(me()) : { error: 'No room' }); },
      lobby() { room()?.toLobby(me()); },
      sync() { const r = room(); if (r) { r.sendMatch(r.members.get(me())); if (!r.match) r.broadcastRoom(); } },
    };

    for (const [event, fn] of Object.entries(handlers)) {
      socket.on(event, (msg, cb) => {
        if (--budget < 0) return;
        const reply = typeof cb === 'function' ? cb : () => {};
        try {
          fn(msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : {}, reply);
        } catch (err) {
          console.error(`tanks handler ${event} failed:`, err);
          reply({ error: 'Server error' });
        }
      });
    }

    socket.on('disconnect', () => {
      clearInterval(refill);
      const r = room();
      if (r) r.disconnect(socket.id);
    });
  });

  return {
    nsp, rooms,
    close() { for (const r of rooms.values()) r.destroy(); rooms.clear(); },
  };
}
