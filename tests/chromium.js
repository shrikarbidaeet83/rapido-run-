// Launches Chromium for the browser smoke tests, or explains why it can't.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function launchChromium() {
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
