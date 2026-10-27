// Browser smoke test for Shell Shock Arena: A creates a room, B opens the invite link and joins,
// both ready, the draft completes, A fires, and both clients show the same scores and state hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createGameServer } from '../../server/index.js';
import { launchChromium } from '../chromium.js';

test('tanks smoke: invite link, lobby, draft, shot, both clients agree', { timeout: 150000 }, async (t) => {
  const { browser, skip } = await launchChromium();
  if (skip) { t.skip(skip); return; }
  const server = createGameServer();
  const port = await server.listen(0);
  const errors = [];
  try {
    const pages = [];
    for (const name of ['Alice', 'Bob']) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${port}` }).catch(() => {});
      const page = await ctx.newPage();
      page.on('console', (m) => {
        // web fonts are optional (offline machines can't reach Google Fonts)
        if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url || '')) errors.push(`${name}: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      pages.push(page);
    }
    const [a, b] = pages;
    const st = (p) => p.evaluate(() => window.__ssa.state());

    // the chooser offers both games
    await a.goto(`http://localhost:${port}/`);
    await a.click('#pick-tanks');
    await a.waitForSelector('#home.active');
    await a.waitForFunction(() => window.__ssa);
    await a.fill('#name', 'Alice');
    await a.click('#btn-create');
    await a.waitForSelector('#lobby.active');
    const code = (await a.textContent('#room-code')).trim();
    assert.match(code, /^[A-Z0-9]{5}$/);
    await a.click('#btn-copy');
    const link = await a.evaluate(() => navigator.clipboard.readText()).catch(() => null)
      || await a.evaluate(() => `${location.origin}${location.pathname}?room=${document.getElementById('room-code').textContent}`);
    assert.ok(link.endsWith(`/tanks/?room=${code}`), `invite link ${link}`);

    // B opens the link: straight to "enter your name -> join lobby"
    await b.goto(link);
    await b.waitForSelector('#btn-join-invite:not([hidden])');
    await b.waitForFunction(() => window.__ssa);
    await b.fill('#name', 'Bob');
    await b.click('#btn-join-invite');
    await b.waitForSelector('#lobby.active');
    await a.waitForFunction(() => document.querySelectorAll('#slots li:not(.empty)').length === 2);

    // short match: 5 weapons each
    await a.click('#settings .seg button:text-is("5")');
    await a.click('#btn-ready');
    await b.click('#btn-ready');
    await a.waitForFunction(() => !document.getElementById('btn-start').disabled);
    await a.click('#btn-start');
    for (const p of pages) await p.waitForSelector('#draft.active');

    // draft: whoever is picking taps a free weapon twice
    for (let i = 0; i < 60; i++) {
      const sa = await st(a);
      if (sa.phase !== 'draft') break;
      for (const p of pages) {
        const s = await st(p);
        if (s.phase !== 'draft' || s.picker == null || !s.pool.length) continue;
        const mine = await p.evaluate(() => !document.getElementById('btn-pick').disabled || document.querySelector('#draft-status b')?.textContent.includes('Your pick'));
        if (!mine) continue;
        const card = `.wcard[data-slot="${s.pool[0]}"]`;
        await p.click(card);
        await p.click('#btn-pick').catch(() => {});
      }
      await a.waitForTimeout(80);
    }
    for (const p of pages) await p.waitForSelector('#game.active', { timeout: 20000 });

    // A's turn comes first (seat 0)
    await a.waitForFunction(() => window.__ssa.state().myTurn && !window.__ssa.state().playing, null, { timeout: 15000 });
    const before = await st(b);
    await a.keyboard.press('Space');
    await b.waitForFunction((n) => {
      const s = window.__ssa.state();
      return s.turn && s.turn.number > n && !s.playing;
    }, before.turn.number, { timeout: 40000 });
    await a.waitForFunction(() => !window.__ssa.state().playing, null, { timeout: 40000 });
    const [sa, sb] = [await st(a), await st(b)];
    fs.mkdirSync('test-results', { recursive: true });
    await a.screenshot({ path: 'test-results/tanks-host.png' });
    await b.screenshot({ path: 'test-results/tanks-guest.png' });
    assert.deepEqual(sa.scores, sb.scores, 'same scores');
    assert.equal(sa.hash, sb.hash, 'same terrain/state hash');
    const room = server.tanks.rooms.get(code);
    const { hashState } = await import('../../shared/tanks/simulate.js');
    assert.equal(sa.hash, hashState(room.match.state), 'clients match the server');
    assert.deepEqual(errors, [], 'no console errors');
    for (const p of pages) await p.context().close();
  } finally {
    await browser.close();
    await server.close();
  }
});
