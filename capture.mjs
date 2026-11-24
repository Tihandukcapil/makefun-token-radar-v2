// Screenshot capture for Launch Radar v3, written fresh in this session.
// Drives the Playwright chromium headless shell over the Chrome DevTools
// Protocol with the Node standard library only (global WebSocket + fetch).
// Usage: node capture.mjs [output-dir]
// It screenshots the dashboard that main.ts already wrote into the output
// directory: the board top, the detail view of the top-ranked protocol, and
// the watchlist-filtered board. Each shot is 1440x900 JPEG, quality 82,
// lowered only if a shot would pass 400 KB.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const CHROME =
  process.env.CHROME_BIN ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell',
  );
const PORT = 9333;
const WIDTH = 1440;
const HEIGHT = 900;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHttp(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('chrome did not answer on ' + url);
}

// One WebSocket to the browser; every call carries an id, and session
// messages (from the attached page target) resolve through the same map.
class Browser {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ sessionId, id, method, params }));
    });
  }
}

async function shoot(browser, sessionId, url, outPath, readyExpr, quality, scrollTo) {
  await browser.send('Page.enable', {}, sessionId);
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await browser.send('Page.navigate', { url: 'about:blank' }, sessionId);
  await sleep(300);
  await browser.send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const ready = await browser.send(
        'Runtime.evaluate',
        { expression: readyExpr, returnByValue: true },
        sessionId,
      );
      if (ready.result && ready.result.value) break;
    } catch {
      // page still loading
    }
  }
  if (scrollTo) {
    await browser.send(
      'Runtime.evaluate',
      {
        expression: `document.querySelector('${scrollTo}') && document.querySelector('${scrollTo}').scrollIntoView({behavior:'instant', block:'start'})`,
        returnByValue: true,
      },
      sessionId,
    );
    await sleep(800);
  } else {
    await sleep(600);
  }
  // No clip: captureScreenshot without one captures the current viewport,
  // which is what the scroll above positioned. (A clip after scrolling
  // captures a blank region in this headless shell.)
  const shot = await browser.send(
    'Page.captureScreenshot',
    { format: 'jpeg', quality },
    sessionId,
  );
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  return fs.statSync(outPath).size;
}

async function main() {
  const outDir = process.argv[2] ?? path.join(process.cwd(), 'out');
  const dashPath = path.join(outDir, 'dashboard', 'index.html');
  if (!fs.existsSync(dashPath)) throw new Error('dashboard not found at ' + dashPath);
  const board = JSON.parse(fs.readFileSync(path.join(outDir, 'board.json'), 'utf8'));
  const topSlug = board.rows[0].slug;
  const shotsDir = path.join(root, 'screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });

  const chrome = spawn(
    CHROME,
    ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  try {
    const version = await (await waitHttp(`http://127.0.0.1:${PORT}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const browser = new Browser(ws);
    const target = await browser.send('Target.createTarget', { url: 'about:blank' });
    const attached = await browser.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;
    const base = 'file://' + dashPath;
    const jobs = [
      {
        url: base,
        out: path.join(shotsDir, '1-board.jpg'),
        ready: `document.querySelectorAll('#board tr').length > 5`,
        scrollTo: '#controls-card',
      },
      {
        url: base + '#detail=' + encodeURIComponent(topSlug),
        out: path.join(shotsDir, '2-detail.jpg'),
        ready: `document.querySelector('#detail h3') !== null`,
        scrollTo: '#detail-card',
      },
      {
        url: base + '#bucket=watchlist',
        out: path.join(shotsDir, '3-filtered.jpg'),
        ready: `document.querySelectorAll('#board tr').length > 5`,
        scrollTo: '#controls-card',
      },
    ];
    for (const job of jobs) {
      let q = 82;
      let size = await shoot(browser, sessionId, job.url, job.out, job.ready, q, job.scrollTo);
      while (size > 400000 && q > 55) {
        q -= 10;
        size = await shoot(browser, sessionId, job.url, job.out, job.ready, q, job.scrollTo);
      }
      console.log(`capture: ${path.basename(job.out)} ${size} bytes at quality ${q}`);
      if (size > 524288) throw new Error(`${job.out} still over 512 KiB at quality ${q}`);
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.error('capture FAILED:', e.message);
  process.exit(1);
});
