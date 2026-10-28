// Shell Shock Arena client: screens, networking, lobby, draft, shot playback, HUD, results.

import {
  WORLD_W, WORLD_H, STEP_RATE, TANK_COLORS, TANK_STYLES, NAME_MAX, MOVE_SPEED, EMOJIS, TURRET_PIVOT,
  FROZEN_POWER_CAP, DRAFT_PICK_SECONDS, WEAPON_COUNTS, TURN_TIMES,
} from '/shared/tanks/constants.js';
import { MAPS, getMap } from '/shared/tanks/maps.js';
import { getWeapon, weaponStats, weaponPower } from '/shared/tanks/weapons.js';
import { terrainFromInts, applyDiff, surfaceY, slopeAt } from '/shared/tanks/terrain.js';
import { previewPath, muzzle, DEG } from '/shared/tanks/physics.js';
import { simulateShot, hashState, FRAME_EVERY, FRAME_STRIDE } from '/shared/tanks/simulate.js';
import { Renderer, drawTank, weaponThumb, powerBars } from './render.js';
import { FX } from './fx.js';
import { createInput } from './input.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---------- identity & prefs ----------
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
function makeToken() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => (b % 36).toString(36)).join(''); }
const token = store.get('ssa-token', '') || makeToken();
store.set('ssa-token', token);
const prefs = {
  name: store.get('ssa-name', ''),
  color: store.get('ssa-color', TANK_COLORS[Math.floor(Math.random() * TANK_COLORS.length)]),
  style: store.get('ssa-style', 'classic'),
  shake: Number(store.get('ssa-shake', '1')),
  aimMode: store.get('ssa-aim', 'manual') === 'sling' ? 'sling' : 'manual', // 'manual' (Pocket Tanks style) | 'sling'
};
if (!TANK_STYLES.includes(prefs.style)) prefs.style = 'classic';
if (!TANK_COLORS.includes(prefs.color)) prefs.color = TANK_COLORS[0];

// ---------- state ----------
const G = {
  sock: null, me: [], room: null, code: null,
  match: null,       // { players, settings, inv, pool, order, pick, stats }
  st: null,          // authoritative synced game state
  dt: null,          // display terrain (animated during shots)
  vt: [],            // display tanks
  turn: null, turnLocalDeadline: 0, lastTick: 0,
  aim: { angle: 60, power: 60, slot: null },
  plays: [], queue: [], moves: [], history: [],   // shots/moves animating (several at once in Free Fire)
  free: null, freeEnds: 0, reloadUntil: 0, listSel: 0, sling: null,
  tracers: new Map(), bubbles: new Map(),
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 1 },
  draftSel: null, draftDeadline: 0,
  results: null, quakeUntil: 0, time: 0,
};

// ---------- connection ----------
const SERVER = String(window.TINY_RACERS_SERVER || '').replace(/\/+$/, '');
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(`failed to load ${src}`)); };
    document.head.appendChild(s);
  });
}

async function connect() {
  for (let i = 0; !window.io; i++) {
    try { await loadScript(`${SERVER}/socket.io/socket.io.js`); } catch {
      $('home-error').textContent = 'Connecting to the game server…';
      await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * (i + 1))));
    }
  }
  if ($('home-error').textContent.startsWith('Connecting')) $('home-error').textContent = '';
  const sock = window.io(`${SERVER}/tanks`, { transports: ['websocket', 'polling'] });
  G.sock = sock;
  wireSocket(sock);
  return sock;
}
const ready = connect();
async function emit(event, data) {
  const sock = await ready;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ error: 'Server did not answer' }), 8000);
    sock.emit(event, data || {}, (res) => { clearTimeout(t); resolve(res || {}); });
  });
}
function send(event, data) { G.sock?.emit(event, data || {}); }

// ---------- screens ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
  document.body.classList.toggle('in-game', id === 'game');
  if (id === 'game') { renderer.resize(); }
  G.screen = id;
}

// ---------- home ----------
const params = new URLSearchParams(location.search);
const inviteCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (!$('name').value) $('name').value = prefs.name;
else prefs.name = $('name').value;
$('name').addEventListener('input', () => { prefs.name = $('name').value.slice(0, NAME_MAX); store.set('ssa-name', prefs.name); });
if (inviteCode) {
  $('invite-note').hidden = false;
  $('invite-code').textContent = inviteCode;
  $('btn-join-invite').hidden = false;
  $('join-code').value = inviteCode;
}
function buildLookPickers(stylesBox, colorsBox, onChange, taken = new Set()) {
  stylesBox.replaceChildren(...TANK_STYLES.map((s) => {
    const b = el('button', s === prefs.style ? 'sel' : '', s);
    b.type = 'button';
    b.onclick = () => { prefs.style = s; store.set('ssa-style', s); onChange(); };
    return b;
  }));
  colorsBox.replaceChildren(...TANK_COLORS.map((c) => {
    const b = el('button', (c === prefs.color ? 'sel ' : '') + (taken.has(c) ? 'taken' : ''));
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `colour ${c}`);
    b.onclick = () => { prefs.color = c; store.set('ssa-color', c); onChange(); };
    return b;
  }));
}
function refreshHomeLook() {
  buildLookPickers($('styles'), $('colors'), refreshHomeLook);
}
refreshHomeLook();
// rotating tank preview
(function previewLoop() {
  const c = $('tank-preview');
  if (G.screen === 'home' || !G.screen) {
    const ctx = c.getContext('2d');
    const t = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const g = ctx.createRadialGradient(130, 120, 10, 130, 120, 120);
    g.addColorStop(0, 'rgba(255,183,3,.25)'); g.addColorStop(1, 'rgba(255,183,3,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#2a3142'; ctx.fillRect(30, 112, 200, 4);
    ctx.setTransform(2.6, 0, 0, 2.6, 130 - 130 * 2.6 + 0, 112 - 112 * 2.6);
    drawTank(ctx, { x: 130, y: 112, tilt: 0, angle: 90 + Math.sin(t * 1.2) * 50, color: prefs.color, style: prefs.style, alive: true, wheel: t * 3 }, t);
  }
  requestAnimationFrame(previewLoop);
})();

function homeError(msg) { $('home-error').textContent = msg || ''; }
function myLook() { return { name: $('name').value.trim() || `Gunner${100 + Math.floor(Math.random() * 900)}`, color: prefs.color, style: prefs.style, token }; }

async function afterJoin(res) {
  if (res.error) { homeError(res.error); return false; }
  homeError('');
  G.code = res.code;
  history.replaceState(null, '', `?room=${res.code}`);
  return true;
}
$('btn-create').onclick = async () => { audio.unlock(); afterJoin(await emit('create', myLook())); };
$('btn-quick').onclick = async () => { audio.unlock(); afterJoin(await emit('quick', myLook())); };
$('btn-bot').onclick = async () => {
  audio.unlock();
  if (await afterJoin(await emit('create', { ...myLook(), vsBot: 'medium' }))) send('ready', { ready: true });
};
$('btn-local').onclick = async () => { audio.unlock(); afterJoin(await emit('local', { ...myLook(), name2: 'Player 2' })); };
async function joinCode(code) {
  audio.unlock();
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) return homeError('Room codes have 5 characters');
  afterJoin(await emit('join', { ...myLook(), code }));
}
$('btn-join').onclick = () => joinCode($('join-code').value);
$('btn-join-invite').onclick = () => joinCode(inviteCode);
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinCode($('join-code').value); });

function leaveRoom() {
  send('leave');
  G.room = null; G.match = null; G.st = null; G.plays = []; G.moves = []; G.queue = []; G.code = null; G.free = null;
  G.tracers.clear();
  fx.clear();
  audio.stopAmbience();
  history.replaceState(null, '', location.pathname);
  show('home');
}
$('btn-leave').onclick = leaveRoom;

// ---------- lobby ----------
const isHost = () => !!G.room && G.me.includes(G.room.hostId);
const seatOf = (id) => G.room?.seats.find((s) => s.id === id);
const inviteLink = () => `${location.origin}${location.pathname}?room=${G.room.code}`;

function renderLobby() {
  const r = G.room;
  $('room-code').textContent = r.code;
  $('room-privacy').textContent = r.local ? 'Local (same device)' : r.settings.public ? 'Public' : 'Private';
  for (const id of ['btn-copy', 'btn-share', 'btn-qr']) $(id).hidden = r.local;
  $('player-count').textContent = `${r.seats.length}/4`;
  const host = isHost();
  const ul = $('slots');
  const items = [];
  for (let i = 0; i < 4; i++) {
    const s = r.seats[i];
    if (!s) { items.push(el('li', 'empty', 'Empty slot')); continue; }
    const li = el('li');
    const cv = el('canvas'); cv.width = 120; cv.height = 60;
    const ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, -60 * 2 + 60, -50 * 2 + 50);
    drawTank(ctx, { x: 60, y: 50, tilt: 0, angle: 45, color: s.color, style: s.style, alive: true });
    li.append(cv);
    const nm = el('span', 'nm');
    if (s.id === r.hostId) nm.append(el('span', 'crown', '♛ '));
    nm.append(document.createTextNode(s.name));
    if (G.me.includes(s.id)) nm.append(el('span', 'hint', ' (you)'));
    li.append(nm);
    if (r.settings.teams) {
      const tg = el('span', `tag team${s.team}`, s.team ? 'Blue' : 'Red');
      if (host) { tg.title = 'Switch team'; tg.onclick = () => send('team', { id: s.id, team: s.team ? 0 : 1 }); }
      li.append(tg);
    }
    if (s.isBot) li.append(el('span', 'tag', `BOT · ${s.bot}`));
    else li.append(el('span', `tag ${s.ready ? 'ready' : ''}`, s.ready ? 'READY' : 'not ready'));
    if (host && s.id !== r.hostId && !s.localOf) {
      const k = el('button', 'small ghost', '✕');
      k.title = 'Kick';
      k.onclick = () => send('kick', { id: s.id });
      li.append(k);
    }
    items.push(li);
  }
  ul.replaceChildren(...items);
  // own look
  let look = $('lobby-look');
  if (!look) {
    look = el('div'); look.id = 'lobby-look';
    look.append(el('div', 'label', 'Your tank'), el('div', 'chips'), el('div', 'swatches'));
    ul.after(look);
  }
  const taken = new Set(r.seats.filter((s) => !G.me.includes(s.id)).map((s) => s.color));
  buildLookPickers(look.children[1], look.children[2], () => { send('look', { color: prefs.color, style: prefs.style }); }, taken);
  $('bot-add').hidden = !host || r.seats.length >= 4;
  const mine = r.seats.find((s) => G.me.includes(s.id));
  $('btn-ready').hidden = r.local;
  $('btn-ready').textContent = mine?.ready ? 'Not ready' : 'Ready';
  $('btn-ready').classList.toggle('on', !!mine?.ready);
  $('btn-start').hidden = !host;
  $('btn-start').disabled = !!r.canStart;
  $('lobby-error').textContent = host && r.canStart ? r.canStart : !host ? 'Waiting for the host to start…' : '';
  $('spectators').textContent = r.spectators.length ? `Watching: ${r.spectators.map((s) => s.name).join(', ')}` : '';
  renderSettings();
}

const SETTINGS = [
  ['Mode', 'mode', [['classic', 'Classic Score'], ['survival', 'Survival']]],
  ['Map', 'map', [['random', 'Random'], ...MAPS.map((m) => [m.id, m.name])], 'select'],
  ['Pace', 'pace', [['turns', 'Take turns'], ['free', 'Free fire']]],
  ['Arsenal', 'arsenal', [['draft', 'Draft'], ['unlimited', 'Unlimited']]],
  ['Rounds', 'weapons', WEAPON_COUNTS.map((n) => [n, String(n)])],
  ['Turn timer', 'turnTime', TURN_TIMES.map((n) => [n, n ? `${n}s` : 'Off'])],
  ['Friendly fire', 'friendlyFire', [[true, 'On'], [false, 'Off']]],
  ['Walls', 'walls', [['none', 'None'], ['wrap', 'Wrap'], ['bounce', 'Bounce']]],
  ['Teams', 'teams', [[false, 'Free for all'], [true, '2 teams']]],
  ['Room', 'public', [[false, 'Private'], [true, 'Public']]],
];
function renderSettings() {
  const s = G.room.settings, host = isHost();
  const box = $('settings');
  const nodes = [];
  for (const [label, key, opts, kind] of SETTINGS) {
    if ((key === 'public' || key === 'pace') && G.room.local) continue;
    if (key === 'turnTime' && s.pace === 'free') continue;
    nodes.push(el('span', 'hint', label));
    if (kind === 'select') {
      const sel = el('select');
      for (const [v, t] of opts) { const o = el('option', null, t); o.value = v; sel.append(o); }
      sel.value = s[key];
      sel.disabled = !host;
      sel.onchange = () => send('settings', { [key]: sel.value });
      nodes.push(sel);
    } else {
      const seg = el('div', 'seg');
      for (const [v, t] of opts) {
        const b = el('button', s[key] === v ? 'sel' : '', t);
        b.type = 'button';
        b.disabled = !host;
        b.onclick = () => send('settings', { [key]: v });
        seg.append(b);
      }
      nodes.push(seg);
    }
  }
  box.replaceChildren(...nodes);
  const map = s.map === 'random' ? null : getMap(s.map);
  $('settings-note').textContent = map ? `· ${map.rule}` : host ? '' : '(host only)';
}

$('btn-ready').onclick = () => {
  audio.unlock();
  const mine = G.room?.seats.find((s) => G.me.includes(s.id));
  send('ready', { ready: !mine?.ready });
};
$('btn-start').onclick = async () => {
  audio.unlock();
  const res = await emit('start');
  if (res.error) $('lobby-error').textContent = res.error;
};
for (const b of document.querySelectorAll('[data-bot]')) b.onclick = () => send('addBot', { level: b.dataset.bot });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = el('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}
function flashNote(msg) {
  $('copy-ok').textContent = msg;
  clearTimeout(flashNote.t);
  flashNote.t = setTimeout(() => { $('copy-ok').textContent = ''; }, 2500);
}
$('btn-copy').onclick = async () => flashNote((await copyText(inviteLink())) ? 'Link copied!' : inviteLink());
$('btn-share').onclick = async () => {
  const data = { title: 'Shell Shock Arena', text: `Join my tank battle! Room ${G.room.code}`, url: inviteLink() };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  flashNote((await copyText(inviteLink())) ? 'Link copied!' : inviteLink());
};
$('btn-qr').onclick = async () => {
  const box = $('qr-box');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  const c = $('qr'), ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#333'; ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Loading…', 90, 90);
  try {
    if (!window.qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
    const qr = window.qrcode(0, 'M');
    qr.addData(inviteLink());
    qr.make();
    const n = qr.getModuleCount(), cell = Math.floor((c.width - 16) / n), off = Math.floor((c.width - cell * n) / 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) ctx.fillRect(off + x * cell, off + y * cell, cell, cell);
  } catch {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#333'; ctx.fillText('QR unavailable offline', 90, 90);
  }
};

// ---------- chat ----------
for (const bar of document.querySelectorAll('[data-emoji-bar]')) {
  for (const e of EMOJIS) {
    const b = el('button', null, e);
    b.type = 'button';
    b.onclick = () => sendEmoji(e);
    bar.append(b);
  }
}
function sendEmoji(e) {
  // in a local game the emoji comes from whoever is playing now
  const as = G.turn && G.match && !isFree() ? G.match.players[G.turn.player]?.id : null;
  send('emoji', { e, as: as && G.me.includes(as) ? as : undefined });
}
function wireChat(form, input) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send('chat', { text });
    input.value = '';
  });
}
wireChat($('chat-form'), $('chat-input'));
wireChat($('chat-form-game'), $('chat-input-game'));
function addChat(msg) {
  for (const log of [$('chat-log'), $('chat-log-game')]) {
    const li = el('li');
    const b = el('b', null, msg.name);
    b.style.color = msg.color;
    li.append(b, document.createTextNode(msg.text));
    log.append(li);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }
}
$('btn-chat').onclick = () => { $('chat-pop').hidden = !$('chat-pop').hidden; if (!$('chat-pop').hidden) $('chat-input-game').focus(); };

// ---------- draft ----------
function renderDraft() {
  const m = G.match;
  if (!m) return;
  const picker = m.order[m.pick];
  const pickerP = m.players[picker];
  const mine = pickerP && G.me.includes(pickerP.id);
  $('draft-status').replaceChildren();
  if (pickerP) {
    const b = el('b', null, mine ? (G.me.length > 1 ? `${pickerP.name}, your pick!` : 'Your pick!') : `${pickerP.name} is picking…`);
    $('draft-status').append(b, el('span', 'hint', `  pick ${Math.min(m.pick + 1, m.order.length)} of ${m.order.length} · snake order`));
  }
  const pool = $('pool');
  const cards = m.pool.map((item) => {
    const w = getWeapon(item.weapon);
    const c = el('button', `wcard ${w.rarity}${item.by >= 0 ? ' taken' : ''}${G.draftSel === item.slot ? ' sel' : ''}`);
    c.type = 'button';
    c.dataset.slot = item.slot;
    if (item.by >= 0) c.dataset.by = m.players[item.by]?.name || '';
    c.append(weaponThumb(w.id, 40), el('span', 'wn', w.name), powerBars(w.id));
    c.title = `${w.name}: ${w.desc} (${weaponStats(w)})`;
    c.onclick = () => {
      if (item.by >= 0) return;
      if (G.draftSel === item.slot && mine) return doPick();
      G.draftSel = item.slot;
      renderDraft();
    };
    return c;
  });
  pool.replaceChildren(...cards);
  const sel = m.pool[G.draftSel];
  const info = $('weapon-info');
  if (sel && sel.by < 0) {
    const w = getWeapon(sel.weapon);
    const h = el('h3');
    h.append(weaponThumb(w.id, 56), document.createTextNode(w.name));
    const rar = el('div', 'rar', `${w.rarity} · power `);
    rar.append(powerBars(w.id));
    info.replaceChildren(h, rar, el('p', null, w.desc), el('p', 'hint', weaponStats(w)), el('p', 'hint', mine ? 'Press Enter (or tap again) to pick' : ''));
  } else {
    G.draftSel = null;
    info.replaceChildren(el('p', 'hint', 'Tap a weapon to see what it does, tap again to pick it. Keyboard: arrows to choose, Enter to pick.'));
  }
  $('btn-pick').disabled = !(mine && G.draftSel != null);
  const side = m.players.map((p, i) => {
    const d = el('div', `dp${i === picker ? ' now' : ''}`);
    const n = el('div', 'dn');
    const dot = el('i'); dot.style.background = p.color;
    n.append(dot, document.createTextNode(`${p.name} (${m.inv[i].length}/${m.settings.weapons})`));
    const wl = el('div', 'dw');
    for (const it of m.inv[i]) { const t = weaponThumb(it.weapon, 24); t.title = getWeapon(it.weapon).name; wl.append(t); }
    d.append(n, wl);
    return d;
  });
  $('draft-players').replaceChildren(...side);
}
// Keyboard draft: arrows move the highlight, Enter picks it.
function draftNav(action) {
  const m = G.match;
  if (!m) return false;
  const free = m.pool.filter((it) => it.by < 0).map((it) => it.slot);
  if (!free.length) return false;
  if (action === 'fire') {
    if (G.draftSel == null) { G.draftSel = free[0]; renderDraft(); } else doPick();
    return true;
  }
  const cards = [...document.querySelectorAll('#pool .wcard')];
  const cols = Math.max(1, cards.filter((c) => c.offsetTop === cards[0]?.offsetTop).length);
  const d = { angleUp: -1, angleDown: 1, powerUp: -cols, powerDown: cols, prevWeapon: -1, nextWeapon: 1 }[action];
  if (d == null) return false;
  let i = G.draftSel == null ? -d : G.draftSel;
  for (let n = 0; n < m.pool.length; n++) {
    i = (i + d + m.pool.length) % m.pool.length;
    if (m.pool[i].by < 0) break;
  }
  G.draftSel = i;
  renderDraft();
  document.querySelector(`.wcard[data-slot="${i}"]`)?.scrollIntoView({ block: 'nearest' });
  return true;
}

async function doPick() {
  if (G.draftSel == null) return;
  const res = await emit('pick', { slot: G.draftSel });
  if (res.error) showToast(res.error);
  else audio.click();
}
$('btn-pick').onclick = doPick;

// ---------- game state sync ----------
function loadSnapshot(snap) {
  G.match = { players: snap.players, settings: snap.settings, inv: snap.inv, pool: snap.pool, order: snap.order, pick: snap.pick, stats: snap.stats, shotsLeft: snap.shotsLeft || [] };
  G.draftDeadline = performance.now() + DRAFT_PICK_SECONDS * 1000;
  G.plays = [];
  G.queue = [];
  G.moves = [];
  G.free = null;
  if (snap.free) startFreeUi({ duration: snap.free.endsIn, reload: snap.free.reload, shotsLeft: snap.shotsLeft, quiet: true, reloadIn: snap.free.reloadIn });
  if (snap.state) {
    const s = snap.state;
    G.st = { ...s, terrain: terrainFromInts(s.terrain), tanks: s.tanks.map((t) => ({ ...t })), mines: s.mines.map((m) => ({ ...m })) };
    if (hashState(G.st) !== s.hash) console.warn('state hash differs from server (using server values)');
    G.dt = new Float32Array(G.st.terrain);
    renderer.setMap(G.st.map, hashCode(G.code || 'x'));
    renderer.setTerrain(G.dt);
    audio.setAmbience(G.st.map);
    resetDisplayTanks();
    G.turn = snap.turn;
    if (G.turn) startTurnUi(G.turn, false);
  } else {
    G.st = null;
  }
  if (snap.free && G.st) initFreeAim();
  if (snap.phase === 'draft') { show('draft'); renderDraft(); }
  else if (snap.phase === 'play') { show('game'); renderHud(); }
  else if (snap.phase === 'over' && snap.results) { showResults({ ...snap.results, session: G.room?.session || [] }); }
}

function hashCode(s) { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

function resetDisplayTanks() {
  G.vt = G.st.tanks.map((t, i) => ({
    x: t.x, y: t.y, tilt: t.tilt, angle: t.angle, tAngle: t.angle, power: t.power, recoil: 0, wheel: 0, smokeT: i * 0.05,
  }));
}

function syncDisplayFromState() {
  G.st.tanks.forEach((t, i) => {
    const v = G.vt[i];
    if (!v) return;
    v.x = t.x; v.y = t.y; v.tilt = t.tilt;
  });
  // redraw terrain where the display differs from the authoritative terrain
  let a = -1, b = -1;
  for (let x = 0; x < WORLD_W; x++) {
    if (G.dt[x] !== G.st.terrain[x]) { if (a < 0) a = x; b = x; G.dt[x] = G.st.terrain[x]; }
  }
  if (a >= 0) renderer.redrawTerrain(a, b);
}

// Run handlers in order; anything arriving while a shot/move animates waits its turn.
const busy = () => G.plays.length > 0 || G.moves.length > 0;
function enqueue(fn) {
  if (busy() || G.queue.length) G.queue.push(fn);
  else fn();
}
function drain() {
  while (!busy() && G.queue.length) G.queue.shift()();
}

// ---------- turns & HUD ----------
const myTurn = () => !!G.turn && !G.turn.fired && !!G.match && G.me.includes(G.match.players[G.turn.player]?.id);
const isFree = () => G.match?.settings.pace === 'free';
const mySeat = () => (G.match ? G.match.players.findIndex((pl) => G.me.includes(pl.id)) : -1);
// Seat the local player controls right now (-1 = none): the active turn, or your own tank in Free Fire.
function actor() {
  if (!G.match || !G.st || G.room?.phase !== 'match') return -1;
  if (isFree()) {
    const p = mySeat();
    return p >= 0 && G.free && G.st.tanks[p]?.alive && (G.match.shotsLeft[p] ?? 0) > 0 ? p : -1;
  }
  return myTurn() && !busy() ? G.turn.player : -1;
}
const frozenNow = (p) => (isFree() ? G.st.tanks[p]?.frozen > 0 : !!G.turn?.frozen);
// Seat the local player may drive: the actor, or (Free Fire) your living tank after its shots are used up.
function mover() {
  const a = actor();
  if (a >= 0 || !isFree() || !G.free || G.room?.phase !== 'match') return a;
  const p = mySeat();
  return p >= 0 && G.st?.tanks[p]?.alive ? p : -1;
}

function startFreeUi(msg) {
  G.free = { reload: msg.reload };
  G.freeEnds = performance.now() + msg.duration;
  if (msg.shotsLeft) G.match.shotsLeft = [...msg.shotsLeft];
  const p = mySeat();
  G.reloadUntil = p >= 0 && msg.reloadIn ? performance.now() + (msg.reloadIn[p] || 0) : 0;
  if (!msg.quiet) { banner('FREE FIRE!', '#ffb703'); audio.chime(); showToast('No turns: aim and fire whenever you are reloaded'); }
}

function initFreeAim() {
  const p = mySeat();
  if (p < 0) return;
  const tank = G.st.tanks[p];
  G.aim.angle = tank.angle;
  G.aim.power = tank.power;
  const inv = G.match.inv[p];
  if (!inv.some((w) => w.slot === G.aim.slot && !w.used)) G.aim.slot = inv.find((w) => !w.used)?.slot ?? null;
  syncAimUi();
}

function startTurnUi(t, announce = true) {
  G.turn = t;
  G.sling = null;
  if (t.tanks) G.st.tanks = t.tanks.map((x) => ({ ...x }));
  if (t.mines) G.st.mines = t.mines.map((x) => ({ ...x }));
  syncDisplayFromState();
  G.turnLocalDeadline = G.match.settings.turnTime ? performance.now() + G.match.settings.turnTime * 1000 : 0;
  const p = G.match.players[t.player];
  const tank = G.st.tanks[t.player];
  if (myTurn()) {
    G.aim.angle = tank.angle;
    G.aim.power = Math.min(tank.power, tank.frozen ? FROZEN_POWER_CAP : 100);
    const inv = G.match.inv[t.player];
    if (!inv.some((w) => w.slot === G.aim.slot && !w.used)) G.aim.slot = inv.find((w) => !w.used)?.slot ?? null;
    syncAimUi();
  }
  G.vt[t.player].tAngle = tank.angle;
  if (announce) {
    const mine = myTurn();
    banner(mine ? (G.me.length > 1 ? `${p.name}'s turn` : 'Your turn!') : `${p.name}'s turn`, mine ? '#ffb703' : p.color);
    if (mine) audio.chime();
    if (t.frozen && mine) showToast('❄ Frozen: no moving, power capped at 80%');
  }
  renderHud();
}

function renderHud() {
  if (!G.match || !G.st) return;
  const survival = G.st.mode === 'survival';
  const chips = G.match.players.map((p, i) => {
    const t = G.st.tanks[i];
    const seat = seatOf(p.id);
    const c = el('div', `pchip${G.turn?.player === i ? ' active' : ''}${t.alive ? '' : ' dead'}`);
    const av = el('span', 'av'); av.style.background = p.color;
    c.append(av, el('span', 'nm', p.name));
    if (seat?.isBot) c.append(el('span', 'wl', 'BOT'));
    if (seat && !seat.connected) c.append(el('span', 'st', '⚠'));
    if (survival) {
      const hp = el('span', 'hp'); const bar = el('i'); bar.style.width = `${Math.max(0, t.hp)}%`;
      bar.style.background = t.hp > 50 ? '#2ecc71' : t.hp > 25 ? '#f1c40f' : '#e74c3c';
      hp.append(bar);
      c.append(hp);
    }
    c.append(el('span', 'sc', String(survival ? t.hp : t.score)));
    if (t.shield > 0) c.append(el('span', 'st', '🛡'));
    if (t.frozen) c.append(el('span', 'st', '❄'));
    c.append(el('span', 'wl', `${G.match.shotsLeft[i] ?? 0}🎯`));
    return c;
  });
  $('chips').replaceChildren(...chips);
  const seat = mySeat();
  $('round').textContent = isFree()
    ? (seat >= 0 ? `Shots ${G.match.shotsLeft[seat] ?? 0}/${G.match.settings.weapons}` : 'Free fire')
    : G.turn ? `Round ${G.turn.round}/${G.match.settings.weapons}` : '';
  const me = actor();
  const mine = me >= 0;
  const moveOnly = !mine && mover() >= 0; // out of shots in Free Fire: only the move buttons
  $('hud-bottom').classList.toggle('off', !mine && !moveOnly);
  $('hud-bottom').classList.toggle('move-only', moveOnly);
  if (moveOnly) {
    const canMove = !frozenNow(mover()) && !(G.st.tanks[mover()].buried > 0);
    $('move-left').disabled = !canMove;
    $('move-right').disabled = !canMove;
  }
  $('aim-hint').hidden = !mine || prefs.aimMode !== 'sling' || G.slingUsed;
  if (!mine) $('weapon-list').hidden = true;
  if (mine) {
    const tank = G.st.tanks[me];
    const canMove = !frozenNow(me) && !(tank.buried > 0);
    $('move-left').disabled = !canMove;
    $('move-right').disabled = !canMove;
    $('power').max = frozenNow(me) ? FROZEN_POWER_CAP : 100;
    syncAimUi();
  }
}

function syncAimUi() {
  $('angle').value = G.aim.angle;
  $('power').value = G.aim.power;
  $('angle-val').textContent = G.aim.angle.toFixed(1).replace(/\.0$/, '');
  $('power-val').textContent = G.aim.power.toFixed(1).replace(/\.0$/, '');
  const me = actor();
  const item = me >= 0 ? G.match.inv[me].find((w) => w.slot === G.aim.slot && !w.used) : null;
  const w = item ? getWeapon(item.weapon) : null;
  if ($('w-icon').dataset.id !== (w?.id || '')) {
    $('w-icon').dataset.id = w?.id || '';
    $('w-icon').replaceChildren(...(w ? [weaponThumb(w.id, 36)] : []));
    $('w-name').replaceChildren(...(w ? [document.createTextNode(w.name), powerBars(w.id)] : [document.createTextNode('—')]));
  }
  $('w-desc').textContent = w ? `${w.desc} ${weaponStats(w)}${item.infinite ? '' : item && G.match.settings.arsenal === 'unlimited' ? ' · single use' : ''}` : '';
  $('btn-fire').disabled = !item;
}

function setAim(angle, power) {
  const me = actor();
  if (me < 0) return;
  const cap = frozenNow(me) ? FROZEN_POWER_CAP : 100;
  G.aim.angle = Math.round(Math.max(0, Math.min(180, angle)) * 10) / 10;
  G.aim.power = Math.round(Math.max(0, Math.min(cap, power)) * 10) / 10;
  G.vt[me].tAngle = G.aim.angle;
  G.vt[me].angle = G.aim.angle;
  syncAimUi();
  const now = performance.now();
  if (now - (setAim.last || 0) > 100) { setAim.last = now; send('aim', { angle: G.aim.angle, power: G.aim.power, slot: G.aim.slot }); }
}

function cycleWeapon(d) {
  const me = actor();
  if (me < 0) return;
  const inv = G.match.inv[me].filter((w) => !w.used);
  if (!inv.length) return;
  const i = inv.findIndex((w) => w.slot === G.aim.slot);
  G.aim.slot = inv[(i + d + inv.length) % inv.length].slot;
  audio.click();
  syncAimUi();
}

function openWeaponList() {
  const box = $('weapon-list');
  if (!box.hidden) { box.hidden = true; return; }
  const me = actor();
  if (me < 0) return;
  const inv = G.match.inv[me].filter((w) => !w.used);
  G.listSel = Math.max(0, inv.findIndex((it) => it.slot === G.aim.slot));
  box.replaceChildren(...inv.map((it, k) => {
    const w = getWeapon(it.weapon);
    const b = el('button', k === G.listSel ? 'sel' : '');
    b.type = 'button';
    b.dataset.slot = it.slot;
    b.title = `${w.desc} (${weaponStats(w)})`;
    const name = el('span', 'wn', w.name);
    b.append(weaponThumb(w.id, 30), name, powerBars(w.id));
    if (G.match.settings.arsenal === 'unlimited') b.append(el('small', 'uses', it.infinite ? '∞' : '1×'));
    b.onclick = () => chooseFromList(it.slot);
    return b;
  }));
  box.hidden = false;
  box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

function chooseFromList(slot) {
  G.aim.slot = slot;
  $('weapon-list').hidden = true;
  syncAimUi();
  audio.click();
}

// Keyboard in the open weapon list: arrows move, Enter equips.
function listNav(action) {
  const btns = [...$('weapon-list').querySelectorAll('button')];
  if (!btns.length) return false;
  if (action === 'fire') { chooseFromList(Number(btns[G.listSel]?.dataset.slot)); return true; }
  const cols = Math.max(1, btns.filter((b) => b.offsetTop === btns[0].offsetTop).length);
  const d = { angleUp: -1, angleDown: 1, powerUp: -cols, powerDown: cols, prevWeapon: -1, nextWeapon: 1 }[action];
  if (d == null) return false;
  btns[G.listSel]?.classList.remove('sel');
  G.listSel = (G.listSel + d + btns.length) % btns.length;
  btns[G.listSel].classList.add('sel');
  btns[G.listSel].scrollIntoView({ block: 'nearest' });
  return true;
}

async function fire() {
  const me = actor();
  if (me < 0 || G.aim.slot == null) return;
  audio.unlock();
  if (isFree()) {
    if (performance.now() < G.reloadUntil) { showToast('Reloading…'); return; }
    G.reloadUntil = performance.now() + (G.free?.reload || 3000);
    const res = await emit('fire', { slot: G.aim.slot, angle: G.aim.angle, power: G.aim.power });
    if (res.error) { G.reloadUntil = 0; showToast(res.error); }
    return;
  }
  G.turn.fired = true;
  renderHud();
  const res = await emit('fire', { slot: G.aim.slot, angle: G.aim.angle, power: G.aim.power });
  if (res.error) { G.turn.fired = false; renderHud(); showToast(res.error); }
}

// Moving is free and unlimited: one 60 px step per press, hold to keep driving.
async function move(dir) {
  const me = mover();
  if (me < 0 || G.movePending || G.moves.some((m) => m.p === me)) return;
  G.movePending = true;
  setTimeout(() => { G.movePending = false; }, 250);
  const res = await emit('move', { dir });
  if (res.error) showToast(res.error);
}

$('btn-fire').onclick = fire;
function setAimMode(mode) {
  prefs.aimMode = mode;
  store.set('ssa-aim', mode);
  G.sling = null;
  const b = $('aim-mode');
  b.classList.toggle('sling', mode === 'sling');
  b.replaceChildren(el('b', null, mode === 'sling' ? '🏹' : '✋'), document.createTextNode(mode === 'sling' ? 'Sling' : 'Manual'));
  $('aim-hint').hidden = mode !== 'sling' || actor() < 0;
}
$('aim-mode').onclick = () => { setAimMode(prefs.aimMode === 'sling' ? 'manual' : 'sling'); showToast(prefs.aimMode === 'sling' ? '🏹 Slingshot: pull back and release to fire' : '✋ Manual: sliders or drag to aim, then FIRE'); };
setAimMode(prefs.aimMode);
$('w-prev').onclick = () => cycleWeapon(-1);
$('w-next').onclick = () => cycleWeapon(1);
$('w-open').onclick = openWeaponList;
for (const [id, dir] of [['move-left', -1], ['move-right', 1]]) {
  let hold = null;
  const b = $(id);
  b.addEventListener('pointerdown', () => { move(dir); clearInterval(hold); hold = setInterval(() => move(dir), 120); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearInterval(hold));
}
$('angle').addEventListener('input', () => setAim(Number($('angle').value), G.aim.power));
$('power').addEventListener('input', () => setAim(G.aim.angle, Number($('power').value)));
for (const b of document.querySelectorAll('[data-step]')) {
  const [k, d] = b.dataset.step.split(':');
  let rep = null;
  const step = (e) => {
    const fine = e?.shiftKey ? 0.1 : 1;
    if (k === 'angle') setAim(G.aim.angle + Number(d) * fine, G.aim.power);
    else setAim(G.aim.angle, G.aim.power + Number(d) * fine);
  };
  b.addEventListener('pointerdown', (e) => { step(e); clearInterval(rep); rep = setInterval(step, 90); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearInterval(rep));
}

// ---------- menu ----------
$('btn-menu').onclick = () => { $('menu').hidden = false; };
$('btn-resume').onclick = () => { $('menu').hidden = true; };
$('btn-quit').onclick = () => { $('menu').hidden = true; leaveRoom(); };
$('volume').value = audio.volume;
$('volume').addEventListener('input', () => { audio.unlock(); audio.setVolume(Number($('volume').value)); });
$('mute').checked = audio.muted;
$('mute').addEventListener('change', () => audio.setMuted($('mute').checked));
$('shake').value = String(prefs.shake);
$('shake').addEventListener('change', () => { prefs.shake = Number($('shake').value); store.set('ssa-shake', String(prefs.shake)); fx.shakeScale = prefs.shake; });

// ---------- banners / toasts ----------
function banner(text, color = '#fff') {
  const b = $('banner');
  b.textContent = text;
  b.style.color = color;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}
function showToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- shot playback ----------
function startShot(shot) {
  const local = simulateShot(G.st, shot.input, shot.seed, { record: true });
  if (local.hash !== shot.hash) console.warn('local replay differs from server; snapping to server state');
  const srv = shot.events.filter((e) => ['damage', 'heal', 'destroyed', 'tracer'].includes(e.type));
  const firstHit = local.events.find((e) => e.type === 'explode' || e.type === 'damage' || e.type === 'laser');
  const P = {
    shot, local, step: 0, evI: 0, srvI: 0, srv, idle: 0, apex: false, lastY: null, history: [],
    slowAt: shot.final && firstHit ? Math.max(0, firstHit.t - 20) : -1, slowLeft: 1,
    hits: new Map(), shooter: shot.input.shooter, tanks0: local.frames[0]?.tanks,
  };
  G.plays.push(P);
  if (shot.input.weapon) {
    const inv = G.match.inv[shot.input.shooter];
    const item = inv.find((w) => w.weapon === shot.input.weapon && !w.used);
    if (item && !item.infinite) item.used = true;
  }
  if (shot.shotsLeft) G.match.shotsLeft = [...shot.shotsLeft];
  G.tracers.delete(shot.input.shooter);
  // Free Fire: the next shot may arrive mid-animation, so the synced state moves on right away
  if (isFree()) applyShotResult(shot);
  renderHud();
  if (document.hidden) finishShot(P);
  if (isFree()) {
    for (const ms of shot.mineShots || []) startShot(ms);
    if (shot.after) {
      G.st.tanks = shot.after.tanks.map((t) => ({ ...t }));
      if (hashState(G.st) !== shot.after.hash) { console.warn('state hash mismatch after shot: resyncing'); send('sync'); }
    }
  }
}

function applyShotResult(shot) {
  applyDiff(G.st.terrain, shot.terrain);
  G.st.tanks = shot.tanks.map((t) => ({ ...t }));
  G.st.mines = shot.mines.map((m) => ({ ...m }));
  if (hashState(G.st) !== shot.hash) { console.warn('terrain/state hash mismatch: resyncing'); send('sync'); }
}

function updateShots(dt) {
  for (const P of [...G.plays]) updateShot(P, dt);
  // merge the recent frames of every shot in flight for drawing
  const len = Math.max(0, ...G.plays.map((P) => P.history.length));
  G.history = [];
  for (let j = 0; j < len; j++) {
    const merged = [];
    for (const P of G.plays) { const f = P.history[P.history.length - len + j]; if (f) merged.push(...f); }
    G.history.push(merged);
  }
}

function updateShot(P, dt) {
  let speed = 1;
  if (P.slowAt >= 0 && P.step >= P.slowAt && P.slowLeft > 0) { speed = 0.3; P.slowLeft -= dt; }
  P.step += dt * STEP_RATE * speed;
  const step = Math.floor(P.step);
  const L = P.local;
  while (P.evI < L.events.length && L.events[P.evI].t <= step) localEvent(L.events[P.evI++]);
  while (P.srvI < P.srv.length && P.srv[P.srvI].t <= step) serverEvent(P, P.srv[P.srvI++]);
  const frames = L.frames;
  const fi = Math.min(frames.length - 1, Math.floor(P.step / FRAME_EVERY) - 1);
  P.history = [];
  if (fi >= 0 && P.step <= L.steps + FRAME_EVERY) {
    for (let k = Math.max(0, fi - 8); k <= fi; k++) P.history.push(frames[k].p);
    const f = frames[fi];
    // only tanks this shot moves (other shots or moves may be animating them)
    f.tanks.forEach(([x, y, tilt], i) => {
      const v = G.vt[i], t0 = P.tanks0?.[i];
      if (v && (!t0 || Math.abs(t0[0] - x) > 0.5 || Math.abs(t0[1] - y) > 0.5)) { v.x = x; v.y = y; v.tilt = tilt; }
    });
    emitTrails(f.p, dt);
    // whistle once the first shell starts falling
    if (f.p.length && !P.apex) {
      if (P.lastY != null && f.p[2] > P.lastY) { P.apex = true; audio.whistle(1.4); }
      P.lastY = f.p[2];
    }
  }
  if (P.step >= L.steps) {
    P.idle += dt;
    if (P.idle > 0.35) finishShot(P);
  }
}

function emitTrails(p, dt) {
  for (let i = 0; i < p.length; i += FRAME_STRIDE) {
    const st = p[i], x = p[i + 1], y = p[i + 2];
    if (Math.random() > dt * 60) continue;
    if (st === 'meteor' || st === 'nuke' || st === 'lava' || st === 'comet' || st === 'fireball') fx.trail(x, y, '#ff7a2a', 'fire');
    if (['homing', 'nuke', 'drill', 'twinmissile', 'swarm', 'bunker'].includes(st)) fx.trail(x, y, '#ccc', 'smoke');
    if (st === 'tornado' && Math.random() < 0.5) fx.trail(x + (Math.random() - 0.5) * 30, y + 25, '#a4b0be', 'smoke');
    if (st === 'napalm' && Math.random() < 0.3) fx.trail(x, y - 4, '#ff9f1c', 'fire');
    if (st === 'blackhole') {
      const a = Math.random() * Math.PI * 2, r = 80 + Math.random() * 80;
      fx.spawn('spark', x + Math.cos(a) * r, y + Math.sin(a) * r, -Math.cos(a) * r * 1.5, -Math.sin(a) * r * 1.5, 0.6, 1.5, '#a29bfe', { drag: 1 });
    }
    if (st === 'portal' && Math.random() < 0.5) fx.trail(x + (Math.random() - 0.5) * 120, y, '#ff6348', 'fire');
  }
}

const terrainColors = () => { const m = getMap(G.st.map); return [m.ground[0], m.ground[1], m.ground[2], m.edge]; };

function localEvent(e) {
  const vt = G.vt;
  switch (e.type) {
    case 'fire': {
      const v = vt[e.tank];
      if (!v) break;
      v.angle = v.tAngle = e.angle;
      const w = getWeapon(e.weapon);
      if (w.behavior === 'shield') break;
      v.recoil = 1;
      const m = muzzle({ x: v.x, y: v.y }, e.angle);
      if (w.behavior === 'laser') audio.zap(); else { fx.muzzle(m.x, m.y, e.angle * DEG); audio.cannon(); }
      break;
    }
    case 'explode':
      fx.explosion(e.x, e.y, e.r, e.kind, terrainColors());
      audio.explosion(e.r);
      break;
    case 'terrain':
      for (let i = 0; i < e.vals.length; i++) G.dt[e.a + i] = e.vals[i];
      renderer.redrawTerrain(e.a, e.a + e.vals.length - 1);
      break;
    case 'dirt': case 'dig': case 'drill': case 'spike':
      fx.dirtBurst(e.x, e.y, e.r || 30, terrainColors());
      audio.dirt();
      break;
    case 'lightning': fx.bolt(e.x1, e.y1, e.x2, e.y2); audio.crack(); break;
    case 'laser':
      if (e.kind === 'skylance') { fx.beam(e.x1, e.y1, e.x2, e.y2, ['#00d2d3', '#7efff5', '#ffffff']); fx.addShake(8); audio.zap(); }
      else fx.beam(e.x1, e.y1, e.x2, e.y2);
      break;
    case 'skylanceMark': fx.ring(e.x, e.y, 40, '#00d2d3', 0.5); audio.tick(); break;
    case 'repulse': fx.ring(e.x, e.y, e.r, '#a29bfe', 0.7); fx.addShake(6); break;
    case 'tornado': audio.rumble(1.5); break;
    case 'shield': {
      const v = vt[e.tank];
      fx.ring(v.x, v.y - 10, 50, '#4bcffa', 0.8);
      fx.sparkle(v.x, v.y - 10, '#4bcffa');
      if (!isFree()) G.st.tanks[e.tank].shield = 1;
      audio.shield();
      break;
    }
    case 'shieldHit': { const v = vt[e.tank]; fx.sparkle(v.x, v.y - 10, '#4bcffa', 16, 120); fx.number(v.x, v.y - 40, `🛡${e.absorbed}`, '#4bcffa'); break; }
    case 'freeze':
      fx.ring(e.x, e.y, e.r * 1.6, '#c7f9ff', 0.8);
      fx.sparkle(e.x, e.y, '#c7f9ff', 40, 220);
      if (!isFree()) for (const i of e.tanks) G.st.tanks[i].frozen = 1;
      audio.freeze();
      break;
    case 'teleport':
      fx.sparkle(e.from.x, e.from.y - 10, '#be2edd', 40, 200);
      fx.sparkle(e.to.x, e.to.y - 10, '#be2edd', 40, 200);
      fx.ring(e.to.x, e.to.y - 10, 60, '#e056fd');
      audio.teleport();
      break;
    case 'quake': G.quakeUntil = G.time + e.life; audio.rumble(e.life); break;
    case 'nuke': fx.mushroom(e.x, e.y); audio.explosion(200); break;
    case 'blackhole': audio.rumble(e.life); break;
    case 'volcano': fx.dirtBurst(e.x, e.y, 60, ['#ff4500', '#3a2a28', '#ff9f1c']); audio.rumble(0.8); break;
    case 'split': audio.pop(); fx.sparkle(e.x, e.y, '#fff', 12, 120); break;
    case 'crazy': showToast(`🎲 Crazy Shot → ${getWeapon(e.weapon).name}`); break;
    case 'airstrike': showToast('✈ Airstrike incoming!'); break;
    case 'magnet': fx.ring(e.x, e.y, 250, '#e84393', 0.9); break;
    case 'mine': audio.click(); break;
    case 'mineBoom': showToast('💥 Mine!'); break;
    case 'fall': audio.dirt(); break;
    case 'acid': if (Math.random() < 0.3) audio.pop(); break;
    case 'destroyed': {
      fx.explosion(e.x, e.y - 10, 70, 'shell', terrainColors());
      fx.addShake(12);
      audio.explosion(110);
      const p = G.match.players[e.tank];
      if (p) showToast(`💀 ${p.name} destroyed!`);
      if (!isFree()) G.st.tanks[e.tank].alive = false;
      break;
    }
    default: break;
  }
}

// Damage numbers come from the server's timeline (clients never decide damage).
function serverEvent(P, e) {
  const shooter = G.match.players[P.shooter];
  if (e.type === 'damage') {
    const enemy = e.tank !== P.shooter && G.st.tanks[e.tank].team !== G.st.tanks[P.shooter].team;
    const pts = e.points ?? e.amount;
    fx.number(e.x, e.y, `${enemy ? '+' : '-'}${enemy ? pts : e.amount}`, enemy ? shooter.color : '#ff5d5d', pts >= 40);
    if (enemy) {
      P.hits.set(e.tank, (P.hits.get(e.tank) || 0) + pts);
      fx.number(e.x + 26, e.y + 22, `-${e.lost ?? pts}`, '#ff5d5d'); // the victim loses those points
    }
    if (G.st.mode === 'survival' && !isFree()) G.st.tanks[e.tank].hp = Math.max(0, G.st.tanks[e.tank].hp - e.amount);
  } else if (e.type === 'heal') {
    const v = G.vt[e.tank];
    fx.number(v.x, v.y - 50, `+${e.amount}`, '#2ecc71');
  } else if (e.type === 'tracer') {
    P.tracer = e;
  }
}

function finishShot(P) {
  if (!G.plays.includes(P)) return;
  // drain events we didn't get to (tab hidden, etc.)
  while (P.srvI < P.srv.length) { const e = P.srv[P.srvI++]; if (e.type === 'tracer') P.tracer = e; }
  const shot = P.shot;
  G.plays = G.plays.filter((x) => x !== P);
  if (!isFree()) applyShotResult(shot);
  if (!busy()) syncDisplayFromState();
  else {
    // other shots still flying: just show this shot's terrain changes now
    for (const [start, vals] of shot.terrain) {
      for (let i = 0; i < vals.length; i++) G.dt[start + i] = G.st.terrain[start + i];
      renderer.redrawTerrain(start, start + vals.length - 1);
    }
  }
  if (P.tracer) G.tracers.set(P.tracer.tank, { pts: P.tracer.pts, color: '#00ffd0' });
  const total = [...P.hits.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    const n = P.hits.size;
    const label = n >= 3 ? 'TRIPLE HIT!' : n === 2 ? 'DOUBLE HIT!' : shot.events.some((e) => e.type === 'damage' && e.direct) ? 'DIRECT HIT!' : 'HIT!';
    banner(`${label} +${total}`, G.match.players[P.shooter].color);
  }
  renderHud();
  if (shot.mineShots?.length && !isFree()) {
    for (const ms of shot.mineShots.slice().reverse()) G.queue.unshift(() => startShot(ms));
  }
  drain();
}

// ---------- move animation ----------
function startMove(msg) {
  const M = { p: msg.player, path: msg.path, d: 0, msg };
  G.moves.push(M);
  if (isFree()) G.st.tanks[msg.player] = { ...msg.tank };
  audio.move();
  if (document.hidden) finishMove(M);
}
function updateMoves(dt) {
  for (const M of [...G.moves]) updateMove(M, dt);
}
function updateMove(M, dt) {
  M.d += dt * MOVE_SPEED;
  const i = Math.min(M.path.length - 1, Math.floor(M.d));
  const v = G.vt[M.p];
  v.x = M.path[i];
  v.y = surfaceY(G.dt, v.x);
  v.tilt = Math.max(-0.6, Math.min(0.6, slopeAt(G.dt, v.x)));
  v.wheel += dt * 8 * Math.sign(M.path[M.path.length - 1] - M.path[0]);
  if (M.d >= M.path.length - 1) finishMove(M);
}
function finishMove(M) {
  if (!G.moves.includes(M)) return;
  G.moves = G.moves.filter((x) => x !== M);
  if (!isFree()) G.st.tanks[M.p] = { ...M.msg.tank }; // Free Fire applied it at the start (newer shots may have changed it since)
  if (!busy()) syncDisplayFromState();
  else { const v = G.vt[M.p], t = G.st.tanks[M.p]; v.x = t.x; v.y = t.y; v.tilt = t.tilt; }
  renderHud();
  drain();
}

// ---------- results ----------
function showResults(res) {
  G.results = res;
  show('results');
  const survival = res.mode === 'survival';
  $('score-head').textContent = survival ? 'HP / Score' : 'Score';
  let title;
  if (res.tie) title = "It's a tie!";
  else if (res.winTeams) title = `${res.winTeams[0] ? 'Blue' : 'Red'} team wins!`;
  else title = `${res.rows.find((r) => r.index === res.winners[0])?.name || 'Someone'} wins!`;
  $('winner-title').textContent = title;
  const rows = res.rows.map((r, k) => {
    const tr = el('tr', res.winners.includes(r.index) ? 'win' : '');
    const name = el('td'); const dot = el('span', 'dot'); dot.style.background = r.color; name.append(dot, document.createTextNode(r.name));
    tr.append(el('td', null, String(k + 1)), name,
      el('td', null, survival ? `${r.alive ? r.hp : 'KO'} / ${r.score}` : String(r.score)),
      el('td', null, String(r.damage)),
      el('td', null, r.best ? `${getWeapon(r.best.weapon).icon} ${getWeapon(r.best.weapon).name} (${r.best.dmg})` : '—'),
      el('td', null, `${r.accuracy}%`), el('td', null, String(r.self)));
    return tr;
  });
  document.querySelector('#results-table tbody').replaceChildren(...rows);
  $('awards').replaceChildren(...res.awards.map((a) => {
    const d = el('div', 'award');
    d.append(el('b', null, a.title), document.createTextNode(`${res.rows.find((r) => r.index === a.index)?.name}: ${a.value}`));
    return d;
  }));
  renderSession(res.session || G.room?.session || []);
  updateResultButtons();
  const winner = res.rows.find((r) => r.index === res.winners[0]);
  const meWon = res.winners.some((i) => G.me.includes(G.match?.players[i]?.id));
  if (meWon || res.tie || G.me.length > 1) audio.jingle(); else audio.sad();
  startConfetti();
  const wp = G.match?.players[res.winners[0]];
  winnerTankLoop(winner ? { color: winner.color, style: wp?.style || 'classic' } : null);
}
function renderSession(list) {
  $('session').replaceChildren(...list.map((s) => {
    const sp = el('span'); const dot = el('span', 'dot'); dot.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:${s.color}`;
    sp.append(dot, document.createTextNode(`${s.name}: ${s.wins}`));
    return sp;
  }));
}
function updateResultButtons() {
  const host = isHost();
  $('btn-rematch').hidden = !host;
  $('btn-to-lobby').hidden = !host;
  $('results-wait').textContent = host ? '' : 'Waiting for the host to start a rematch…';
}
$('btn-rematch').onclick = async () => { const r = await emit('rematch'); if (r.error) $('results-wait').textContent = r.error; };
$('btn-to-lobby').onclick = () => send('lobby');
$('btn-share-result').onclick = shareResult;

function startConfetti() {
  const c = $('confetti');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const ctx = c.getContext('2d');
  const colors = ['#ffb703', '#fb8500', '#e74c3c', '#3498db', '#2ecc71', '#ff4dd2', '#fff'];
  const bits = Array.from({ length: 160 }, () => ({
    x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight, vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 120,
    r: Math.random() * 6, vr: (Math.random() - 0.5) * 8, w: 6 + Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  let last = t0;
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const age = (now - t0) / 1000;
    for (const b of bits) {
      b.x += b.vx * dt + Math.sin(now / 300 + b.w) * 0.6; b.y += b.vy * dt; b.r += b.vr * dt;
      if (b.y > innerHeight + 20 && age < 5) { b.y = -20; b.x = Math.random() * innerWidth; }
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.c; ctx.globalAlpha = age > 6 ? Math.max(0, 1 - (age - 6) / 2) : 1;
      ctx.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2);
      ctx.restore();
    }
    if (age < 8 && G.screen === 'results') requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  requestAnimationFrame(loop);
}
function winnerTankLoop(w) {
  const c = $('winner-tank'), ctx = c.getContext('2d');
  const loop = (now) => {
    if (G.screen !== 'results') return;
    const t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (w) {
      const hop = Math.abs(Math.sin(t * 4)) * 14;
      ctx.setTransform(2.4, 0, 0, 2.4, 100 - 2.4 * 100, 100 - 2.4 * 100 - hop);
      drawTank(ctx, { x: 100, y: 100, tilt: Math.sin(t * 8) * 0.08, angle: 90 + Math.sin(t * 3) * 40, color: w.color, style: w.style, alive: true, wheel: t * 6 }, t);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function shareResult() {
  const res = G.results;
  if (!res) return;
  const rows = res.rows;
  const c = document.createElement('canvas');
  c.width = 900; c.height = 170 + rows.length * 46 + 60;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#1b2233'); g.addColorStop(1, '#0d1017');
  ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#ffb703'; ctx.font = '40px "Russo One", system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Shell Shock Arena', 450, 56);
  ctx.fillStyle = '#fff'; ctx.font = '26px "Russo One", system-ui';
  ctx.fillText($('winner-title').textContent, 450, 100);
  ctx.textAlign = 'left'; ctx.font = '15px system-ui'; ctx.fillStyle = '#94a0b4';
  const cols = [40, 80, 330, 470, 590, 800];
  ['#', 'Player', res.mode === 'survival' ? 'HP / Score' : 'Score', 'Damage', 'Best shot', 'Acc.'].forEach((h, i) => ctx.fillText(h, cols[i], 145));
  rows.forEach((r, k) => {
    const y = 185 + k * 46;
    if (res.winners.includes(r.index)) { ctx.fillStyle = 'rgba(255,183,3,.12)'; ctx.fillRect(24, y - 28, 852, 40); }
    ctx.fillStyle = '#fff'; ctx.font = '18px system-ui';
    ctx.fillText(String(k + 1), cols[0], y);
    ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(cols[1] + 7, y - 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(r.name, cols[1] + 22, y);
    ctx.fillText(res.mode === 'survival' ? `${r.alive ? r.hp : 'KO'} / ${r.score}` : String(r.score), cols[2], y);
    ctx.fillText(String(r.damage), cols[3], y);
    ctx.fillText(r.best ? `${getWeapon(r.best.weapon).name} (${r.best.dmg})` : '—', cols[4], y);
    ctx.fillText(`${r.accuracy}%`, cols[5], y);
  });
  ctx.fillStyle = '#94a0b4'; ctx.font = '14px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(location.origin + location.pathname, 450, c.height - 22);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'shell-shock-result.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Shell Shock Arena result' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'shell-shock-result.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- socket events ----------
function wireSocket(sock) {
  let wasConnected = false;
  sock.on('connect', async () => {
    $('conn').hidden = true;
    if (wasConnected && G.code) {
      const res = await emit('join', { ...myLook(), code: G.code });
      if (res.error) { leaveRoom(); homeError(res.error); }
    }
    wasConnected = true;
  });
  sock.on('disconnect', () => {
    if (!G.code) return;
    $('conn').hidden = false;
    $('conn').textContent = 'Connection lost — reconnecting…';
  });
  sock.on('room', (r) => {
    const prevPhase = G.room?.phase;
    G.room = r;
    G.me = r.you || [];
    G.code = r.code;
    if (r.phase === 'lobby') {
      if (G.screen !== 'lobby') { show('lobby'); audio.stopAmbience(); }
      renderLobby();
    } else if (r.phase === 'results') {
      updateResultButtons();
      if (G.results) renderSession(r.session);
    } else if (G.screen === 'game') renderHud();
    void prevPhase;
  });
  sock.on('match', (snap) => { G.results = null; loadSnapshot(snap); });
  sock.on('draftTurn', (m) => {
    if (!G.match) return;
    G.match.pick = m.pick;
    G.draftDeadline = performance.now() + DRAFT_PICK_SECONDS * 1000;
    renderDraft();
    const p = G.match.players[m.player];
    if (p && G.me.includes(p.id)) audio.chime();
  });
  sock.on('picked', (m) => {
    if (!G.match) return;
    const item = G.match.pool[m.slot];
    if (item) item.by = m.player;
    G.match.inv[m.player].push({ slot: m.slot, weapon: m.weapon, used: false });
    G.match.pick = m.pick;
    if (G.draftSel === m.slot) G.draftSel = null;
    audio.click();
    renderDraft();
    const card = document.querySelector(`.wcard[data-slot="${m.slot}"]`);
    card?.classList.add('flash');
  });
  sock.on('turn', (t) => enqueue(() => startTurnUi(t)));
  sock.on('aim', (a) => {
    const v = G.vt[a.player];
    if (!v || a.player === actor()) return;
    v.tAngle = a.angle;
  });
  sock.on('moved', (m) => (isFree() ? startMove(m) : enqueue(() => startMove(m))));
  sock.on('shot', (s) => {
    if (isFree()) { startShot(s); return; }
    enqueue(() => { if (G.turn && G.turn.player === s.input.shooter && s.input.weapon) G.turn.fired = true; startShot(s); });
  });
  sock.on('free', (m) => { if (!G.match || !G.st) return; startFreeUi(m); initFreeAim(); renderHud(); });
  sock.on('skipped', (m) => enqueue(() => {
    const p = G.match.players[m.player];
    const item = G.match.inv[m.player].find((w) => w.weapon === m.weapon && !w.used);
    if (item && !item.infinite) item.used = true;
    if (G.match.shotsLeft[m.player] > 0) G.match.shotsLeft[m.player]--;
    if (G.turn) G.turn.fired = true;
    banner(`${G.me.includes(p.id) && G.me.length === 1 ? "Time's up!" : `${p.name}: time's up`}`, '#ff5d5d');
    renderHud();
  }));
  sock.on('results', (res) => enqueue(() => { G.turn = null; G.free = null; showResults(res); }));
  sock.on('chat', (m) => {
    addChat(m);
    const i = G.match?.players.findIndex((p) => p.id === m.from) ?? -1;
    if (i >= 0) G.bubbles.set(i, { text: m.text.length > 40 ? `${m.text.slice(0, 38)}…` : m.text, t: 0, emoji: false });
  });
  sock.on('emoji', (m) => {
    if (m.seat >= 0) G.bubbles.set(m.seat, { text: m.e, t: 0, emoji: true });
    const s = seatOf(m.from);
    addChat({ name: s?.name || '?', color: s?.color || '#fff', text: m.e });
  });
  sock.on('kicked', () => { leaveRoom(); homeError('You were removed from the room by the host.'); });
}

// ---------- input ----------
const canvas = $('canvas');
const renderer = new Renderer(canvas);
const SLING_DEAD_PX = 18;   // pulls shorter than this cancel
const SLING_FULL_PX = 170;  // screen px of stretch for 100% power

// Slingshot aiming: press anywhere, pull back, release to fire.
// The shot goes opposite to the pull; the stretch length sets the power. Back at the start = cancel.
function slingDrag(cx, cy, phase) {
  const rect = canvas.getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top;
  if (phase === 'start') {
    G.sling = { ax: x, ay: y, px: x, py: y, power: 0, cancel: true, angle0: G.aim.angle, power0: G.aim.power };
    return;
  }
  const s = G.sling;
  if (!s) return;
  s.px = x; s.py = y;
  const dx = s.ax - x, dy = s.ay - y;
  const stretch = Math.hypot(dx, dy);
  s.cancel = stretch < SLING_DEAD_PX;
  if (!s.cancel) {
    let ang = Math.atan2(-dy, dx) / DEG;
    if (ang < 0) ang = dx >= 0 ? 0 : 180;
    const me = actor();
    const cap = me >= 0 && frozenNow(me) ? FROZEN_POWER_CAP : 100;
    s.power = Math.min(cap, ((stretch - SLING_DEAD_PX) / (SLING_FULL_PX - SLING_DEAD_PX)) * 100);
    setAim(ang, s.power);
  } else {
    setAim(s.angle0, s.power0);
  }
  if (phase === 'end') {
    G.sling = null;
    if (!s.cancel) { G.slingUsed = true; $('aim-hint').hidden = true; fire(); }
  }
}
const fx = new FX();
fx.shakeScale = prefs.shake;
const input = createInput(canvas, {
  drag(cx, cy, phase) {
    audio.unlock();
    const me = actor();
    if (me < 0) { G.sling = null; return; }
    $('weapon-list').hidden = true;
    if (prefs.aimMode === 'sling') return slingDrag(cx, cy, phase);
    const w = renderer.clientToWorld(cx, cy, G.cam);
    const v = G.vt[me];
    const dx = w.x - v.x, dy = w.y - (v.y - TURRET_PIVOT);
    let ang = Math.atan2(-dy, dx) / DEG;
    if (ang < 0) ang = dx >= 0 ? 0 : 180;
    const pw = Math.hypot(dx, dy) / 2.6;
    if (phase === 'start' && Math.hypot(dx, dy) < 12) return;
    setAim(ang, pw);
  },
  key(action, fine, repeat) {
    audio.unlock();
    if (action === 'mute') { $('mute').checked = audio.toggleMute(); showToast(audio.muted ? 'Sound off' : 'Sound on'); return; }
    if (action === 'menu') { if (G.screen === 'game') $('menu').hidden = !$('menu').hidden; return; }
    if (G.screen === 'draft' && !repeat) return draftNav(action);
    if (G.screen !== 'game') return false;
    if (actor() < 0) {
      // out of shots in Free Fire: you can still drive
      if (mover() >= 0 && (action === 'moveLeft' || action === 'moveRight')) { move(action === 'moveLeft' ? -1 : 1); return true; }
      return false;
    }
    if (!$('weapon-list').hidden && (action === 'fire' || !['moveLeft', 'moveRight'].includes(action))) {
      if (action === 'openWeapons') { $('weapon-list').hidden = true; return true; }
      return listNav(action);
    }
    const st = fine ? 0.1 : 1;
    switch (action) {
      case 'openWeapons': if (!repeat) openWeaponList(); break;
      case 'aimMode': if (!repeat) $('aim-mode').click(); break;
      case 'angleUp': setAim(G.aim.angle + st, G.aim.power); break;
      case 'angleDown': setAim(G.aim.angle - st, G.aim.power); break;
      case 'powerUp': setAim(G.aim.angle, G.aim.power + st); break;
      case 'powerDown': setAim(G.aim.angle, G.aim.power - st); break;
      case 'fire': if (!repeat) fire(); break;
      case 'moveLeft': move(-1); break;
      case 'moveRight': move(1); break;
      case 'prevWeapon': if (!repeat) cycleWeapon(-1); break;
      case 'nextWeapon': if (!repeat) cycleWeapon(1); break;
      default: return false;
    }
    return true;
  },
  stick(dA, dP) { if (actor() >= 0) setAim(G.aim.angle + dA, G.aim.power + dP); },
});
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
window.addEventListener('keydown', () => audio.unlock(), { once: true });
window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  // catch up instantly on anything that queued while the tab was in the background
  if (G.queue.length > 1 || G.plays.length > 2) {
    for (const P of [...G.plays]) finishShot(P);
    for (const M of [...G.moves]) finishMove(M);
  }
});

// ---------- main loop ----------
let lastFrame = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  G.time += dt;
  // draft timer bar
  if (G.screen === 'draft') {
    const k = Math.max(0, (G.draftDeadline - now) / (DRAFT_PICK_SECONDS * 1000));
    $('draft-timer').style.transform = `scaleX(${k})`;
  }
  if (G.screen !== 'game' || !G.st) return;
  input.pollGamepad(dt);
  updateShots(dt);
  updateMoves(dt);
  updateTimer(now);
  updateFireButton(now);
  // turret tweening and recoil
  G.vt.forEach((v, i) => {
    v.angle += (v.tAngle - v.angle) * Math.min(1, dt * 6);
    v.recoil = Math.max(0, v.recoil - dt * 3);
    const t = G.st.tanks[i];
    if (t.alive && G.st.mode === 'survival' && t.hp < 30 && (v.smokeT -= dt) < 0) { v.smokeT = 0.12; fx.smokeFrom(v.x + (Math.random() - 0.5) * 10, v.y - 16); }
  });
  for (const [k, b] of G.bubbles) { b.t += dt; if (b.t > 4) G.bubbles.delete(k); }
  if (G.time < G.quakeUntil) fx.shake = Math.max(fx.shake, 8 * prefs.shake);
  fx.update(dt, 0);
  updateCamera(dt);
  renderer.draw(buildScene(), fx);
}
requestAnimationFrame(frame);

// Free Fire: the FIRE button shows the reload.
function updateFireButton(now) {
  const b = $('btn-fire');
  if (!isFree()) { if (b.dataset.r) { b.textContent = 'FIRE'; delete b.dataset.r; } return; }
  const left = G.reloadUntil - now;
  const label = left > 0 ? `${(left / 1000).toFixed(1)}s` : 'FIRE';
  if (b.textContent !== label) b.textContent = label;
  b.dataset.r = '1';
  b.classList.toggle('reloading', left > 0);
}

function updateTimer(now) {
  const ring = $('timer-ring');
  if (isFree() && G.free) {
    const total = Math.max(1, G.match.settings.weapons * 8000);
    const left = Math.max(0, G.freeEnds - now);
    const secs = Math.ceil(left / 1000);
    $('timer-text').textContent = secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : String(secs);
    $('timer-arc').style.strokeDashoffset = String(119.4 * (1 - Math.min(1, left / total)));
    ring.classList.toggle('low', secs <= 10);
    return;
  }
  const total = (G.match?.settings.turnTime || 0) * 1000;
  if (!total || !G.turn || G.turn.fired) { $('timer-text').textContent = total ? '' : '∞'; $('timer-arc').style.strokeDashoffset = '0'; ring.classList.remove('low'); return; }
  const left = Math.max(0, G.turnLocalDeadline - now);
  const secs = Math.ceil(left / 1000);
  $('timer-text').textContent = String(secs);
  $('timer-arc').style.strokeDashoffset = String(119.4 * (1 - left / total));
  ring.classList.toggle('low', secs <= 5);
  if (secs <= 5 && secs > 0 && secs !== G.lastTick && myTurn()) { G.lastTick = secs; audio.tick(); }
}

function updateCamera(dt) {
  let tx = WORLD_W / 2, ty = WORLD_H / 2, tz = 1;
  const cur = isFree() ? null : G.history[G.history.length - 1]; // Free Fire keeps the whole map in view
  if (cur && cur.length) {
    // follow the lead projectile
    tx = cur[1]; ty = cur[2]; tz = 1.3;
  } else if (renderer.portrait) {
    // portrait shows part of the map: stay on your tank, or whoever is playing
    const focus = actor() >= 0 ? actor() : isFree() ? mySeat() : G.turn?.player ?? -1;
    if (focus >= 0 && G.vt[focus]) tx = G.vt[focus].x;
  }
  const k = Math.min(1, dt * (tz > 1 ? 2.5 : 1.8));
  G.cam.zoom += (tz - G.cam.zoom) * k;
  G.cam.x += (tx - G.cam.x) * k;
  G.cam.y += (ty - G.cam.y) * k;
  const { hw, hh } = renderer.viewHalf(G.cam.zoom);
  G.cam.x = hw >= WORLD_W / 2 ? WORLD_W / 2 : Math.max(hw, Math.min(WORLD_W - hw, G.cam.x));
  G.cam.y = hh >= WORLD_H / 2 ? WORLD_H / 2 : Math.max(hh, Math.min(WORLD_H - hh, G.cam.y));
}

function buildScene() {
  const st = G.st, survival = st.mode === 'survival';
  const tanks = G.match.players.map((p, i) => {
    const t = st.tanks[i], v = G.vt[i], seat = seatOf(p.id);
    return {
      x: v.x, y: v.y, tilt: v.tilt, angle: v.angle, recoil: v.recoil, wheel: v.wheel, color: p.color, style: p.style, name: p.name,
      hp: t.hp, shield: t.shield, frozen: t.frozen, buried: t.buried > 0, alive: t.alive, bot: !!seat?.isBot, offline: seat && !seat.connected,
      active: isFree() ? i === actor() : !!G.turn && !G.turn.fired && G.turn.player === i && !busy(), bubble: G.bubbles.get(i),
    };
  });
  let aim = null;
  const me = actor();
  if (me >= 0) {
    const v = G.vt[me];
    const pts = previewPath(st, { x: v.x, y: v.y }, G.aim.angle, G.aim.power);
    const item = G.match.inv[me].find((w) => w.slot === G.aim.slot);
    const n = Math.max(2, Math.ceil(pts.length * 0.15));
    aim = { pts: item && getWeapon(item.weapon).behavior === 'laser' ? laserGuide(v, n) : pts.slice(0, n), color: G.match.players[me].color };
  }
  return {
    time: G.time, cam: G.cam, tanks, mines: st.mines, history: G.history, aim, survival, wind: 0,
    tracers: [...G.tracers.values()],
    sling: me >= 0 ? G.sling : null,
    slingColor: me >= 0 ? G.match.players[me].color : '#fff',
  };
}

function laserGuide(v, n) {
  const m = muzzle({ x: v.x, y: v.y }, G.aim.angle);
  const len = G.aim.power * 12 * 0.15;
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push({ x: m.x + Math.cos(G.aim.angle * DEG) * len * (i / n), y: m.y - Math.sin(G.aim.angle * DEG) * len * (i / n) });
  return pts;
}

// test/debug hook (read-only view of the client state)
window.__ssa = {
  state: () => ({
    screen: G.screen, code: G.code, phase: G.room?.phase || null, me: G.me,
    myTurn: actor() >= 0, playing: busy() || G.queue.length > 0, free: isFree(), seat: mySeat(),
    shotsLeft: G.match?.shotsLeft || [], reloading: performance.now() < G.reloadUntil,
    turn: G.turn ? { player: G.turn.player, number: G.turn.number, fired: !!G.turn.fired } : null,
    hash: G.st ? hashState(G.st) : null,
    scores: G.st ? G.st.tanks.map((t) => t.score) : [],
    hp: G.st ? G.st.tanks.map((t) => t.hp) : [],
    picker: G.match && G.room?.phase === 'draft' ? G.match.order[G.match.pick] : null,
    pool: G.match ? G.match.pool.filter((p) => p.by < 0).map((p) => p.slot) : [],
  }),
};
