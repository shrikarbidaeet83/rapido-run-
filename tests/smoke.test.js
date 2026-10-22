// Browser smoke test: 2 players in 2 browser contexts race each other.
// Skips (with a message) when Playwright/Chromium is not available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGameServer } from '../server/index.js';

async function launchChromium() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return { skip: 'playwright is not installed (npm i -D playwright)' }; }
  try { return { browser: await chromium.launch() }; } catch (err) {
    // fall back to any Chromium build Playwright already downloaded on this machine
    const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'),
      path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
    const candidates = [];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const dir of fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome',
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']) {
          const exe = path.join(root, dir, rel);
          if (fs.existsSync(exe)) candidates.push(exe);
        }
      }
    }
    for (const executablePath of candidates) {
      try { return { browser: await chromium.launch({ executablePath }) }; } catch { /* try next */ }
    }
    return { skip: `no usable Chromium (${err.message.split('\n')[0]})` };
  }
}

test('browser smoke test: create room, join, race, both see 2 moving cars', { timeout: 90000 }, async (t) => {
  const { browser, skip } = await launchChromium();
  if (skip) { t.skip(skip); return; }
  const server = createGameServer();
  const port = await server.listen(0);
  const url = `http://localhost:${port}/`;
  const errors = [];
  try {
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
    await host.screenshot({ path: 'test-results/smoke-host.png' });
    await guest.screenshot({ path: 'test-results/smoke-guest.png' });

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
  } finally {
    await browser.close();
    await server.close();
  }
});
