// Browser smoke test: 2 players in 2 browser contexts race each other.
// Skips (with a message) when Playwright/Chromium is not available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createGameServer } from '../server/index.js';
import { buildStatic } from '../scripts/build-static.js';
import { launchChromium } from './chromium.js';

async function twoPlayerRace(browser, url, shotPrefix) {
  const errors = [];
  {
    const pages = [];
    for (const name of ['Alice', 'Bob']) {
      const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      pages.push(page);
    }
    const [host, guest] = pages;

    await host.goto(url);
    await host.fill('#name', 'Alice');
    await host.click('#btn-create');
    await host.waitForSelector('#lobby.active');
    const code = (await host.textContent('#room-code')).trim();
    assert.match(code, /^[A-Z]{4}$/);

    await guest.goto(`${url}?room=${code}`);
    assert.equal(await guest.inputValue('#join-code'), code);
    await guest.fill('#name', 'Bob');
    await guest.click('#btn-join');
    await guest.waitForSelector('#lobby.active');
    await host.waitForFunction(() => document.querySelectorAll('#player-list li').length === 2);

    await host.uncheck('#bots');
    await host.click('#maps .map:nth-child(2)');
    await host.click('#btn-ready');
    await guest.click('#btn-ready');
    await host.waitForFunction(() => !document.getElementById('btn-start').disabled);
    await host.click('#btn-start');
    for (const p of pages) await p.waitForSelector('#game.active');

    const read = (p) => p.evaluate(() => window.__tinyRacers.state());
    for (const p of pages) await p.waitForFunction(() => window.__tinyRacers.state()?.started, null, { timeout: 10000 });
    const before = await Promise.all(pages.map(read));
    for (const p of pages) await p.keyboard.down('ArrowUp');
    await new Promise((r) => setTimeout(r, 5000));
    const after = await Promise.all(pages.map(read));
    for (const p of pages) await p.keyboard.up('ArrowUp');

    fs.mkdirSync('test-results', { recursive: true });
    await host.screenshot({ path: `test-results/${shotPrefix}-host.png` });
    await guest.screenshot({ path: `test-results/${shotPrefix}-guest.png` });

    for (let i = 0; i < 2; i++) {
      assert.equal(after[i].cars.length, 2, 'two cars in the race');
      for (let c = 0; c < 2; c++) {
        const moved = Math.hypot(after[i].cars[c].x - before[i].cars[c].x, after[i].cars[c].y - before[i].cars[c].y);
        assert.ok(moved > 100, `page ${i} sees car ${after[i].cars[c].name} move (${moved.toFixed(1)} units)`);
      }
    }
    // both pages agree on where the cars are (within interpolation delay)
    for (let c = 0; c < 2; c++) {
      const d = Math.hypot(after[0].cars[c].x - after[1].cars[c].x, after[0].cars[c].y - after[1].cars[c].y);
      assert.ok(d < 60, `views agree on car ${c} (${d.toFixed(1)} apart)`);
    }
    assert.deepEqual(errors, [], 'no console errors');
    for (const p of pages) await p.context().close();
  }
}

test('browser smoke test: create room, join, race, both see 2 moving cars', { timeout: 90000 }, async (t) => {
  const { browser, skip } = await launchChromium();
  if (skip) { t.skip(skip); return; }
  const server = createGameServer();
  const port = await server.listen(0);
  try {
    await twoPlayerRace(browser, `http://localhost:${port}/race/`, 'smoke');
  } finally {
    await browser.close();
    await server.close();
  }
});

// Front end on one origin (like Vercel), game server on another (like Render).
test('split hosting: static front end + separate game server with CORS', { timeout: 90000 }, async (t) => {
  const { browser, skip } = await launchChromium();
  if (skip) { t.skip(skip); return; }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-static-'));
  const web = express().use(express.static(outDir)).listen(0);
  await new Promise((r) => web.once('listening', r));
  const webUrl = `http://localhost:${web.address().port}`;
  const server = createGameServer({ corsOrigin: webUrl });
  const port = await server.listen(0);
  const blocked = createGameServer({ corsOrigin: 'https://somewhere-else.example' });
  const blockedPort = await blocked.listen(0);
  try {
    buildStatic(outDir, `http://127.0.0.1:${port}`);
    await twoPlayerRace(browser, `${webUrl}/race/`, 'split');

    // an origin that is not allowed cannot connect
    buildStatic(outDir, `http://127.0.0.1:${blockedPort}`);
    const page = await browser.newPage();
    await page.goto(`${webUrl}/race/`);
    await page.waitForFunction(() => /Connecting to the game server/.test(document.getElementById('home-error').textContent), null, { timeout: 15000 });
    assert.equal(blocked.io.engine.clientsCount, 0);
    await page.close();
  } finally {
    await browser.close();
    await server.close();
    await blocked.close();
    web.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
