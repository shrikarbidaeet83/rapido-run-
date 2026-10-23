// Screens, networking, client-side prediction + interpolation, HUD.

import {
  TICK_MS, LAPS, CHECKPOINTS, CAR_COLORS, INTERP_DELAY_MS, SNAP_DISTANCE, BOOST,
  PHYSICS, NAME_MAX,
} from '/shared/constants.js';
import { MAPS, getMap } from '/shared/maps.js';
import { buildTrack } from '/shared/track.js';
import { createCar, stepCar } from '/shared/physics.js';
import { Renderer, drawThumbnail, prerenderTrack } from './render.js';
import { Backdrop } from './scenery.js';
import { createInput, inputBits } from './input.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const TOP_SPEED = PHYSICS.maxPower * PHYSICS.drag / (1 - PHYSICS.drag);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- identity & prefs ----------
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
function makeToken() { return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join(''); }
let token;
try { token = sessionStorage.getItem('tr-token') || makeToken(); sessionStorage.setItem('tr-token', token); } catch { token = makeToken(); }
const prefs = {
  name: store.get('tr-name', '') || `Driver${100 + Math.floor(Math.random() * 900)}`,
  color: store.get('tr-color', CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]),
};

// ---------- server connection ----------
// The Socket.IO client comes from the game server itself, so versions always match,
// and the page can be hosted somewhere else (see config.js).
const SERVER = String(window.TINY_RACERS_SERVER || '').replace(/\/+$/, '');

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(s);
  });
}

try {
  if (!window.io) await loadScript(`${SERVER}/socket.io/socket.io.js`);
} catch {
  document.getElementById('home-error').textContent = 'Cannot reach the game server. Try again in a minute.';
  throw new Error(`game server unreachable: ${SERVER || location.origin}`);
}

// ---------- state ----------
const socket = SERVER
  ? window.io(SERVER, { transports: ['websocket', 'polling'] })
  : window.io({ transports: ['websocket', 'polling'] });
let room = null;        // latest room info from the server
let roomCode = null;
let game = null;        // current race (client side)
let results = null;
let ping = 0;
let showStats = false;
let paused = false;

const renderer = new Renderer($('canvas'), $('minimap'));
const backdrop = new Backdrop($('backdrop'), prerenderTrack);
backdrop.start();
const input = createInput({
  onRespawn: () => { if (game && game.you >= 0) socket.emit('respawn'); },
  onPause: () => { if (game) setPaused(!paused); },
  onMute: () => updateMute(audio.toggleMute()),
  onStats: () => { showStats = !showStats; $('stats').classList.toggle('show', showStats); },
  isTyping: () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName),
});

// ---------- helpers ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
  if (id === 'game') backdrop.stop(); else backdrop.start(); // live track scene behind the menus
  if (id !== 'game') setPaused(false);
}

export function fmt(ms) {
  if (ms == null || !Number.isFinite(ms)) return '-';
  ms = Math.max(0, Math.round(ms));
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k === 'text') e.textContent = v;
    else e[k] = v;
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function dot(color) { return el('span', { class: 'dot', style: { background: color } }); }
const lapsDone = (cp) => (cp >= 1 ? Math.floor((cp - 1) / CHECKPOINTS) : 0);

function setError(id, msg) { $(id).textContent = msg || ''; }

function updateMute(muted) { $('btn-mute').textContent = muted ? 'Unmute (M)' : 'Mute (M)'; }
updateMute(audio.muted);

function setPaused(p) {
  paused = p;
  $('pause').classList.toggle('show', p);
}

// first gesture unlocks audio (autoplay policy)
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ---------- home ----------
$('name').value = prefs.name;
$('name').addEventListener('input', () => {
  prefs.name = $('name').value.slice(0, NAME_MAX);
  store.set('tr-name', prefs.name);
});

function renderSwatches(container, selected, taken, onPick) {
  container.replaceChildren(...CAR_COLORS.map((c) => {
    const b = el('button', { class: 'swatch', title: c, type: 'button', style: { background: c } });
    if (c === selected) b.classList.add('selected');
    if (taken.has(c)) { b.classList.add('taken'); b.disabled = true; }
    b.addEventListener('click', () => onPick(c));
    return b;
  }));
}
function renderHomeColors() {
  renderSwatches($('colors'), prefs.color, new Set(), (c) => {
    prefs.color = c;
    store.set('tr-color', c);
    renderHomeColors();
  });
}
renderHomeColors();

const params = new URLSearchParams(location.search);
if (params.get('room')) $('join-code').value = params.get('room').toUpperCase().slice(0, 4);

function hello() { return { name: prefs.name, color: prefs.color, token }; }

function onEntered(res, errorBox) {
  if (!res || res.error) { setError(errorBox, res ? res.error : 'No response from server'); return; }
  setError(errorBox, '');
  roomCode = res.code;
  history.replaceState(null, '', `?room=${res.code}`);
}

$('btn-create').addEventListener('click', () => socket.emit('create', hello(), (r) => onEntered(r, 'home-error')));
$('btn-quick').addEventListener('click', () => socket.emit('quick', hello(), (r) => onEntered(r, 'home-error')));
$('btn-join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { setError('home-error', 'Enter a 4-letter room code'); return; }
  socket.emit('join', { ...hello(), code }, (r) => onEntered(r, 'home-error'));
});
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });

function goHome(msg) {
  room = null; roomCode = null; results = null;
  endGame();
  history.replaceState(null, '', location.pathname);
  show('home');
  setError('home-error', msg || '');
}

// ---------- lobby ----------
const mapCards = new Map();
function buildMapCards() {
  if (mapCards.size) return;
  for (const map of MAPS) {
    const cv = el('canvas', { width: 240, height: 160 });
    drawThumbnail(cv, map);
    const card = el('div', { class: 'map', title: map.name },
      cv, el('div', { text: map.name }), el('div', { class: 'diff', text: map.difficulty }));
    card.addEventListener('click', () => {
      if (room && room.hostId === room.you) socket.emit('map', map.id);
    });
    mapCards.set(map.id, card);
  }
  $('maps').replaceChildren(...mapCards.values());
  $('again-map').replaceChildren(...MAPS.map((m) => el('option', { value: m.id, text: `${m.name} (${m.difficulty})` })));
}

function sessionTable(rows) {
  if (!rows || !rows.length) return el('div');
  const tbody = el('tbody', {}, ...rows.map((r) => el('tr', {},
    el('td', {}, dot(r.color), ' ', el('span', { text: r.name })),
    el('td', { text: String(r.wins) }), el('td', { text: String(r.points) }), el('td', { text: String(r.races) }))));
  return el('table', {}, el('thead', {}, el('tr', {},
    el('th', { text: 'Driver' }), el('th', { text: 'Wins' }), el('th', { text: 'Points' }), el('th', { text: 'Races' }))), tbody);
}

function renderLobby() {
  if (!room) return;
  buildMapCards();
  const isHost = room.hostId === room.you;
  const me = room.players.find((p) => p.id === room.you);
  $('room-code').textContent = room.code;
  $('player-count').textContent = String(room.players.length);
  $('player-list').replaceChildren(...room.players.map((p) => el('li', {},
    dot(p.color),
    el('span', { text: p.name + (p.id === room.you ? ' (you)' : '') }),
    p.id === room.hostId ? el('span', { text: '👑', title: 'Host' }) : null,
    el('span', { class: 'tag' + (p.ready ? ' ready' : ''), text: !p.connected ? 'reconnecting…' : p.ready ? 'READY' : 'not ready' }))));
  const taken = new Set(room.players.filter((p) => p.id !== room.you).map((p) => p.color));
  renderSwatches($('lobby-colors'), me && me.color, taken, (c) => {
    prefs.color = c; store.set('tr-color', c);
    socket.emit('color', c);
  });
  for (const [id, card] of mapCards) {
    card.classList.toggle('selected', id === room.mapId);
    card.classList.toggle('locked', !isHost);
  }
  $('map-hint').textContent = isHost ? '(click to choose)' : '(host chooses)';
  $('bots').checked = room.fillBots;
  $('bots').disabled = !isHost;
  $('btn-ready').textContent = me && me.ready ? 'Ready ✓' : 'Ready';
  $('btn-ready').classList.toggle('on', !!(me && me.ready));
  const anyReady = room.players.some((p) => p.ready);
  $('btn-start').disabled = !isHost || !anyReady;
  $('btn-start').title = isHost ? (anyReady ? '' : 'At least one player must be ready') : 'Only the host can start';
  $('lobby-session').replaceChildren(room.session.length ? el('div', { class: 'label', text: 'Room leaderboard' }) : '', sessionTable(room.session));
}

$('btn-ready').addEventListener('click', () => {
  const me = room && room.players.find((p) => p.id === room.you);
  socket.emit('ready', !(me && me.ready));
});
$('bots').addEventListener('change', () => socket.emit('bots', $('bots').checked));
$('btn-start').addEventListener('click', () => socket.emit('start', {}, (r) => setError('lobby-error', r && !r.ok ? r.error : '')));
$('btn-copy').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${room.code}`;
  try { await navigator.clipboard.writeText(link); $('copy-ok').textContent = 'Copied!'; } catch { $('copy-ok').textContent = link; }
  setTimeout(() => { $('copy-ok').textContent = ''; }, 2500);
});
const leave = () => socket.emit('leave', {}, () => goHome());
$('btn-leave').addEventListener('click', leave);
$('btn-leave2').addEventListener('click', leave);

// ---------- results ----------
function renderResults() {
  if (!results) return;
  buildMapCards();
  const isHost = room && room.hostId === room.you;
  $('results-map').textContent = `· ${getMap(results.mapId).name}`;
  const rows = results.rows;
  const podium = [rows[1], rows[0], rows[2]].filter(Boolean).map((r) => el('div', { class: 'step' },
    el('div', { class: 'mini-car', style: { background: r.color } }, el('i')),
    el('div', { class: 'name', text: r.name + (r.winner ? ' 🏆' : '') }),
    el('div', { class: 'block', style: { height: `${r.pos === 1 ? 70 : r.pos === 2 ? 50 : 36}px` }, text: String(r.pos) })));
  $('podium').replaceChildren(...podium);
  $('results-table').querySelector('tbody').replaceChildren(...rows.map((r) => el('tr', { class: (r.winner ? 'winner' : '') + (room && r.id === room.you ? ' me' : '') },
    el('td', { text: String(r.pos) }),
    el('td', {}, dot(r.color), ' ', el('span', { text: r.name }), r.winner ? el('b', { text: ' 🏆 WINNER' }) : null),
    el('td', { text: fmt(r.totalMs) }),
    el('td', { text: fmt(r.bestLapMs) }),
    el('td', { text: r.status === 'DNF' ? `${r.laps}/${LAPS} laps` : r.gapMs === 0 ? '-' : `+${fmt(r.gapMs)}` }),
    el('td', { text: r.status }))));
  $('results-session').replaceChildren(sessionTable(results.session));
  $('again-map').value = room ? room.mapId : results.mapId;
  $('again-map').disabled = !isHost;
  $('btn-again').disabled = !isHost;
  $('btn-lobby').disabled = !isHost;
  $('results-wait').textContent = isHost ? '' : 'Waiting for the host to start the next race…';
}
$('again-map').addEventListener('change', () => socket.emit('map', $('again-map').value));
$('btn-again').addEventListener('click', () => socket.emit('start', {}, () => {}));
$('btn-lobby').addEventListener('click', () => socket.emit('lobby'));

// ---------- pause menu ----------
$('btn-menu').addEventListener('click', () => setPaused(true));
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-mute').addEventListener('click', () => updateMute(audio.toggleMute()));
$('btn-quit').addEventListener('click', leave);
$('btn-respawn').addEventListener('click', () => { if (game && game.you >= 0) socket.emit('respawn'); });

// ---------- networking ----------
let everConnected = false;
socket.on('connect', () => {
  if (everConnected && roomCode) {
    socket.emit('join', { ...hello(), code: roomCode }, (r) => { if (!r || r.error) goHome('Lost connection to the room'); });
  }
  everConnected = true;
  banner('', 0);
});
socket.on('disconnect', () => { if (game) banner('Reconnecting…', 60000); });
socket.on('connect_error', () => {
  if (!roomCode) setError('home-error', 'Connecting to the game server… (a sleeping free server can take ~30 s to wake up)');
});
socket.on('connect', () => { if (!roomCode) setError('home-error', ''); });

socket.on('room', (info) => {
  room = info;
  roomCode = info.code;
  if (info.phase === 'lobby') {
    endGame();
    results = null;
    show('lobby');
    renderLobby();
  } else if (info.phase === 'results') {
    renderResults();
  }
});

socket.on('race', (info) => startGame(info));

socket.on('results', (r) => {
  results = r;
  endGame();
  show('results');
  renderResults();
});

socket.on('s', (snap) => onSnapshot(snap));

setInterval(() => {
  if (!socket.connected) return;
  const t = performance.now();
  socket.emit('latency', {}, () => { ping = Math.round(performance.now() - t); });
}, 2000);

// ---------- game ----------
function startGame(info) {
  const track = buildTrack(getMap(info.mapId));
  game = {
    track, you: info.you, goTick: info.goTick, laps: info.laps,
    cars: info.cars.map((c) => {
      const slot = track.gridSlots[c.index];
      return { ...c, x: slot.x, y: slot.y, angle: slot.angle, vx: 0, vy: 0, flags: 0, cpPassed: 0,
        lapStart: info.goTick, best: 0, finishMs: 0, cpTimes: [], removed: false, me: c.index === info.you };
    }),
    snaps: [], offsets: [], clockOffset: null, pred: null, history: [], offset: { x: 0, y: 0, a: 0 },
    localTick: 0, pending: [], pendingStart: 0, tickDelta: null, acc: 0, order: info.cars.map((c) => c.index), grace: -1,
    lastCount: null, goShown: false, winnerShown: false, hudAt: 0,
  };
  if (game.you >= 0) {
    const slot = track.gridSlots[game.you];
    game.pred = createCar(slot.x, slot.y, slot.angle, slot.seg);
  }
  renderer.setTrack(track);
  input.releaseAll();
  $('btn-respawn').style.display = game.you >= 0 ? '' : 'none';
  $('boost').style.display = game.you >= 0 ? '' : 'none';
  show('game');
  banner(game.you >= 0 ? '' : 'Spectating', 3000);
}

function endGame() {
  if (!game) return;
  game = null;
  renderer.clear();
  audio.engine(0, false);
  $('wrongway').classList.remove('show');
  $('lights').classList.remove('show');
}

function serverTick() {
  return game.clockOffset == null ? 0 : (performance.now() + game.clockOffset) / TICK_MS;
}

// own car, full precision: [x, y, angle, vx, vy, power, reverse, angularVelocity, boost, boostTicks, seg]
function unpackOwn(m) {
  return {
    x: m[0], y: m[1], angle: m[2], xVelocity: m[3], yVelocity: m[4], power: m[5], reverse: m[6],
    angularVelocity: m[7], boost: m[8], boostTicks: m[9], seg: m[10], onKerb: false, drifting: false,
  };
}

function onSnapshot(snap) {
  if (!game) return;
  const now = performance.now();
  // Server clock estimate. Packets arrive with varying delay; the least-delayed
  // recent one (largest offset) is the best estimate, and we glide toward it so
  // the interpolation timeline never jumps.
  game.offsets.push(snap.t * TICK_MS - now);
  if (game.offsets.length > 40) game.offsets.shift();
  const best = Math.max(...game.offsets);
  if (game.clockOffset == null || Math.abs(best - game.clockOffset) > 300) game.clockOffset = best;
  else game.clockOffset += (best - game.clockOffset) * 0.05;

  game.snaps.push(snap);
  if (game.snaps.length > 30) game.snaps.shift();
  game.order = snap.o;
  game.grace = snap.g;

  for (let i = 0; i < game.cars.length; i++) {
    const car = game.cars[i], c = snap.c[i];
    if (c[9] !== car.cpPassed) car.cpTimes[c[9]] = snap.t;
    car.flags = c[8]; car.cpPassed = c[9]; car.lapStart = c[10]; car.best = c[11]; car.finishMs = c[12];
    car.removed = !!(c[8] & 32);
  }

  for (const e of snap.e) handleEvent(e);
  if (game.you >= 0) reconcile(snap);
}

// Server tick at which our local tick `t` gets (or got) simulated.
const serverTickFor = (t) => t + game.tickDelta;
const isLive = (t) => game.tickDelta != null && serverTickFor(t) > game.goTick && !game.cars[game.you].removed;

function reconcile(snap) {
  if (!snap.m) return;
  const server = unpackOwn(snap.m);
  if (snap.a < 0) { game.pred = server; return; } // server has not used any of our ticks yet
  // The server has simulated our ticks up to snap.a; the state it sent is the
  // result. Replay exactly the ticks it has not processed yet on top of it.
  game.tickDelta = snap.t - snap.a;
  game.history = game.history.filter((h) => h.tick > snap.a);
  let rec = server;
  for (const h of game.history) if (isLive(h.tick)) rec = stepCar(rec, h.input, game.track);
  const p = game.pred;
  const err = Math.hypot(rec.x - p.x, rec.y - p.y);
  if (err > SNAP_DISTANCE) {
    game.offset.x = game.offset.y = game.offset.a = 0;
  } else {
    game.offset.x += p.x - rec.x;
    game.offset.y += p.y - rec.y;
    game.offset.a += wrap(p.angle - rec.angle);
  }
  game.pred = rec;
}

function cameraDistance(x, y) {
  return Math.hypot(x - renderer.cam.x, y - renderer.cam.y);
}

function handleEvent(e) {
  const you = game.you;
  if (e[0] === 'c') {
    const [, x, y, impact, a, b] = e;
    renderer.emit(x, y, Math.min(16, 4 + impact * 6), 'spark', Math.min(2, 0.6 + impact * 0.5));
    const near = Math.max(0, 1 - cameraDistance(x, y) / 400);
    audio.crash(Math.min(1, impact / 2.5) * near);
    if ((a === you || b === you) && impact > 0.8) renderer.addShake(impact * 1.5);
  } else if (e[0] === 'w') {
    const [, x, y, impact, id] = e;
    renderer.emit(x, y, Math.min(12, 3 + impact * 5), 'spark', Math.min(2, 0.5 + impact * 0.5));
    const near = Math.max(0, 1 - cameraDistance(x, y) / 400);
    audio.crash(Math.min(1, impact / 3) * near * 0.7);
    if (id === you && impact > 1) renderer.addShake(impact);
  } else if (e[0] === 'l') {
    const [, idx, fin] = e;
    const car = game.cars[idx];
    if (fin && !game.winnerShown) {
      game.winnerShown = true;
      banner(idx === you ? '🏆 YOU WIN!' : `🏆 ${car.name} wins!`, 3000);
      if (idx === you) audio.fanfare();
      else if (you >= 0) audio.beep(true);
    } else if (idx === you) {
      if (fin) { banner(`Finished P${game.order.indexOf(you) + 1}`, 4000); audio.fanfare(); } else {
        const done = lapsDone(car.cpPassed);
        banner(done === LAPS - 1 ? 'Final lap!' : `Lap ${Math.min(LAPS, done + 1)}`, 1500);
        audio.beep(true);
      }
    }
  }
}

let bannerTimer = null;
function banner(text, ms) {
  clearTimeout(bannerTimer);
  $('banner').textContent = text;
  $('banner').classList.toggle('show', !!text);
  if (text && ms) bannerTimer = setTimeout(() => $('banner').classList.remove('show'), ms);
}

// Every local physics tick is numbered and its input is sent; the server applies
// exactly one per tick. Sent once per frame (all ticks simulated in that frame).
function flushInputs() {
  if (!game.pending.length || !socket.connected) return;
  socket.emit('input', [game.pendingStart, game.pending]);
  game.pending = [];
}

// other cars: interpolated ~120 ms in the past, briefly extrapolated if a packet is late
function interpolate(renderTick) {
  const snaps = game.snaps;
  if (!snaps.length) return;
  const last = snaps[snaps.length - 1];
  let a = snaps[0], b = snaps[0], extra = 0;
  if (renderTick >= last.t) {
    a = b = last;
    extra = Math.min(renderTick - last.t, 6);
  } else {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= renderTick) { a = snaps[i]; b = snaps[i + 1]; break; }
    }
  }
  const f = b.t > a.t ? (renderTick - a.t) / (b.t - a.t) : 0;
  for (let i = 0; i < game.cars.length; i++) {
    if (i === game.you) continue;
    const car = game.cars[i], ca = a.c[i], cb = b.c[i];
    if (Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) > 50) { // teleport (respawn): don't slide across the map
      car.x = cb[0]; car.y = cb[1]; car.angle = cb[2];
    } else {
      car.x = ca[0] + (cb[0] - ca[0]) * f + cb[3] * extra;
      car.y = ca[1] + (cb[1] - ca[1]) * f + cb[4] * extra;
      car.angle = ca[2] + wrap(cb[2] - ca[2]) * f + cb[7] * extra;
    }
    car.vx = cb[3]; car.vy = cb[4];
    car.ghost = !!(cb[8] & 1);
    car.boosting = !!(cb[8] & 64);
  }
}

let lastFrame = performance.now(), fpsFrames = 0, fpsTime = 0, fps = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  fpsFrames++; fpsTime += dt;
  if (fpsTime >= 500) { fps = Math.round((fpsFrames * 1000) / fpsTime); fpsFrames = 0; fpsTime = 0; }
  if (!game) return;

  const inp = input.poll();
  const st = serverTick();
  const me = game.you >= 0 ? game.cars[game.you] : null;

  // own car: fixed-step prediction with the shared physics, one numbered input per tick
  game.acc += dt;
  while (game.acc >= TICK_MS) {
    game.acc -= TICK_MS;
    if (!me) continue;
    const tick = game.localTick++;
    if (!game.pending.length) game.pendingStart = tick;
    game.pending.push(inputBits(inp));
    if (game.pending.length > 60) { game.pending.shift(); game.pendingStart++; }
    if (isLive(tick)) {
      const wasBoosting = game.pred.boostTicks > 0;
      game.pred = stepCar(game.pred, inp, game.track);
      if (!wasBoosting && game.pred.boostTicks > 0) audio.boost();
    }
    game.history.push({ tick, input: { ...inp } });
    if (game.history.length > 300) game.history.shift();
  }
  flushInputs();
  const k = Math.pow(0.5, dt / 60); // blend away reconciliation error
  game.offset.x *= k; game.offset.y *= k; game.offset.a *= k;

  interpolate(st - INTERP_DELAY_MS / TICK_MS);
  if (me && game.pred) {
    me.x = game.pred.x + game.offset.x;
    me.y = game.pred.y + game.offset.y;
    me.angle = game.pred.angle + game.offset.a;
    me.vx = game.pred.xVelocity; me.vy = game.pred.yVelocity;
    me.ghost = !!(me.flags & 1);
    me.boosting = game.pred.boostTicks > 0;
  }

  // skid marks, edge dust, boost flames
  for (const car of game.cars) {
    if (car.removed) continue;
    const speed = Math.hypot(car.vx, car.vy);
    const slip = Math.abs(car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle));
    if (slip > 0.45 && speed > 0.6) renderer.addSkid(car, now);
    if (car.flags & 2 && speed > 0.5 && Math.random() < 0.35) renderer.emit(car.x, car.y, 1, 'dust');
    if (car.boosting) renderer.flame(car);
  }

  const leader = game.cars[game.order[0]];
  const focus = me && !me.removed ? me : leader;
  renderer.draw({ cars: game.cars, focus, dt, now });
  renderer.drawMinimap(game.cars);

  const speed01 = me ? Math.min(1, Math.hypot(me.vx, me.vy) / TOP_SPEED) : 0;
  audio.engine(speed01, !!me && !me.removed && !paused);

  updateCountdown(st);
  if (now - game.hudAt > 100) { game.hudAt = now; updateHud(st, speed01); }
}

function updateCountdown(st) {
  const lights = $('lights');
  if (game.clockOffset == null) return;
  if (st < game.goTick) {
    lights.classList.add('show');
    const progress = st / game.goTick;
    const lit = Math.min(5, Math.floor(progress * 5) + 1);
    lights.querySelectorAll('i').forEach((l, i) => l.classList.toggle('on', i < lit));
    const count = Math.ceil(((game.goTick - st) * TICK_MS) / 1000);
    $('count').textContent = String(count);
    if (count !== game.lastCount) { game.lastCount = count; audio.beep(false); }
  } else {
    lights.classList.remove('show');
    if (!game.goShown) {
      game.goShown = true;
      if (st - game.goTick < 60) { banner('GO!', 1000); audio.beep(true); }
    }
  }
}

function updateHud(st, speed01) {
  const me = game.you >= 0 ? game.cars[game.you] : null;
  const started = st >= game.goTick;
  const total = game.cars.length;
  if (me) {
    const pos = game.order.indexOf(game.you) + 1;
    const finished = !!(me.flags & 8);
    $('hud-pos').textContent = `P${pos}/${total}`;
    $('hud-lap').textContent = finished ? 'Finished' : me.removed ? 'DNF' : `Lap ${Math.min(LAPS, lapsDone(me.cpPassed) + 1)}/${LAPS}`;
    $('hud-laptime').textContent = started && !finished ? fmt((st - me.lapStart) * TICK_MS) : '-';
    $('hud-best').textContent = me.best ? fmt(me.best) : '-';
    $('hud-total').textContent = finished ? fmt(me.finishMs) : fmt(started ? (st - game.goTick) * TICK_MS : 0);
    $('speedfill').style.width = `${Math.round(speed01 * 100)}%`;
    const pred = game.pred || { boost: 0, boostTicks: 0 };
    const active = pred.boostTicks > 0, ready = !active && pred.boost >= 1;
    $('boost').classList.toggle('ready', ready);
    $('boost').classList.toggle('active', active);
    $('boostfill').style.width = `${Math.round((active ? pred.boostTicks / BOOST.durationTicks : pred.boost) * 100)}%`;
    $('boost-pct').textContent = active ? 'BOOST!' : `${Math.floor(pred.boost * 100)}%`;
    $('boost-label').textContent = ready ? (document.body.classList.contains('touch') ? 'Boost ready!' : 'Boost ready (Space)') : 'Boost';
    $('wrongway').classList.toggle('show', !!(me.flags & 4) && !finished);
  } else {
    $('hud-pos').textContent = 'Spectating';
    $('hud-lap').textContent = `${LAPS} laps`;
    $('hud-total').textContent = fmt(started ? (st - game.goTick) * TICK_MS : 0);
  }

  // live mini leaderboard
  const leader = game.cars[game.order[0]];
  const items = [];
  if (game.grace >= 0) items.push(el('li', {}, el('b', { text: `Race ends in ${Math.ceil(game.grace * TICK_MS / 1000)}s` })));
  game.order.forEach((idx, i) => {
    const c = game.cars[idx];
    let gap = '';
    if (c.removed || c.flags & 16) gap = 'DNF';
    else if (i === 0) gap = c.flags & 8 ? fmt(c.finishMs) : 'Leader';
    else if (c.flags & 8 && leader.flags & 8) gap = `+${((c.finishMs - leader.finishMs) / 1000).toFixed(1)}`;
    else {
      const lapsBehind = Math.floor((leader.cpPassed - c.cpPassed) / CHECKPOINTS);
      if (lapsBehind >= 1) gap = `+${lapsBehind} LAP${lapsBehind > 1 ? 'S' : ''}`;
      else if (c.cpTimes[c.cpPassed] != null && leader.cpTimes[c.cpPassed] != null) {
        gap = `+${(((c.cpTimes[c.cpPassed] - leader.cpTimes[c.cpPassed]) * TICK_MS) / 1000).toFixed(1)}`;
      }
    }
    items.push(el('li', { class: (idx === game.you ? 'me' : '') + (c.removed ? ' out' : '') },
      el('span', { class: 'p', text: String(i + 1) }), dot(c.color), el('span', { class: 'n', text: c.name }), el('span', { class: 'g', text: gap })));
  });
  $('board').replaceChildren(...items);

  $('stats').textContent = `${fps} fps · ${ping} ms`;
}

// zoom: wheel + pinch
$('canvas').addEventListener('wheel', (e) => { e.preventDefault(); renderer.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
const pointers = new Map();
let pinchDist = 0;
$('canvas').addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a[0] - b[0], a[1] - b[1]); }
});
$('canvas').addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinchDist > 0) renderer.zoomBy(d / pinchDist);
    pinchDist = d;
  }
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  $('canvas').addEventListener(ev, (e) => { pointers.delete(e.pointerId); pinchDist = 0; });
}
window.addEventListener('resize', () => renderer.resize());

requestAnimationFrame(frame);

// read-only hook for the browser smoke test
window.__tinyRacers = {
  state: () => game && { you: game.you, started: serverTick() >= game.goTick, cars: game.cars.map((c) => ({ name: c.name, x: c.x, y: c.y, removed: c.removed })) },
};
